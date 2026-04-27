from __future__ import annotations

import logging
import mimetypes
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .analyzer import AnalysisError, analyze_floor_plan, render_pdf_first_page_jpeg
from .models import PlanAnalysis, PlanRecord, PlanStatus
from .raw_storage import persist_raw_upload, read_raw_upload
from .store import PlanNotFound, store


SAMPLE_FILES_DIR = Path(__file__).resolve().parent.parent / "sample_files"
ALLOWED_SAMPLE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}


SERVICE_NAME = "spatial-stack-backend"
SERVICE_VERSION = "0.1.0"
ASYNC_ANALYSIS_EVENT_TYPE = "spatial-stack.analyze-plan"
LOGGER = logging.getLogger(__name__)
StatusCallback = Callable[[str, int], None]


def health_payload() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
    }


def analyze_plan_payload(file_bytes: bytes, content_type: str, filename: str) -> dict[str, Any]:
    started = time.perf_counter()
    plan_id = _new_plan_id()
    safe_filename = filename or "floor-plan-upload"
    LOGGER.info(
        "api.analyze.local.start plan_id=%s file=%s content_type=%s size_bytes=%d",
        plan_id,
        safe_filename,
        content_type or "application/octet-stream",
        len(file_bytes),
    )
    raw = persist_raw_upload(plan_id, safe_filename, content_type, file_bytes)
    analysis = _run_analysis(plan_id, file_bytes, content_type, safe_filename, raw["key"] if raw else None)
    LOGGER.info(
        "api.analyze.local.done plan_id=%s duration_ms=%d status=ready",
        plan_id,
        int((time.perf_counter() - started) * 1000),
    )
    return _dump(analysis)


def start_inline_plan_analysis_job(file_bytes: bytes, content_type: str, filename: str) -> tuple[dict[str, Any], dict[str, Any]]:
    plan_id = _new_plan_id()
    safe_filename = filename or "floor-plan-upload"
    record = _save_plan_status(
        plan_id,
        status="pending",
        source_file=safe_filename,
        content_type=content_type,
        status_message="Queued for analysis.",
        progress_pct=5,
    )
    worker_event = {
        "type": ASYNC_ANALYSIS_EVENT_TYPE,
        "planId": plan_id,
        "source": "inline",
        "fileBytes": file_bytes,
        "filename": safe_filename,
        "contentType": content_type,
    }
    store.audit(
        "analyze.queued",
        {
            "planId": plan_id,
            "sourceFile": safe_filename,
            "source": "inline",
        },
    )
    return _dump_record(record), worker_event


def start_uploaded_plan_analysis_job(file_bytes: bytes, content_type: str, filename: str) -> tuple[dict[str, Any], dict[str, Any]]:
    plan_id = _new_plan_id()
    safe_filename = filename or "floor-plan-upload"
    raw = persist_raw_upload(plan_id, safe_filename, content_type, file_bytes)
    if not raw:
        raise AnalysisError("RAW_PLAN_BUCKET_NAME is required for deployed async analysis.", 500)

    record = _save_plan_status(
        plan_id,
        status="pending",
        source_file=safe_filename,
        content_type=content_type,
        raw_object_key=raw["key"],
        status_message="Queued for analysis.",
        progress_pct=5,
    )
    worker_event = {
        "type": ASYNC_ANALYSIS_EVENT_TYPE,
        "planId": plan_id,
        "source": "s3",
        "bucket": raw["bucket"],
        "key": raw["key"],
        "filename": safe_filename,
        "contentType": content_type,
    }
    store.audit(
        "analyze.queued",
        {
            "planId": plan_id,
            "sourceFile": safe_filename,
            "source": "upload",
        },
    )
    return _dump_record(record), worker_event


def start_sample_file_analysis_job(filename: str) -> tuple[dict[str, Any], dict[str, Any]]:
    filepath, content_type = sample_file_payload(filename)
    plan_id = _new_plan_id()
    record = _save_plan_status(
        plan_id,
        status="pending",
        source_file=filepath.name,
        content_type=content_type,
        status_message="Queued for analysis.",
        progress_pct=5,
    )
    worker_event = {
        "type": ASYNC_ANALYSIS_EVENT_TYPE,
        "planId": plan_id,
        "source": "sample",
        "filename": filepath.name,
        "contentType": content_type,
    }
    store.audit(
        "analyze.queued",
        {
            "planId": plan_id,
            "sourceFile": filepath.name,
            "source": "sample",
        },
    )
    return _dump_record(record), worker_event


def run_plan_analysis_job(event: dict[str, Any]) -> dict[str, Any]:
    if event.get("type") != ASYNC_ANALYSIS_EVENT_TYPE:
        raise ValueError("Unsupported analysis job event.")

    plan_id = str(event.get("planId") or "")
    filename = str(event.get("filename") or "floor-plan-upload")
    content_type = str(event.get("contentType") or "application/octet-stream")
    raw_object_key = event.get("key") if isinstance(event.get("key"), str) else None

    if not plan_id:
        raise ValueError("Analysis job is missing planId.")

    _save_plan_status(
        plan_id,
        status="processing",
        source_file=filename,
        content_type=content_type,
        raw_object_key=raw_object_key,
        status_message="Preparing floor plan source.",
        progress_pct=15,
    )

    try:
        if event.get("source") == "s3":
            _save_plan_status(
                plan_id,
                status="processing",
                source_file=filename,
                content_type=content_type,
                raw_object_key=raw_object_key,
                status_message="Loading uploaded floor plan.",
                progress_pct=20,
            )
            bucket = str(event.get("bucket") or "")
            key = str(event.get("key") or "")
            if not bucket or not key:
                raise AnalysisError("Analysis job is missing raw-plan S3 location.", 500)
            file_bytes = read_raw_upload(bucket, key)
        elif event.get("source") == "sample":
            _save_plan_status(
                plan_id,
                status="processing",
                source_file=filename,
                content_type=content_type,
                raw_object_key=raw_object_key,
                status_message="Loading sample floor plan.",
                progress_pct=20,
            )
            filepath, content_type = sample_file_payload(filename)
            filename = filepath.name
            file_bytes = filepath.read_bytes()
        elif event.get("source") == "inline":
            raw_bytes = event.get("fileBytes")
            if not isinstance(raw_bytes, bytes):
                raise AnalysisError("Inline analysis job is missing floor-plan bytes.", 500)
            file_bytes = raw_bytes
        else:
            raise AnalysisError("Analysis job source is not supported.", 500)

        def status_callback(message: str, progress_pct: int) -> None:
            _save_plan_status(
                plan_id,
                status="processing",
                source_file=filename,
                content_type=content_type,
                raw_object_key=raw_object_key,
                status_message=message,
                progress_pct=progress_pct,
            )

        analysis = _run_analysis(plan_id, file_bytes, content_type, filename, raw_object_key, status_callback)
        return {"status": "ready", "planId": analysis.id}
    except Exception as exc:
        LOGGER.exception("api.analysis.job.failed plan_id=%s source_file=%s", plan_id, filename)
        _save_plan_status(
            plan_id,
            status="failed",
            source_file=filename,
            content_type=content_type,
            raw_object_key=raw_object_key,
            error=str(exc),
            status_message="Analysis failed.",
            progress_pct=100,
        )
        store.audit(
            "analyze.failed",
            {
                "planId": plan_id,
                "sourceFile": filename,
                "error": str(exc),
            },
        )
        return {"status": "failed", "planId": plan_id, "error": str(exc)}


def _run_analysis(
    plan_id: str,
    file_bytes: bytes,
    content_type: str,
    filename: str,
    raw_object_key: str | None,
    status_callback: StatusCallback | None = None,
) -> PlanAnalysis:
    started = time.perf_counter()
    LOGGER.info("api.analysis.run.start plan_id=%s file=%s", plan_id, filename)
    if status_callback:
        status_callback("Preparing model request.", 30)
    analysis = analyze_floor_plan(file_bytes, content_type, filename, plan_id, status_callback=status_callback)
    if raw_object_key:
        analysis.raw_object_key = raw_object_key

    if status_callback:
        status_callback("Saving spatial model.", 95)
    store.save_plan(analysis)
    store.audit(
        "analyze",
        {
            "planId": analysis.id,
            "sourceFile": analysis.source_file,
            "processingMode": analysis.processing_mode,
            "roomCount": len(analysis.rooms),
        },
    )
    LOGGER.info(
        "api.analysis.run.saved plan_id=%s duration_ms=%d rooms=%d spaces=%d",
        plan_id,
        int((time.perf_counter() - started) * 1000),
        len(analysis.rooms),
        len(analysis.spaces),
    )
    return analysis


def _save_plan_status(
    plan_id: str,
    *,
    status: PlanStatus,
    source_file: str,
    content_type: str,
    raw_object_key: str | None = None,
    error: str | None = None,
    status_message: str | None = None,
    progress_pct: int | None = None,
) -> PlanRecord:
    now = _now_iso()
    LOGGER.info(
        "api.analysis.status plan_id=%s status=%s progress_pct=%s message=%s",
        plan_id,
        status,
        progress_pct,
        status_message or "",
    )
    record = PlanRecord(
        id=plan_id,
        status=status,
        sourceFile=source_file,
        contentType=content_type or "application/octet-stream",
        processingMode="openrouter",
        statusMessage=status_message,
        progressPct=progress_pct,
        rawObjectKey=raw_object_key,
        error=error,
        createdAt=_existing_created_at(plan_id) or now,
        updatedAt=now,
    )
    store.save_plan_record(record)
    return record


def get_plan_payload(plan_id: str) -> dict[str, Any]:
    return _dump_record(store.get_plan_record(plan_id))


def list_plans_payload(limit: int = 20) -> dict[str, Any]:
    capped_limit = max(1, min(int(limit), 50))
    return {
        "plans": [item.model_dump(by_alias=True) for item in store.list_plans(capped_limit)],
        "limit": capped_limit,
    }


def list_sample_files_payload() -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    if SAMPLE_FILES_DIR.is_dir():
        for entry in sorted(SAMPLE_FILES_DIR.iterdir()):
            if entry.is_file() and entry.suffix.lower() in ALLOWED_SAMPLE_EXTENSIONS:
                mime = mimetypes.guess_type(entry.name)[0] or "application/octet-stream"
                files.append({
                    "filename": entry.name,
                    "sizeBytes": entry.stat().st_size,
                    "contentType": mime,
                    "previewContentType": "image/jpeg" if mime == "application/pdf" else mime,
                })
    return {"files": files}


def sample_file_payload(filename: str) -> tuple[Path, str]:
    filepath = _sample_file_path(filename)
    content_type = mimetypes.guess_type(filepath.name)[0] or "application/octet-stream"
    return filepath, content_type


def sample_file_preview_payload(filename: str) -> tuple[bytes, str]:
    filepath, content_type = sample_file_payload(filename)
    file_bytes = filepath.read_bytes()
    if content_type == "application/pdf":
        return render_pdf_first_page_jpeg(file_bytes, max_dimension=900, jpg_quality=82), "image/jpeg"
    return file_bytes, content_type


def analyze_sample_file_payload(filename: str) -> dict[str, Any]:
    filepath, content_type = sample_file_payload(filename)
    file_bytes = filepath.read_bytes()
    LOGGER.info("api.sample.analyze.start file=%s content_type=%s size_bytes=%d", filepath.name, content_type, len(file_bytes))
    return analyze_plan_payload(file_bytes, content_type, filepath.name)


def reset_payload() -> dict[str, Any]:
    store.reset()
    return {"status": "reset"}


def _dump(analysis: PlanAnalysis) -> dict[str, Any]:
    return analysis.model_dump(by_alias=True)


def _dump_record(record: PlanRecord) -> dict[str, Any]:
    return record.model_dump(by_alias=True, exclude_none=True)


def _new_plan_id() -> str:
    return f"plan-{uuid4().hex[:12]}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _existing_created_at(plan_id: str) -> str | None:
    try:
        return store.get_plan_record(plan_id).created_at
    except PlanNotFound:
        return None


def _sample_file_path(filename: str) -> Path:
    safe_name = Path(filename).name
    filepath = SAMPLE_FILES_DIR / safe_name
    if not filepath.is_file() or filepath.suffix.lower() not in ALLOWED_SAMPLE_EXTENSIONS:
        raise FileNotFoundError(f"Sample file not found: {safe_name}")
    return filepath
