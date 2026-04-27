from __future__ import annotations

import base64
import hmac
import json
import os
import re
from pathlib import Path
from email import policy
from email.parser import BytesParser
from typing import Any
from urllib.parse import unquote

from .analyzer import AnalysisError
from .api import (
    ASYNC_ANALYSIS_EVENT_TYPE,
    get_plan_payload,
    health_payload,
    list_plans_payload,
    list_sample_files_payload,
    reset_payload,
    run_plan_analysis_job,
    sample_file_payload,
    sample_file_preview_payload,
    start_sample_file_analysis_job,
    start_uploaded_plan_analysis_job,
)
from .responses import CORS_HEADERS, error_response, json_response, options_response
from .store import PlanNotFound


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if event.get("type") == ASYNC_ANALYSIS_EVENT_TYPE:
        return run_plan_analysis_job(event)

    method = _event_method(event)
    path = _event_path(event)

    if not _origin_header_allowed(event):
        return error_response("Forbidden", 403)

    if method == "OPTIONS":
        return options_response()

    try:
        if method == "GET" and path == "/health":
            return json_response(health_payload())
        if method == "GET" and path == "/plans":
            return json_response(list_plans_payload(_query_int(event, "limit", 20)))
        if method == "GET" and path == "/sample-files":
            return json_response(list_sample_files_payload())
        if method == "POST" and path == "/reset":
            return json_response(reset_payload())
        if method == "POST" and path == "/plans/analyze":
            body, content_type, filename = _extract_upload(event)
            if not body:
                return error_response("Upload a floor plan file before analysis.", 422)
            payload, worker_event = start_uploaded_plan_analysis_job(body, content_type, filename)
            _invoke_analysis_worker(worker_event)
            return json_response(payload, 202)

        sample_preview = re.match(r"^/sample-files/([^/]+)/preview$", path)
        if method == "GET" and sample_preview:
            filename = _decode_path_part(sample_preview.group(1))
            body, content_type = sample_file_preview_payload(filename)
            return binary_response(body, content_type, cache_control="public, max-age=86400")

        sample_analyze = re.match(r"^/sample-files/([^/]+)/analyze$", path)
        if method == "POST" and sample_analyze:
            filename = _decode_path_part(sample_analyze.group(1))
            payload, worker_event = start_sample_file_analysis_job(filename)
            _invoke_analysis_worker(worker_event)
            return json_response(payload, 202)

        sample_file = re.match(r"^/sample-files/([^/]+)$", path)
        if method == "GET" and sample_file:
            filename = _decode_path_part(sample_file.group(1))
            filepath, content_type = sample_file_payload(filename)
            return binary_response(filepath.read_bytes(), content_type, filename=Path(filepath).name, cache_control="public, max-age=86400")

        match = re.match(r"^/plans/([^/]+)$", path)
        if method == "GET" and match:
            return json_response(get_plan_payload(match.group(1)))

        return error_response("Not found", 404)
    except FileNotFoundError as exc:
        return error_response(str(exc), 404)
    except PlanNotFound as exc:
        return error_response(str(exc), 404)
    except AnalysisError as exc:
        return error_response(str(exc), exc.status_code)
    except Exception as exc:
        return error_response(str(exc), 500)


def _event_method(event: dict[str, Any]) -> str:
    request_context = event.get("requestContext") or {}
    http_context = request_context.get("http") or {}
    return str(http_context.get("method") or event.get("httpMethod") or "GET").upper()


def _event_path(event: dict[str, Any]) -> str:
    path = str(event.get("rawPath") or event.get("path") or "/")
    normalized = path.rstrip("/") or "/"
    prefix = os.getenv("API_PATH_PREFIX", "/api").strip().rstrip("/")
    if prefix and prefix != "/" and normalized == prefix:
        return "/"
    if prefix and prefix != "/" and normalized.startswith(f"{prefix}/"):
        return normalized[len(prefix) :] or "/"
    return normalized


def _event_headers(event: dict[str, Any]) -> dict[str, str]:
    headers = event.get("headers") or {}
    return {str(key).lower(): str(value) for key, value in headers.items() if value is not None}


def _origin_header_allowed(event: dict[str, Any]) -> bool:
    expected = os.getenv("API_ORIGIN_HEADER_VALUE", "").strip()
    if not expected:
        return True

    header_name = os.getenv("API_ORIGIN_HEADER_NAME", "x-spatial-stack-origin").strip().lower()
    if not header_name:
        return False

    actual = _event_headers(event).get(header_name, "")
    return hmac.compare_digest(actual, expected)


def _event_body(event: dict[str, Any]) -> bytes:
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        return base64.b64decode(body)
    return str(body).encode("utf-8")


def _extract_upload(event: dict[str, Any]) -> tuple[bytes, str, str]:
    headers = _event_headers(event)
    content_type = headers.get("content-type", "application/octet-stream")
    body = _event_body(event)

    if content_type.lower().startswith("multipart/form-data"):
        parsed = BytesParser(policy=policy.default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
        )
        if parsed.is_multipart():
            for part in parsed.iter_parts():
                disposition = part.get("content-disposition", "")
                if "form-data" not in disposition:
                    continue
                filename = part.get_filename()
                if not filename:
                    continue
                payload = part.get_payload(decode=True) or b""
                part_type = part.get_content_type() or "application/octet-stream"
                return payload, part_type, filename

    return body, content_type, headers.get("x-filename", "floor-plan-upload")


def _query_int(event: dict[str, Any], name: str, default: int) -> int:
    params = event.get("queryStringParameters") or {}
    try:
        return int(params.get(name, default))
    except (TypeError, ValueError):
        return default


def _decode_path_part(value: str) -> str:
    return unquote(value)


def _invoke_analysis_worker(worker_event: dict[str, Any]) -> None:
    function_name = os.getenv("AWS_LAMBDA_FUNCTION_NAME", "").strip()
    if not function_name:
        raise AnalysisError("AWS_LAMBDA_FUNCTION_NAME is required for async analysis.", 500)

    import boto3

    client = boto3.client("lambda", region_name=os.getenv("AWS_REGION", "ap-southeast-1"))
    client.invoke(
        FunctionName=function_name,
        InvocationType="Event",
        Payload=json.dumps(worker_event).encode("utf-8"),
    )


def binary_response(
    body: bytes,
    content_type: str,
    *,
    filename: str | None = None,
    cache_control: str | None = None,
    status_code: int = 200,
) -> dict[str, Any]:
    headers = {
        **CORS_HEADERS,
        "Content-Type": content_type or "application/octet-stream",
    }
    if cache_control:
        headers["Cache-Control"] = cache_control
    if filename:
        headers["Content-Disposition"] = f'inline; filename="{filename}"'

    return {
        "statusCode": status_code,
        "headers": headers,
        "body": base64.b64encode(body).decode("ascii"),
        "isBase64Encoded": True,
    }


lambda_handler = handler
