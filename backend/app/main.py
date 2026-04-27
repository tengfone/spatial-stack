from __future__ import annotations

import logging
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, File, Header, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .analyzer import AnalysisError
from .api import (
    get_plan_payload,
    health_payload,
    list_plans_payload,
    list_sample_files_payload,
    reset_payload,
    run_plan_analysis_job,
    sample_file_payload,
    sample_file_preview_payload,
    start_inline_plan_analysis_job,
    start_sample_file_analysis_job,
)
from .config import env_value
from .store import PlanNotFound


LOCAL_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
LOGGER = logging.getLogger(__name__)


def create_app() -> FastAPI:
    _configure_logging()
    app = FastAPI(
        title="Spatial Stack API",
        version="0.1.0",
        description="Scenario C local API for 2D-to-3D floor plan analysis.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=LOCAL_CORS_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict:
        return health_payload()

    @app.get("/plans")
    def list_plans(limit: int = 20) -> dict:
        return list_plans_payload(limit)

    @app.get("/plans/{plan_id}")
    def get_plan(plan_id: str) -> dict:
        try:
            return get_plan_payload(plan_id)
        except PlanNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/plans/analyze")
    async def analyze_plan(
        background_tasks: BackgroundTasks,
        request: Request,
        file: Optional[UploadFile] = File(None),
        x_filename: Optional[str] = Header(None, alias="x-filename"),
    ) -> JSONResponse:
        if file and file.filename:
            body = await file.read()
            content_type = file.content_type or "application/octet-stream"
            filename = file.filename
        else:
            body = await request.body()
            content_type = request.headers.get("content-type", "application/octet-stream")
            filename = x_filename or "floor-plan-upload"

        if not body:
            raise HTTPException(status_code=422, detail="Upload a floor plan file before analysis.")
        try:
            payload, worker_event = start_inline_plan_analysis_job(body, content_type, filename)
            background_tasks.add_task(run_plan_analysis_job, worker_event)
            return JSONResponse(payload, status_code=202)
        except AnalysisError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    @app.get("/sample-files")
    def list_sample_files() -> dict:
        return list_sample_files_payload()

    @app.get("/sample-files/{filename}/preview")
    def preview_sample_file(filename: str) -> Response:
        try:
            body, media_type = sample_file_preview_payload(filename)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except AnalysisError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        return Response(
            content=body,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )

    @app.post("/sample-files/{filename}/analyze")
    def analyze_sample_file(filename: str, background_tasks: BackgroundTasks) -> JSONResponse:
        try:
            payload, worker_event = start_sample_file_analysis_job(filename)
            background_tasks.add_task(run_plan_analysis_job, worker_event)
            return JSONResponse(payload, status_code=202)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except AnalysisError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    @app.get("/sample-files/{filename}")
    def get_sample_file(filename: str) -> FileResponse:
        try:
            filepath, media_type = sample_file_payload(filename)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return FileResponse(
            filepath,
            media_type=media_type,
            filename=filepath.name,
            content_disposition_type="inline",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    @app.post("/reset")
    def reset() -> dict:
        return reset_payload()

    return app


def _configure_logging() -> None:
    level_name = env_value("LOG_LEVEL", "INFO").strip().upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    logging.getLogger("app").setLevel(level)
    LOGGER.info("logging.configured level=%s", logging.getLevelName(level))


app = create_app()
