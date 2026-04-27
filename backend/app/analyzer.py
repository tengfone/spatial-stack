from __future__ import annotations

import base64
import json
import logging
import math
import re
import time
from collections.abc import Callable
from typing import Any, Literal

import httpx
from pydantic import ValidationError

from .config import env_value
from .models import PlanAnalysis


OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_CHAT_COMPLETIONS_URL = f"{OPENROUTER_API_BASE_URL}/chat/completions"
DEFAULT_OPENROUTER_MODEL = "google/gemini-3-flash-preview"
DEFAULT_OPENROUTER_TIMEOUT_SECONDS = 90
DEFAULT_OPENROUTER_MAX_TOKENS = 12000
DEFAULT_OPENROUTER_APP_TITLE = "Spatial Stack"
LOGGER = logging.getLogger(__name__)
StatusCallback = Callable[[str, int], None]
OpenRouterResponseFormat = Literal["json_schema", "json_object"]
ROOM_OVERLAP_TOLERANCE_M = 0.08
FURNITURE_CLEARANCE_M = 0.08
SEVERE_ROOM_OVERLAP_AREA_SQM = 1.0
SEVERE_ROOM_OVERLAP_RATIO = 0.08
MIN_ROOM_CONFIDENCE = 0.55
MIN_AVERAGE_ROOM_CONFIDENCE = 0.65
FURNITURE_KIND_VALUES = [
    "bed",
    "nightstand",
    "wardrobe",
    "sofa",
    "coffee-table",
    "media-console",
    "dining-table",
    "chair",
    "desk",
    "office-chair",
    "counter",
    "sink",
    "stove",
    "fridge",
    "toilet",
    "shower",
    "bathtub",
    "washer",
    "shelf",
    "storage",
    "appliance",
    "table",
]


class AnalysisError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def _elapsed_ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def _payload_counts_for_log(payload: dict[str, Any]) -> str:
    return " ".join(
        f"{key}={len(value)}"
        for key in ("rooms", "spaces", "walls", "openings", "fixtures", "labels")
        if isinstance((value := payload.get(key)), list)
    )


def _openrouter_user_content_stats(user_content: str | list[dict[str, Any]]) -> dict[str, int]:
    if isinstance(user_content, str):
        return {"prompt_chars": len(user_content), "image_chars": 0}

    prompt_chars = 0
    image_chars = 0
    for part in user_content:
        if not isinstance(part, dict):
            continue
        if isinstance(part.get("text"), str):
            prompt_chars += len(part["text"])
        image_url = part.get("image_url")
        if isinstance(image_url, dict) and isinstance(image_url.get("url"), str):
            image_chars += len(image_url["url"])
    return {"prompt_chars": prompt_chars, "image_chars": image_chars}


def analyze_floor_plan(
    file_bytes: bytes,
    content_type: str,
    filename: str,
    plan_id: str,
    status_callback: StatusCallback | None = None,
) -> PlanAnalysis:
    analysis_started = time.perf_counter()
    model_ids = _openrouter_model_sequence()
    errors: list[str] = []
    LOGGER.info(
        "analysis.start plan_id=%s file=%s content_type=%s size_bytes=%d models=%s",
        plan_id,
        filename,
        content_type or "application/octet-stream",
        len(file_bytes),
        ",".join(model_ids),
    )

    for index, model_id in enumerate(model_ids):
        attempt_started = time.perf_counter()
        try:
            LOGGER.info(
                "analysis.model_attempt.start plan_id=%s attempt=%d/%d model=%s timeout_s=%d",
                plan_id,
                index + 1,
                len(model_ids),
                model_id,
                _openrouter_timeout(index),
            )
            _emit_status(
                status_callback,
                f"Calling OpenRouter model {model_id} ({index + 1}/{len(model_ids)}).",
                45 if index == 0 else 65,
            )
            payload = _analyze_with_openrouter(file_bytes, content_type, filename, model_id, _openrouter_timeout(index))
            _emit_status(status_callback, "Validating spatial geometry.", 82)
            LOGGER.info(
                "analysis.model_attempt.parsed plan_id=%s model=%s duration_ms=%d %s",
                plan_id,
                payload.get("modelId") or model_id,
                _elapsed_ms(attempt_started),
                _payload_counts_for_log(payload),
            )
            analysis = _analysis_from_payload(payload, plan_id, filename, content_type)
            sanity_issues = _analysis_sanity_issues(analysis, payload)
            if sanity_issues:
                raise AnalysisError(
                    f"OpenRouter analysis from model {model_id!r} failed sanity checks: {'; '.join(sanity_issues)}",
                    502,
                )
            LOGGER.info(
                "analysis.ready plan_id=%s model=%s duration_ms=%d rooms=%d spaces=%d walls=%d openings=%d fixtures=%d labels=%d",
                plan_id,
                analysis.model_id,
                _elapsed_ms(analysis_started),
                len(analysis.rooms),
                len(analysis.spaces),
                len(analysis.walls),
                len(analysis.openings),
                len(analysis.fixtures),
                len(analysis.labels),
            )
            return analysis
        except AnalysisError as exc:
            if exc.status_code in {422, 503}:
                raise
            LOGGER.warning(
                "analysis.model_attempt.failed plan_id=%s model=%s duration_ms=%d status_code=%d error=%s",
                plan_id,
                model_id,
                _elapsed_ms(attempt_started),
                exc.status_code,
                exc,
            )
            next_progress = 60 if index < len(model_ids) - 1 else 90
            _emit_status(status_callback, "Model analysis failed.", next_progress)
            errors.append(f"{model_id}: {exc}")
            if index == len(model_ids) - 1:
                break

    LOGGER.error("analysis.failed plan_id=%s duration_ms=%d errors=%s", plan_id, _elapsed_ms(analysis_started), " | ".join(errors))
    raise AnalysisError(f"OpenRouter analysis failed for all configured models: {' | '.join(errors)}", 502)


def _emit_status(status_callback: StatusCallback | None, message: str, progress_pct: int) -> None:
    if not status_callback:
        return
    try:
        status_callback(message, max(0, min(progress_pct, 100)))
    except Exception as exc:
        LOGGER.warning("analysis.status_callback.failed error=%s", exc)


def _analyze_with_openrouter(
    file_bytes: bytes,
    content_type: str,
    filename: str,
    model_id: str,
    timeout: int,
) -> dict[str, Any]:
    api_key = env_value("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise AnalysisError("OPENROUTER_API_KEY is required for floor-plan analysis.", 503)

    max_tokens = DEFAULT_OPENROUTER_MAX_TOKENS
    user_content = _openrouter_user_content(file_bytes, content_type, filename, model_id)
    request_stats = _openrouter_user_content_stats(user_content)

    messages = [
        {
            "role": "user",
            "content": user_content,
        },
    ]
    request_body = _openrouter_request_body(model_id, messages, max_tokens, "json_schema")
    response = _post_openrouter_request(api_key, request_body, model_id, filename, timeout, max_tokens, request_stats, "json_schema")
    first_error: str | None = None
    if response.status_code >= 400:
        first_error = _openrouter_http_error_message(response, model_id)
        if _should_retry_with_json_object(model_id, response):
            LOGGER.warning(
                "openrouter.request.retry_json_object model=%s status=%d error=%s",
                model_id,
                response.status_code,
                _compact_text_preview(response.text),
            )
            request_body = _openrouter_request_body(model_id, messages, max_tokens, "json_object")
            response = _post_openrouter_request(api_key, request_body, model_id, filename, timeout, max_tokens, request_stats, "json_object")

    if response.status_code >= 400:
        error = _openrouter_http_error_message(response, model_id)
        if first_error and first_error != error:
            error = f"{first_error}; retry with json_object failed: {error}"
        raise AnalysisError(error, 502)

    try:
        response_data = response.json()
    except json.JSONDecodeError as exc:
        raise AnalysisError(
            f"OpenRouter returned non-JSON HTTP response for model {model_id!r}: {_compact_text_preview(response.text)}",
            502,
        ) from exc

    content = _message_content(response_data)
    parsed = _extract_json(content)
    if not parsed:
        preview = _compact_text_preview(content)
        raise AnalysisError(f"OpenRouter returned a response that was not valid JSON. Response preview: {preview}", 502)

    parsed["modelId"] = response_data.get("model") or model_id
    return parsed


def _openrouter_request_body(
    model_id: str,
    messages: list[dict[str, Any]],
    max_tokens: int,
    response_format: OpenRouterResponseFormat,
) -> dict[str, Any]:
    return {
        "model": model_id,
        "messages": messages,
        "response_format": _openrouter_response_format(model_id, response_format),
        "max_tokens": max_tokens,
        "temperature": 0,
        "stream": False,
        **_openrouter_extra_body(model_id),
    }


def _openrouter_response_format(model_id: str, response_format: OpenRouterResponseFormat) -> dict[str, Any]:
    if response_format == "json_object":
        return {"type": "json_object"}

    json_schema = {
        "name": "floor_plan_spatial_analysis",
        "schema": _analysis_schema_for_model(model_id),
    }
    if _use_strict_json_schema(model_id):
        json_schema["strict"] = True
    return {
        "type": "json_schema",
        "json_schema": json_schema,
    }


def _post_openrouter_request(
    api_key: str,
    request_body: dict[str, Any],
    model_id: str,
    filename: str,
    timeout: int,
    max_tokens: int,
    request_stats: dict[str, int],
    response_format: OpenRouterResponseFormat,
) -> httpx.Response:
    request_started = time.perf_counter()
    LOGGER.info(
        "openrouter.request.start model=%s file=%s timeout_s=%d max_tokens=%d response_format=%s prompt_chars=%d image_chars=%d",
        model_id,
        filename,
        timeout,
        max_tokens,
        response_format,
        request_stats["prompt_chars"],
        request_stats["image_chars"],
    )
    try:
        response = httpx.post(
            OPENROUTER_CHAT_COMPLETIONS_URL,
            headers=_openrouter_headers(api_key),
            json=request_body,
            timeout=timeout,
        )
    except httpx.TimeoutException as exc:
        LOGGER.warning("openrouter.request.timeout model=%s duration_ms=%d", model_id, _elapsed_ms(request_started))
        raise AnalysisError(f"OpenRouter request timed out for model {model_id!r}.", 504) from exc
    except httpx.RequestError as exc:
        LOGGER.warning("openrouter.request.error model=%s duration_ms=%d error=%s", model_id, _elapsed_ms(request_started), exc)
        raise AnalysisError(f"OpenRouter request failed: {exc}", 502) from exc

    LOGGER.info(
        "openrouter.response.received model=%s status=%d duration_ms=%d response_bytes=%d response_format=%s",
        model_id,
        response.status_code,
        _elapsed_ms(request_started),
        len(response.content),
        response_format,
    )
    return response


def _openrouter_http_error_message(response: httpx.Response, model_id: str) -> str:
    return f"OpenRouter request failed with HTTP {response.status_code} for model {model_id!r} at {response.url}: {response.text}"


def _should_retry_with_json_object(model_id: str, response: httpx.Response) -> bool:
    if response.status_code != 400 or not _use_compact_schema(model_id):
        return False

    error_text = response.text.lower()
    return "invalid_argument" in error_text or "invalid argument" in error_text


def _openrouter_model_sequence() -> list[str]:
    model_id = (
        env_value("OPENROUTER_MODEL", "").strip()
        or env_value("OPENROUTER_MODEL_ID", "").strip()
        or DEFAULT_OPENROUTER_MODEL
    )
    return [model_id]


def _openrouter_timeout(_model_index: int) -> int:
    return DEFAULT_OPENROUTER_TIMEOUT_SECONDS


def _openrouter_user_content(
    file_bytes: bytes,
    content_type: str,
    filename: str,
    model_id: str,
) -> str | list[dict[str, Any]]:
    normalized = _normalized_content_type(content_type, filename)
    LOGGER.info(
        "analysis.input.prepare file=%s model=%s content_type=%s normalized_content_type=%s size_bytes=%d",
        filename,
        model_id,
        content_type or "application/octet-stream",
        normalized,
        len(file_bytes),
    )
    image_reference = _openrouter_image_reference(file_bytes, normalized)
    prompt = _analysis_prompt(filename)

    return [
        {
            "type": "text",
            "text": prompt,
        },
        {
            "type": "image_url",
            "image_url": {
                "url": image_reference,
            },
        },
    ]


def _openrouter_image_reference(
    file_bytes: bytes,
    content_type: str,
) -> str:
    if content_type == "application/pdf":
        render_started = time.perf_counter()
        LOGGER.info("analysis.pdf_render.start size_bytes=%d", len(file_bytes))
        converted_bytes = _pdf_to_jpeg(file_bytes)
        LOGGER.info(
            "analysis.pdf_render.done duration_ms=%d image_bytes=%d",
            _elapsed_ms(render_started),
            len(converted_bytes),
        )
        return _openrouter_image_reference(converted_bytes, "image/jpeg")

    if not content_type.startswith("image/"):
        raise AnalysisError("Upload a PNG, JPEG, or PDF floor plan.", 422)

    encoded = base64.b64encode(file_bytes).decode("ascii")
    LOGGER.info("analysis.image_encoded content_type=%s image_bytes=%d data_url_chars=%d", content_type, len(file_bytes), len(encoded))
    return f"data:{content_type};base64,{encoded}"


def _openrouter_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Title": DEFAULT_OPENROUTER_APP_TITLE,
    }


def _openrouter_extra_body(model_id: str) -> dict[str, Any]:
    body: dict[str, Any] = {
        "provider": {
            "require_parameters": True,
            "sort": "throughput",
            "preferred_max_latency": {
                "p90": 20,
            },
        },
    }
    if _use_reasoning_control(model_id):
        body["reasoning"] = {
            "effort": "low",
            "exclude": True,
        }
    return body


def _use_reasoning_control(model_id: str) -> bool:
    normalized = model_id.lower()
    return (
        "gemini-2.5" in normalized
        or "gemini-3" in normalized
    )


def _use_strict_json_schema(model_id: str) -> bool:
    return not _use_compact_schema(model_id)


def _analysis_from_payload(
    payload: dict[str, Any],
    plan_id: str,
    filename: str,
    content_type: str,
) -> PlanAnalysis:
    normalized_payload = _normalize_analysis_payload(payload, filename)
    clean_payload = {
        **normalized_payload,
        "id": plan_id,
        "sourceFile": filename,
        "contentType": content_type or "application/octet-stream",
        "processingMode": "openrouter",
        "modelId": payload.get("modelId"),
    }
    _finalize_geometry_payload(clean_payload)

    try:
        analysis = PlanAnalysis.model_validate(clean_payload)
    except ValidationError as exc:
        raise AnalysisError(
            f"OpenRouter analysis did not match the spatial contract: {_validation_error_message(exc)}",
            502,
        ) from exc

    if len(analysis.rooms) != analysis.metrics.room_count:
        raise AnalysisError("OpenRouter analysis room count did not match returned room list.", 502)

    return analysis


def _finalize_geometry_payload(clean_payload: dict[str, Any]) -> None:
    clean_payload["openings"] = _normalize_openings(clean_payload.get("openings"))
    clean_payload["fixtures"] = _normalize_fixtures(clean_payload.get("fixtures"))

    rooms = clean_payload.get("rooms")
    if not isinstance(rooms, list):
        return

    clean_payload["floorPlate"] = _normalize_polygon(clean_payload.get("floorPlate") or clean_payload.get("floor_plate")) or _floor_plate_from_rooms(rooms)
    clean_payload["spaces"] = _normalize_spaces(clean_payload.get("spaces"), rooms)
    walls = _normalize_walls(clean_payload.get("walls"))
    if len(walls) < max(4, min(len(clean_payload["spaces"]), 8)):
        walls = _walls_from_geometry(clean_payload["floorPlate"], clean_payload["spaces"])
    clean_payload["walls"] = walls
    if not clean_payload["openings"]:
        clean_payload["openings"] = _openings_from_space_adjacency(clean_payload["spaces"])
    clean_payload["labels"] = _merge_labels(_normalize_labels(clean_payload.get("labels"), rooms), _labels_from_spaces(clean_payload["spaces"]))


def _analysis_sanity_issues(analysis: PlanAnalysis, payload: dict[str, Any]) -> list[str]:
    issues: list[str] = []

    if not analysis.rooms:
        issues.append("no rooms extracted")

    if isinstance(payload.get("rooms"), list) and not _payload_has_space_geometry(payload):
        issues.extend(_payload_dimension_issues(payload))
    issues.extend(_analysis_dimension_issues(analysis))
    issues.extend(_analysis_confidence_issues(analysis))
    issues.extend(_analysis_room_overlap_issues(analysis))
    issues.extend(_analysis_furniture_bounds_issues(analysis))
    issues.extend(_analysis_geometry_issues(analysis, payload))

    return issues


def _payload_has_space_geometry(payload: dict[str, Any]) -> bool:
    spaces = payload.get("spaces")
    if not isinstance(spaces, list):
        return False
    return any(isinstance(space, dict) and len(_normalize_polygon(space.get("polygon"))) >= 3 for space in spaces)


def _analysis_geometry_issues(analysis: PlanAnalysis, payload: dict[str, Any]) -> list[str]:
    geometry_keys = {"floorPlate", "floor_plate", "spaces", "walls", "openings", "fixtures", "labels"}
    if not any(key in payload for key in geometry_keys):
        return []

    issues: list[str] = []
    if len(analysis.floor_plate) < 3:
        issues.append("missing floor plate polygon")
    if len(analysis.spaces) < len(analysis.rooms):
        issues.append(f"space extraction incomplete: {len(analysis.spaces)} spaces for {len(analysis.rooms)} rooms")
    if len(analysis.rooms) > 1 and not analysis.openings:
        issues.append("no doors, windows, or openings extracted")
    return issues


def _payload_dimension_issues(payload: dict[str, Any]) -> list[str]:
    rooms = payload.get("rooms")
    if not isinstance(rooms, list):
        return ["rooms field missing or invalid"]

    missing_count = 0
    for room in rooms:
        if not isinstance(room, dict):
            continue
        if not _has_number(room, ["areaSqm", "area_sqm", "area"]):
            missing_count += 1
            continue
        if not _has_number(room, ["widthM", "width_m", "width"]):
            missing_count += 1
            continue
        if not _has_number(room, ["depthM", "depth_m", "depth"]):
            missing_count += 1
            continue
        if not _has_number(room, ["xM", "x_m", "x"]):
            missing_count += 1
            continue
        if not _has_number(room, ["yM", "y_m", "y"]):
            missing_count += 1

    if missing_count:
        return [f"{missing_count} rooms missing required dimensions or coordinates"]
    return []


def _analysis_dimension_issues(analysis: PlanAnalysis) -> list[str]:
    issues: list[str] = []
    if not _is_positive_finite(analysis.total_area_sqm):
        issues.append("missing total area")

    for room in analysis.rooms:
        if not _is_positive_finite(room.area_sqm):
            issues.append(f"{room.name} missing area")
        if not _is_positive_finite(room.width_m) or not _is_positive_finite(room.depth_m):
            issues.append(f"{room.name} missing dimensions")
        if not _is_finite(room.x_m) or not _is_finite(room.y_m):
            issues.append(f"{room.name} missing coordinates")

    return issues


def _analysis_confidence_issues(analysis: PlanAnalysis) -> list[str]:
    if not analysis.rooms:
        return []

    confidences = [room.confidence for room in analysis.rooms]
    average_confidence = sum(confidences) / len(confidences)
    low_confidence_rooms = [room.name for room in analysis.rooms if room.confidence < MIN_ROOM_CONFIDENCE]
    issues = []
    if average_confidence < MIN_AVERAGE_ROOM_CONFIDENCE:
        issues.append(f"average room confidence {average_confidence:.2f} below {MIN_AVERAGE_ROOM_CONFIDENCE:.2f}")
    if low_confidence_rooms:
        issues.append(f"room confidence below {MIN_ROOM_CONFIDENCE:.2f}: {', '.join(low_confidence_rooms[:4])}")
    return issues


def _analysis_room_overlap_issues(analysis: PlanAnalysis) -> list[str]:
    if _has_room_linked_space_geometry(analysis):
        return []

    issues: list[str] = []
    for left_index, left in enumerate(analysis.rooms):
        for right in analysis.rooms[left_index + 1:]:
            overlap_width = min(left.x_m + left.width_m, right.x_m + right.width_m) - max(left.x_m, right.x_m)
            overlap_depth = min(left.y_m + left.depth_m, right.y_m + right.depth_m) - max(left.y_m, right.y_m)
            if overlap_width <= ROOM_OVERLAP_TOLERANCE_M or overlap_depth <= ROOM_OVERLAP_TOLERANCE_M:
                continue

            overlap_area = overlap_width * overlap_depth
            smaller_room_area = max(min(left.area_sqm, right.area_sqm), 0.001)
            overlap_ratio = overlap_area / smaller_room_area
            if overlap_area >= SEVERE_ROOM_OVERLAP_AREA_SQM or overlap_ratio >= SEVERE_ROOM_OVERLAP_RATIO:
                issues.append(f"{left.name} overlaps {right.name} by {overlap_area:.2f} sqm")

    return issues


def _has_room_linked_space_geometry(analysis: PlanAnalysis) -> bool:
    return any(len(space.polygon) >= 3 and space.linked_room_id for space in analysis.spaces)


def _analysis_furniture_bounds_issues(analysis: PlanAnalysis) -> list[str]:
    issues: list[str] = []
    for room in analysis.rooms:
        for item in room.furniture:
            if not _is_positive_finite(item.width_m) or not _is_positive_finite(item.depth_m):
                issues.append(f"{room.name} furniture {item.id} missing dimensions")
                continue
            outside = (
                item.x_m < room.x_m - FURNITURE_CLEARANCE_M
                or item.y_m < room.y_m - FURNITURE_CLEARANCE_M
                or item.x_m + item.width_m > room.x_m + room.width_m + FURNITURE_CLEARANCE_M
                or item.y_m + item.depth_m > room.y_m + room.depth_m + FURNITURE_CLEARANCE_M
            )
            if outside:
                issues.append(f"{room.name} furniture {item.id} outside room")

    return issues


def _is_positive_finite(value: float) -> bool:
    return _is_finite(value) and value > 0


def _is_finite(value: float) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def _normalize_analysis_payload(payload: dict[str, Any], filename: str) -> dict[str, Any]:
    clean_payload = dict(payload)
    rooms = clean_payload.get("rooms")

    if not _has_any(clean_payload, ["name"]):
        clean_payload["name"] = _plan_name_from_filename(filename)
    if not _has_any(clean_payload, ["buildingType", "building_type"]):
        clean_payload["buildingType"] = "Unknown building"
    if not _has_any(clean_payload, ["notes"]):
        clean_payload["notes"] = "Generated from the uploaded floor plan with inferred dimensions."

    has_total_area = _has_any(clean_payload, ["totalAreaSqm", "total_area_sqm"])
    if not has_total_area and isinstance(rooms, list):
        room_area_total = sum(_number_field(room, ["areaSqm", "area_sqm", "area"], 0) for room in rooms)
        if room_area_total > 0:
            clean_payload["totalAreaSqm"] = room_area_total

    if not isinstance(rooms, list):
        derived_rooms = _rooms_from_spaces(clean_payload.get("spaces"))
        if derived_rooms:
            clean_payload["rooms"] = derived_rooms
            rooms = derived_rooms

    space_geometries = _normalize_spaces(
        clean_payload.get("spaces"),
        rooms if isinstance(rooms, list) else [],
        fallback_to_rooms=False,
    )
    if space_geometries:
        clean_payload["spaces"] = space_geometries

    total_area = _number_field(clean_payload, ["totalAreaSqm", "total_area_sqm"], 0)
    if isinstance(rooms, list):
        clean_payload["rooms"] = _normalize_rooms(rooms, total_area, space_geometries)
        if not has_total_area:
            total_area = sum(_number_field(room, ["areaSqm", "area_sqm", "area"], 0) for room in clean_payload["rooms"])
            if total_area > 0:
                clean_payload["totalAreaSqm"] = total_area

    normalized_rooms = clean_payload.get("rooms")
    if isinstance(normalized_rooms, list):
        _normalize_geometry_payload(clean_payload, normalized_rooms)
        clean_payload["metrics"] = _normalize_metrics(clean_payload.get("metrics"), normalized_rooms, total_area)

    return clean_payload


def _normalize_geometry_payload(clean_payload: dict[str, Any], rooms: list[Any]) -> None:
    floor_plate = _normalize_polygon(clean_payload.get("floorPlate") or clean_payload.get("floor_plate"))
    clean_payload["floorPlate"] = floor_plate or _floor_plate_from_rooms(rooms)
    spaces = _normalize_spaces(clean_payload.get("spaces"), rooms)
    clean_payload["spaces"] = spaces
    walls = _normalize_walls(clean_payload.get("walls"))
    if len(walls) < max(4, min(len(spaces), 8)):
        walls = _walls_from_geometry(clean_payload["floorPlate"], spaces)
    clean_payload["walls"] = walls
    clean_payload["openings"] = _normalize_openings(clean_payload.get("openings"))
    if not clean_payload["openings"]:
        clean_payload["openings"] = _openings_from_space_adjacency(spaces)
    clean_payload["fixtures"] = _normalize_fixtures(clean_payload.get("fixtures"))
    clean_payload["labels"] = _merge_labels(_normalize_labels(clean_payload.get("labels"), rooms), _labels_from_spaces(spaces))


def _rooms_from_spaces(spaces: Any) -> list[dict[str, Any]]:
    if not isinstance(spaces, list):
        return []

    rooms: list[dict[str, Any]] = []
    for index, raw_space in enumerate(spaces):
        if not isinstance(raw_space, dict):
            continue
        label = str(raw_space.get("label") or raw_space.get("name") or raw_space.get("text") or "").strip()
        if not label:
            continue
        polygon = _normalize_polygon(raw_space.get("polygon"))
        if len(polygon) < 3:
            continue
        min_x = min(point["xM"] for point in polygon)
        min_y = min(point["yM"] for point in polygon)
        max_x = max(point["xM"] for point in polygon)
        max_y = max(point["yM"] for point in polygon)
        width = max(0.4, max_x - min_x)
        depth = max(0.4, max_y - min_y)
        area = _number_field(raw_space, ["areaSqm", "area_sqm", "area"], 0) or _polygon_area(polygon)
        rooms.append({
            "id": str(raw_space.get("linkedRoomId") or raw_space.get("linked_room_id") or raw_space.get("id") or _slug_id(label, index)),
            "name": label,
            "type": _normalize_room_type(str(raw_space.get("type") or label)),
            "areaSqm": max(0.2, area),
            "widthM": width,
            "depthM": depth,
            "xM": min_x,
            "yM": min_y,
            "confidence": _clamp(_number_value(raw_space, ["confidence"], 0.72), 0, 1),
            "furniture": [],
        })

    return rooms


def _normalize_spaces(spaces: Any, rooms: list[Any], *, fallback_to_rooms: bool = True) -> list[dict[str, Any]]:
    normalized_spaces: list[dict[str, Any]] = []
    if isinstance(spaces, list):
        for index, raw_space in enumerate(spaces):
            if not isinstance(raw_space, dict):
                continue
            label = str(raw_space.get("label") or raw_space.get("name") or f"Space {index + 1}").strip()
            polygon = _normalize_polygon(raw_space.get("polygon"))
            if len(polygon) < 3:
                continue
            space_id = str(raw_space.get("id") or _slug_id(label, index)).strip()
            area = _number_field(raw_space, ["areaSqm", "area_sqm", "area"], 0) or _polygon_area(polygon)
            normalized_spaces.append({
                "id": space_id,
                "label": label or f"Space {index + 1}",
                "type": _normalize_space_type(str(raw_space.get("type") or raw_space.get("roomType") or label)),
                "polygon": polygon,
                "areaSqm": round(area, 3) if area > 0 else None,
                "confidence": _clamp(_number_value(raw_space, ["confidence"], 0.72), 0, 1),
                "linkedRoomId": raw_space.get("linkedRoomId") or raw_space.get("linked_room_id"),
            })

    if normalized_spaces:
        return normalized_spaces

    return _spaces_from_rooms(rooms) if fallback_to_rooms else []


def _normalize_walls(walls: Any) -> list[dict[str, Any]]:
    normalized_walls: list[dict[str, Any]] = []
    if not isinstance(walls, list):
        return normalized_walls

    for index, raw_wall in enumerate(walls):
        if not isinstance(raw_wall, dict):
            continue
        points = [_normalize_point(point) for point in raw_wall.get("points", []) if _normalize_point(point)]
        if len(points) < 2:
            continue
        normalized_walls.append({
            "id": str(raw_wall.get("id") or f"wall-{index + 1}"),
            "points": points,
            "thicknessM": _number_field(raw_wall, ["thicknessM", "thickness_m", "thickness"], 0.15),
            "heightM": _number_field(raw_wall, ["heightM", "height_m", "height"], 2.7),
            "confidence": _clamp(_number_value(raw_wall, ["confidence"], 0.72), 0, 1),
        })

    return normalized_walls


def _normalize_openings(openings: Any) -> list[dict[str, Any]]:
    normalized_openings: list[dict[str, Any]] = []
    if not isinstance(openings, list):
        return normalized_openings

    for index, raw_opening in enumerate(openings):
        if not isinstance(raw_opening, dict):
            continue
        kind = _normalize_opening_kind(str(raw_opening.get("kind") or raw_opening.get("type") or "opening"))
        width = _number_field(raw_opening, ["widthM", "width_m", "width"], 0)
        if width <= 0:
            continue
        normalized_openings.append({
            "id": str(raw_opening.get("id") or f"{kind}-{index + 1}"),
            "kind": kind,
            "xM": max(0.0, _number_value(raw_opening, ["xM", "x_m", "x"], 0)),
            "yM": max(0.0, _number_value(raw_opening, ["yM", "y_m", "y"], 0)),
            "widthM": width,
            "rotationDeg": _number_value(raw_opening, ["rotationDeg", "rotation_deg", "rotation"], 0),
            "swingDeg": raw_opening.get("swingDeg") if isinstance(raw_opening.get("swingDeg"), (int, float)) else raw_opening.get("swing_deg"),
            "wallId": raw_opening.get("wallId") or raw_opening.get("wall_id"),
            "confidence": _clamp(_number_value(raw_opening, ["confidence"], 0.72), 0, 1),
        })

    return normalized_openings


def _openings_from_space_adjacency(spaces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    boxes = []
    for space in spaces:
        polygon = _normalize_polygon(space.get("polygon"))
        if len(polygon) < 3:
            continue
        boxes.append({
            "id": str(space.get("id") or f"space-{len(boxes) + 1}"),
            "min_x": min(point["xM"] for point in polygon),
            "max_x": max(point["xM"] for point in polygon),
            "min_y": min(point["yM"] for point in polygon),
            "max_y": max(point["yM"] for point in polygon),
        })

    openings: list[dict[str, Any]] = []
    tolerance = 0.08
    min_overlap = 0.75
    for left_index, left in enumerate(boxes):
        for right in boxes[left_index + 1:]:
            if abs(left["max_x"] - right["min_x"]) <= tolerance or abs(right["max_x"] - left["min_x"]) <= tolerance:
                overlap_min = max(left["min_y"], right["min_y"])
                overlap_max = min(left["max_y"], right["max_y"])
                if overlap_max - overlap_min >= min_overlap:
                    x = left["max_x"] if abs(left["max_x"] - right["min_x"]) <= tolerance else right["max_x"]
                    openings.append(_derived_opening(len(openings), x, (overlap_min + overlap_max) / 2, 90))
            if abs(left["max_y"] - right["min_y"]) <= tolerance or abs(right["max_y"] - left["min_y"]) <= tolerance:
                overlap_min = max(left["min_x"], right["min_x"])
                overlap_max = min(left["max_x"], right["max_x"])
                if overlap_max - overlap_min >= min_overlap:
                    y = left["max_y"] if abs(left["max_y"] - right["min_y"]) <= tolerance else right["max_y"]
                    openings.append(_derived_opening(len(openings), (overlap_min + overlap_max) / 2, y, 0))
            if len(openings) >= 16:
                return openings

    return openings


def _derived_opening(index: int, x: float, y: float, rotation: float) -> dict[str, Any]:
    return {
        "id": f"derived-door-{index + 1}",
        "kind": "opening",
        "xM": round(max(0.0, x), 3),
        "yM": round(max(0.0, y), 3),
        "widthM": 0.85,
        "rotationDeg": rotation,
        "swingDeg": None,
        "wallId": None,
        "confidence": 0.55,
    }


def _normalize_fixtures(fixtures: Any) -> list[dict[str, Any]]:
    normalized_fixtures: list[dict[str, Any]] = []
    if not isinstance(fixtures, list):
        return normalized_fixtures

    for index, raw_fixture in enumerate(fixtures):
        if not isinstance(raw_fixture, dict):
            continue
        width = _number_field(raw_fixture, ["widthM", "width_m", "width"], 0)
        depth = _number_field(raw_fixture, ["depthM", "depth_m", "depth"], 0)
        if width <= 0 or depth <= 0:
            continue
        kind = _normalize_fixture_kind(str(raw_fixture.get("kind") or raw_fixture.get("type") or "fixture"))
        normalized_fixtures.append({
            "id": str(raw_fixture.get("id") or f"{kind}-{index + 1}"),
            "kind": kind,
            "xM": max(0.0, _number_value(raw_fixture, ["xM", "x_m", "x"], 0)),
            "yM": max(0.0, _number_value(raw_fixture, ["yM", "y_m", "y"], 0)),
            "widthM": width,
            "depthM": depth,
            "rotationDeg": _number_value(raw_fixture, ["rotationDeg", "rotation_deg", "rotation"], 0),
            "spaceId": raw_fixture.get("spaceId") or raw_fixture.get("space_id"),
            "confidence": _clamp(_number_value(raw_fixture, ["confidence"], 0.72), 0, 1),
        })

    return normalized_fixtures


def _normalize_labels(labels: Any, rooms: list[Any]) -> list[dict[str, Any]]:
    normalized_labels: list[dict[str, Any]] = []
    if isinstance(labels, list):
        for index, raw_label in enumerate(labels):
            if not isinstance(raw_label, dict):
                continue
            text = str(raw_label.get("text") or raw_label.get("label") or "").strip()
            if not text:
                continue
            normalized_labels.append({
                "id": str(raw_label.get("id") or _slug_id(text, index)),
                "text": text,
                "xM": max(0.0, _number_value(raw_label, ["xM", "x_m", "x"], 0)),
                "yM": max(0.0, _number_value(raw_label, ["yM", "y_m", "y"], 0)),
                "widthM": _optional_positive_number(raw_label, ["widthM", "width_m", "width"]),
                "depthM": _optional_positive_number(raw_label, ["depthM", "depth_m", "depth"]),
                "linkedSpaceId": raw_label.get("linkedSpaceId") or raw_label.get("linked_space_id"),
                "confidence": _clamp(_number_value(raw_label, ["confidence"], 0.72), 0, 1),
            })

    if normalized_labels:
        return normalized_labels

    return _labels_from_rooms(rooms)


def _normalize_polygon(value: Any) -> list[dict[str, float]]:
    if not isinstance(value, list):
        return []
    points = []
    for raw_point in value:
        point = _normalize_point(raw_point)
        if point:
            points.append(point)
    return points if len(points) >= 3 else []


def _normalize_point(value: Any) -> dict[str, float] | None:
    if isinstance(value, dict):
        if not _has_number(value, ["xM", "x_m", "x"]) or not _has_number(value, ["yM", "y_m", "y"]):
            return None
        return {
            "xM": round(max(0.0, _number_value(value, ["xM", "x_m", "x"], 0)), 3),
            "yM": round(max(0.0, _number_value(value, ["yM", "y_m", "y"], 0)), 3),
        }
    if isinstance(value, (list, tuple)) and len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
        return {"xM": round(max(0.0, float(value[0])), 3), "yM": round(max(0.0, float(value[1])), 3)}
    return None


def _spaces_from_rooms(rooms: list[Any]) -> list[dict[str, Any]]:
    spaces = []
    for index, room in enumerate(room for room in rooms if isinstance(room, dict)):
        name = str(room.get("name") or f"Room {index + 1}")
        polygon = _room_polygon(room)
        spaces.append({
            "id": str(room.get("id") or _slug_id(name, index)),
            "label": name,
            "type": _normalize_space_type(str(room.get("type") or name)),
            "polygon": polygon,
            "areaSqm": _number_field(room, ["areaSqm", "area_sqm", "area"], _polygon_area(polygon)),
            "confidence": _clamp(_number_value(room, ["confidence"], 0.72), 0, 1),
            "linkedRoomId": room.get("id"),
        })
    return spaces


def _labels_from_rooms(rooms: list[Any]) -> list[dict[str, Any]]:
    labels = []
    for index, room in enumerate(room for room in rooms if isinstance(room, dict)):
        name = str(room.get("name") or f"Room {index + 1}")
        x = _number_value(room, ["xM", "x_m", "x"], 0)
        y = _number_value(room, ["yM", "y_m", "y"], 0)
        width = _number_field(room, ["widthM", "width_m", "width"], 1)
        depth = _number_field(room, ["depthM", "depth_m", "depth"], 1)
        labels.append({
            "id": f"{_slug_id(name, index)}-label",
            "text": name,
            "xM": x + width / 2,
            "yM": y + depth / 2,
            "widthM": width,
            "depthM": depth,
            "linkedSpaceId": room.get("id"),
            "confidence": _clamp(_number_value(room, ["confidence"], 0.72), 0, 1),
        })
    return labels


def _labels_from_spaces(spaces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    labels = []
    for index, space in enumerate(spaces):
        label = str(space.get("label") or f"Space {index + 1}").strip()
        polygon = _normalize_polygon(space.get("polygon"))
        if not label or len(polygon) < 3:
            continue
        centroid = _polygon_centroid(polygon)
        labels.append({
            "id": f"{str(space.get('id') or _slug_id(label, index))}-label",
            "text": label,
            "xM": centroid["xM"],
            "yM": centroid["yM"],
            "widthM": None,
            "depthM": None,
            "linkedSpaceId": space.get("id"),
            "confidence": _clamp(_number_value(space, ["confidence"], 0.72), 0, 1),
        })
    return labels


def _merge_labels(explicit_labels: list[dict[str, Any]], fallback_labels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = list(explicit_labels)
    existing_links = {
        str(label.get("linkedSpaceId") or label.get("linked_space_id"))
        for label in merged
        if label.get("linkedSpaceId") or label.get("linked_space_id")
    }
    existing_text = {str(label.get("text") or "").strip().lower() for label in merged}
    for label in fallback_labels:
        linked_space_id = str(label.get("linkedSpaceId") or "")
        text = str(label.get("text") or "").strip().lower()
        if linked_space_id and linked_space_id in existing_links:
            continue
        if text and text in existing_text:
            continue
        merged.append(label)
    return merged


def _walls_from_geometry(floor_plate: list[dict[str, float]], spaces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    walls: list[dict[str, Any]] = []
    seen_edges: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    polygons: list[tuple[str, list[dict[str, float]]]] = []
    if len(floor_plate) >= 3:
        polygons.append(("floor-plate", floor_plate))
    for space in spaces:
        polygon = _normalize_polygon(space.get("polygon"))
        if len(polygon) >= 3:
            polygons.append((str(space.get("id") or "space"), polygon))

    for polygon_id, polygon in polygons:
        for index, start in enumerate(polygon):
            end = polygon[(index + 1) % len(polygon)]
            key = _edge_key(start, end)
            if key in seen_edges:
                continue
            seen_edges.add(key)
            walls.append({
                "id": f"wall-{polygon_id}-{index + 1}",
                "points": [start, end],
                "thicknessM": 0.15,
                "heightM": 2.7,
                "confidence": 0.66,
            })
    return walls


def _edge_key(start: dict[str, float], end: dict[str, float]) -> tuple[tuple[float, float], tuple[float, float]]:
    a = (round(start["xM"], 2), round(start["yM"], 2))
    b = (round(end["xM"], 2), round(end["yM"], 2))
    return (a, b) if a <= b else (b, a)


def _floor_plate_from_rooms(rooms: list[Any]) -> list[dict[str, float]]:
    usable_rooms = [room for room in rooms if isinstance(room, dict)]
    if not usable_rooms:
        return []
    min_x = min(_number_value(room, ["xM", "x_m", "x"], 0) for room in usable_rooms)
    min_y = min(_number_value(room, ["yM", "y_m", "y"], 0) for room in usable_rooms)
    max_x = max(_number_value(room, ["xM", "x_m", "x"], 0) + _number_field(room, ["widthM", "width_m", "width"], 1) for room in usable_rooms)
    max_y = max(_number_value(room, ["yM", "y_m", "y"], 0) + _number_field(room, ["depthM", "depth_m", "depth"], 1) for room in usable_rooms)
    return [
        {"xM": round(min_x, 3), "yM": round(min_y, 3)},
        {"xM": round(max_x, 3), "yM": round(min_y, 3)},
        {"xM": round(max_x, 3), "yM": round(max_y, 3)},
        {"xM": round(min_x, 3), "yM": round(max_y, 3)},
    ]


def _room_polygon(room: dict[str, Any]) -> list[dict[str, float]]:
    x = _number_value(room, ["xM", "x_m", "x"], 0)
    y = _number_value(room, ["yM", "y_m", "y"], 0)
    width = _number_field(room, ["widthM", "width_m", "width"], 1)
    depth = _number_field(room, ["depthM", "depth_m", "depth"], 1)
    return [
        {"xM": round(x, 3), "yM": round(y, 3)},
        {"xM": round(x + width, 3), "yM": round(y, 3)},
        {"xM": round(x + width, 3), "yM": round(y + depth, 3)},
        {"xM": round(x, 3), "yM": round(y + depth, 3)},
    ]


def _polygon_area(points: list[dict[str, float]]) -> float:
    if len(points) < 3:
        return 0
    total = 0.0
    for index, point in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        total += point["xM"] * next_point["yM"] - next_point["xM"] * point["yM"]
    return abs(total) / 2


def _polygon_centroid(points: list[dict[str, float]]) -> dict[str, float]:
    if len(points) < 3:
        return {"xM": 0.0, "yM": 0.0}

    signed_area = 0.0
    centroid_x = 0.0
    centroid_y = 0.0
    for index, point in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        cross = point["xM"] * next_point["yM"] - next_point["xM"] * point["yM"]
        signed_area += cross
        centroid_x += (point["xM"] + next_point["xM"]) * cross
        centroid_y += (point["yM"] + next_point["yM"]) * cross

    if abs(signed_area) < 0.0001:
        return {
            "xM": sum(point["xM"] for point in points) / len(points),
            "yM": sum(point["yM"] for point in points) / len(points),
        }

    return {"xM": centroid_x / (3 * signed_area), "yM": centroid_y / (3 * signed_area)}


def _polygon_bounds(points: list[dict[str, float]]) -> dict[str, float] | None:
    if len(points) < 3:
        return None
    min_x = min(point["xM"] for point in points)
    min_y = min(point["yM"] for point in points)
    max_x = max(point["xM"] for point in points)
    max_y = max(point["yM"] for point in points)
    return {
        "min_x": round(min_x, 3),
        "min_y": round(min_y, 3),
        "max_x": round(max_x, 3),
        "max_y": round(max_y, 3),
        "width": round(max_x - min_x, 3),
        "depth": round(max_y - min_y, 3),
    }


def _optional_positive_number(value: Any, keys: list[str]) -> float | None:
    parsed = _number_field(value, keys, 0)
    return parsed if parsed > 0 else None


def _normalize_space_type(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    aliases = {
        "walk_in_closet": "closet",
        "walkin_closet": "closet",
        "wic": "closet",
        "closet": "closet",
        "mechanical": "mechanical",
        "mech": "mechanical",
        "entry": "hallway",
        "corridor_entry": "hallway",
    }
    room_type = _normalize_room_type(normalized)
    if room_type != "storage" or normalized in {"storage", "store"}:
        return room_type
    return aliases.get(normalized, normalized or "unknown")


def _normalize_opening_kind(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    if "door" in normalized:
        return "door"
    if "window" in normalized or normalized in {"glazing", "glass"}:
        return "window"
    return "opening"


def _normalize_fixture_kind(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    if "closet" in normalized and ("shelf" in normalized or "shelving" in normalized):
        return "closet-shelving"
    if normalized in {"island", "kitchen_island"}:
        return "island"
    kind = _normalize_furniture_kind(normalized, "storage")
    return kind if kind != "storage" else normalized.replace("_", "-") or "fixture"


def _matching_space_for_room(
    room: dict[str, Any],
    spaces: list[dict[str, Any]],
    matched_space_ids: set[str],
) -> dict[str, Any] | None:
    if not spaces:
        return None

    room_id = str(room.get("id") or "").strip()
    room_name = str(room.get("name") or "").strip()
    room_tokens = {_geometry_match_token(room_id), _geometry_match_token(room_name)}
    room_tokens.discard("")

    candidates = [space for space in spaces if str(space.get("id") or "") not in matched_space_ids]
    for space in candidates:
        if str(space.get("linkedRoomId") or space.get("linked_room_id") or "").strip() == room_id:
            return space

    for space in candidates:
        if _geometry_match_token(str(space.get("id") or "")) in room_tokens:
            return space

    for space in candidates:
        if _geometry_match_token(str(space.get("label") or "")) in room_tokens:
            return space

    return None


def _geometry_match_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def _normalize_rooms(rooms: list[Any], total_area_sqm: float, space_geometries: list[dict[str, Any]] | None = None) -> list[Any]:
    normalized_rooms = []
    matched_space_ids: set[str] = set()
    cursor_x = 0.0
    cursor_y = 0.0
    row_height = 0.0
    row_width_limit = max(8.0, (total_area_sqm ** 0.5) * 1.6) if total_area_sqm > 0 else 14.0

    for index, raw_room in enumerate(rooms):
        if not isinstance(raw_room, dict):
            normalized_rooms.append(raw_room)
            continue

        room = dict(raw_room)
        name = str(room.get("name") or f"Room {index + 1}")
        if not isinstance(room.get("id"), str) or not room["id"].strip():
            room["id"] = _slug_id(name, index)
        if not isinstance(room.get("name"), str) or not room["name"].strip():
            room["name"] = name
        if not _has_any(room, ["type"]):
            room["type"] = _infer_room_type(name)
        else:
            room["type"] = _normalize_room_type(str(room["type"]))

        matched_space = _matching_space_for_room(room, space_geometries or [], matched_space_ids)
        if matched_space:
            matched_space_ids.add(str(matched_space.get("id") or ""))
            if not matched_space.get("linkedRoomId"):
                matched_space["linkedRoomId"] = room["id"]
            bounds = _polygon_bounds(_normalize_polygon(matched_space.get("polygon")))
            if bounds:
                area_from_space = _number_field(matched_space, ["areaSqm", "area_sqm", "area"], 0) or _polygon_area(_normalize_polygon(matched_space.get("polygon")))
                room["xM"] = bounds["min_x"]
                room["yM"] = bounds["min_y"]
                room["widthM"] = max(0.4, bounds["width"])
                room["depthM"] = max(0.4, bounds["depth"])
                room["areaSqm"] = max(0.2, area_from_space)
                room["_geometrySource"] = "space"

        width = _number_field(room, ["widthM", "width_m", "width"], 0)
        depth = _number_field(room, ["depthM", "depth_m", "depth"], 0)
        area = _number_field(room, ["areaSqm", "area_sqm", "area"], 0)

        if width <= 0 and depth > 0 and area > 0:
            width = area / depth
        if depth <= 0 and width > 0 and area > 0:
            depth = area / width
        if width <= 0 and depth <= 0 and area > 0:
            width = max(2.0, area ** 0.5)
            depth = max(2.0, area / width)

        width = max(width, 0.4)
        depth = max(depth, 0.4)

        if cursor_x > 0 and cursor_x + width > row_width_limit:
            cursor_x = 0.0
            cursor_y += row_height
            row_height = 0.0

        if not _has_any(room, ["areaSqm", "area_sqm"]):
            room["areaSqm"] = area if area > 0 else width * depth
        if not _has_any(room, ["widthM", "width_m"]):
            room["widthM"] = width
        if not _has_any(room, ["depthM", "depth_m"]):
            room["depthM"] = depth
        if not _has_any(room, ["xM", "x_m"]):
            room["xM"] = cursor_x
        if not _has_any(room, ["yM", "y_m"]):
            room["yM"] = cursor_y
        if not _has_any(room, ["confidence"]):
            room["confidence"] = 0.72
        source_x = max(0.0, _number_value(room, ["xM", "x_m", "x"], cursor_x))
        source_y = max(0.0, _number_value(room, ["yM", "y_m", "y"], cursor_y))
        room["_sourceXM"] = source_x
        room["_sourceYM"] = source_y
        room["_rawFurniture"] = room.get("furniture")
        room["xM"] = source_x
        room["yM"] = source_y
        room["widthM"] = width
        room["depthM"] = depth
        room["areaSqm"] = _number_field(room, ["areaSqm", "area_sqm", "area"], width * depth)
        room["furniture"] = []

        normalized_rooms.append(room)
        cursor_x += width
        row_height = max(row_height, depth)

    resolved_rooms = _resolve_room_overlaps(normalized_rooms, total_area_sqm, lock_space_geometry=bool(space_geometries))
    for room in resolved_rooms:
        if not isinstance(room, dict):
            continue
        raw_furniture = room.pop("_rawFurniture", None)
        source_x = _number_value(room, ["_sourceXM"], _number_value(room, ["xM", "x_m", "x"], 0))
        source_y = _number_value(room, ["_sourceYM"], _number_value(room, ["yM", "y_m", "y"], 0))
        room.pop("_sourceXM", None)
        room.pop("_sourceYM", None)
        room.pop("_geometrySource", None)
        room["furniture"] = _normalize_furniture(raw_furniture, room, source_x, source_y)

    return resolved_rooms


def _resolve_room_overlaps(rooms: list[Any], total_area_sqm: float, *, lock_space_geometry: bool = False) -> list[Any]:
    resolved_rooms: list[Any] = []
    for room in rooms:
        if not isinstance(room, dict):
            resolved_rooms.append(room)
            continue

        clean_room = dict(room)
        if lock_space_geometry and clean_room.get("_geometrySource") == "space":
            resolved_rooms.append(clean_room)
            continue

        width = _number_field(clean_room, ["widthM", "width_m", "width"], 1)
        depth = _number_field(clean_room, ["depthM", "depth_m", "depth"], 1)
        source_x = max(0.0, _number_value(clean_room, ["xM", "x_m", "x"], 0))
        source_y = max(0.0, _number_value(clean_room, ["yM", "y_m", "y"], 0))
        placed_rooms = [placed for placed in resolved_rooms if isinstance(placed, dict)]
        x, y = _room_position(source_x, source_y, width, depth, placed_rooms, total_area_sqm)
        clean_room["xM"] = x
        clean_room["yM"] = y
        resolved_rooms.append(clean_room)

    return resolved_rooms


def _room_position(
    source_x: float,
    source_y: float,
    width: float,
    depth: float,
    placed_rooms: list[dict[str, Any]],
    total_area_sqm: float,
) -> tuple[float, float]:
    if not placed_rooms:
        return round(source_x, 3), round(source_y, 3)

    if not _room_overlaps(source_x, source_y, width, depth, placed_rooms):
        return round(source_x, 3), round(source_y, 3)

    candidates = _room_position_candidates(source_x, source_y, width, depth, placed_rooms, total_area_sqm)
    valid_candidates = [
        candidate for candidate in candidates
        if not _room_overlaps(candidate[0], candidate[1], width, depth, placed_rooms)
    ]
    if valid_candidates:
        best_x, best_y = min(
            valid_candidates,
            key=lambda candidate: _room_position_score(candidate[0], candidate[1], source_x, source_y, width, depth, placed_rooms),
        )
        return round(best_x, 3), round(best_y, 3)

    max_y = max(_number_value(room, ["yM", "y_m", "y"], 0) + _number_field(room, ["depthM", "depth_m", "depth"], 1) for room in placed_rooms)
    return 0.0, round(max_y, 3)


def _room_position_candidates(
    source_x: float,
    source_y: float,
    width: float,
    depth: float,
    placed_rooms: list[dict[str, Any]],
    total_area_sqm: float,
) -> set[tuple[float, float]]:
    candidates: set[tuple[float, float]] = {(source_x, source_y), (0.0, 0.0)}
    x_values = {0.0, source_x}
    y_values = {0.0, source_y}

    for room in placed_rooms:
        room_x = _number_value(room, ["xM", "x_m", "x"], 0)
        room_y = _number_value(room, ["yM", "y_m", "y"], 0)
        room_width = _number_field(room, ["widthM", "width_m", "width"], 1)
        room_depth = _number_field(room, ["depthM", "depth_m", "depth"], 1)
        x_values.update({room_x, room_x + room_width, room_x + room_width - width, room_x - width})
        y_values.update({room_y, room_y + room_depth, room_y + room_depth - depth, room_y - depth})

    row_width_limit = max(8.0, math.sqrt(total_area_sqm) * 1.6 if total_area_sqm > 0 else 14.0)
    max_x = max(_number_value(room, ["xM", "x_m", "x"], 0) + _number_field(room, ["widthM", "width_m", "width"], 1) for room in placed_rooms)
    max_y = max(_number_value(room, ["yM", "y_m", "y"], 0) + _number_field(room, ["depthM", "depth_m", "depth"], 1) for room in placed_rooms)
    x_values.update({max_x, max(0.0, row_width_limit - width)})
    y_values.add(max_y)

    for x in x_values:
        for y in y_values:
            if x >= 0 and y >= 0:
                candidates.add((round(x, 3), round(y, 3)))

    return candidates


def _room_position_score(
    x: float,
    y: float,
    source_x: float,
    source_y: float,
    width: float,
    depth: float,
    placed_rooms: list[dict[str, Any]],
) -> float:
    distance = math.hypot(x - source_x, y - source_y)
    shared_edge = 0.0
    for room in placed_rooms:
        room_x = _number_value(room, ["xM", "x_m", "x"], 0)
        room_y = _number_value(room, ["yM", "y_m", "y"], 0)
        room_width = _number_field(room, ["widthM", "width_m", "width"], 1)
        room_depth = _number_field(room, ["depthM", "depth_m", "depth"], 1)
        if abs(x + width - room_x) <= ROOM_OVERLAP_TOLERANCE_M or abs(room_x + room_width - x) <= ROOM_OVERLAP_TOLERANCE_M:
            shared_edge += max(0.0, min(y + depth, room_y + room_depth) - max(y, room_y))
        if abs(y + depth - room_y) <= ROOM_OVERLAP_TOLERANCE_M or abs(room_y + room_depth - y) <= ROOM_OVERLAP_TOLERANCE_M:
            shared_edge += max(0.0, min(x + width, room_x + room_width) - max(x, room_x))

    return distance - min(shared_edge * 0.2, 1.5)


def _room_overlaps(x: float, y: float, width: float, depth: float, placed_rooms: list[dict[str, Any]]) -> bool:
    for room in placed_rooms:
        room_x = _number_value(room, ["xM", "x_m", "x"], 0)
        room_y = _number_value(room, ["yM", "y_m", "y"], 0)
        room_width = _number_field(room, ["widthM", "width_m", "width"], 1)
        room_depth = _number_field(room, ["depthM", "depth_m", "depth"], 1)
        overlap_width = min(x + width, room_x + room_width) - max(x, room_x)
        overlap_depth = min(y + depth, room_y + room_depth) - max(y, room_y)
        if overlap_width > ROOM_OVERLAP_TOLERANCE_M and overlap_depth > ROOM_OVERLAP_TOLERANCE_M:
            return True
    return False


def _normalize_furniture(
    furniture: Any,
    room: dict[str, Any],
    source_room_x: float | None = None,
    source_room_y: float | None = None,
) -> list[Any]:
    if not isinstance(furniture, list) or not furniture:
        return _resolve_furniture_overlaps(_fallback_furniture(room), room)

    normalized_items = []
    for index, raw_item in enumerate(furniture):
        if not isinstance(raw_item, dict):
            continue

        item = dict(raw_item)
        room_type = _normalize_room_type(str(room.get("type") or "storage"))
        room_name = str(room.get("name") or "")
        room_x = _number_value(room, ["xM", "x_m", "x"], 0)
        room_y = _number_value(room, ["yM", "y_m", "y"], 0)
        room_width = max(0.5, _number_value(room, ["widthM", "width_m", "width"], 1))
        room_depth = max(0.5, _number_value(room, ["depthM", "depth_m", "depth"], 1))
        original_room_x = room_x if source_room_x is None else source_room_x
        original_room_y = room_y if source_room_y is None else source_room_y

        if not isinstance(item.get("id"), str) or not item["id"].strip():
            item["id"] = f"furniture-{index + 1}"
        if not isinstance(item.get("kind"), str) or not item["kind"].strip():
            item["kind"] = "furniture"
        item["kind"] = _normalize_furniture_kind(item["kind"], room_type, room_name)
        width = _number_field(item, ["widthM", "width_m", "width"], min(0.8, room_width * 0.6))
        depth = _number_field(item, ["depthM", "depth_m", "depth"], min(0.8, room_depth * 0.6))
        width = _clamp(width, 0.25, max(0.25, room_width - 0.16))
        depth = _clamp(depth, 0.25, max(0.25, room_depth - 0.16))

        raw_x = _number_value(item, ["xM", "x_m", "x"], room_x + (room_width - width) / 2)
        raw_y = _number_value(item, ["yM", "y_m", "y"], room_y + (room_depth - depth) / 2)
        if _furniture_fits(original_room_x, original_room_y, room_width, room_depth, width, depth, raw_x, raw_y):
            raw_x += room_x - original_room_x
            raw_y += room_y - original_room_y
        x, y = _furniture_position(room_x, room_y, room_width, room_depth, width, depth, raw_x, raw_y)

        item["widthM"] = width
        item["depthM"] = depth
        item["xM"] = x
        item["yM"] = y
        item["rotationDeg"] = 0

        normalized_items.append(item)

    return _resolve_furniture_overlaps(normalized_items, room) or _resolve_furniture_overlaps(_fallback_furniture(room), room)


def _fallback_furniture(room: dict[str, Any]) -> list[Any]:
    room_type = str(room.get("type") or "storage")
    if room_type == "hallway":
        return []

    builders = {
        "living_room": [
            ("sofa", "sofa", 0.58, 0.85, 0.12, 0.68),
            ("coffee-table", "coffee-table", 0.32, 0.62, 0.42, 0.46),
            ("media-console", "media-console", 0.46, 0.35, 0.34, 0.12),
        ],
        "bedroom": [
            ("bed", "bed", 0.58, 2.10, 0.12, 0.12),
            ("wardrobe", "wardrobe", 0.34, 0.55, 0.62, 0.08),
            ("nightstand", "nightstand", 0.18, 0.42, 0.72, 0.58),
        ],
        "kitchen": [
            ("counter", "counter", 0.72, 0.60, 0.08, 0.08),
            ("sink", "sink", 0.22, 0.48, 0.58, 0.10),
            ("prep-table", "table", 0.40, 0.72, 0.42, 0.58),
        ],
        "bathroom": [
            ("shower", "shower", 0.48, 1.00, 0.08, 0.08),
            ("vanity", "sink", 0.28, 0.48, 0.56, 0.12),
            ("toilet", "toilet", 0.22, 0.64, 0.62, 0.58),
        ],
        "dining_room": [
            ("dining-table", "dining-table", 0.54, 1.05, 0.50, 0.48),
            ("chair-1", "chair", 0.14, 0.42, 0.22, 0.48),
            ("chair-2", "chair", 0.14, 0.42, 0.78, 0.48),
        ],
        "office": [
            ("desk", "desk", 0.52, 0.72, 0.14, 0.16),
            ("office-chair", "office-chair", 0.18, 0.52, 0.42, 0.46),
            ("shelf", "shelf", 0.20, 0.52, 0.78, 0.18),
        ],
        "balcony": [
            ("outdoor-table", "table", 0.28, 0.72, 0.48, 0.42),
            ("outdoor-chair", "chair", 0.16, 0.44, 0.18, 0.46),
        ],
        "utility": [
            ("washer", "washer", 0.28, 0.68, 0.12, 0.12),
            ("utility-shelf", "shelf", 0.44, 0.42, 0.52, 0.14),
        ],
        "storage": [
            ("shelf", "shelf", 0.70, 0.44, 0.14, 0.12),
        ],
    }
    return [_fallback_item(room, *item) for item in builders.get(room_type, builders["storage"])]


def _fallback_item(
    room: dict[str, Any],
    suffix: str,
    kind: str,
    width_ratio: float,
    depth_m: float,
    x_ratio: float,
    y_ratio: float,
) -> dict[str, Any]:
    room_id = str(room.get("id") or "room")
    room_x = _number_value(room, ["xM", "x_m", "x"], 0)
    room_y = _number_value(room, ["yM", "y_m", "y"], 0)
    room_width = max(0.5, _number_value(room, ["widthM", "width_m", "width"], 1))
    room_depth = max(0.5, _number_value(room, ["depthM", "depth_m", "depth"], 1))
    width = _clamp(room_width * width_ratio, 0.28, max(0.28, room_width - 0.16))
    depth = _clamp(min(depth_m, room_depth * 0.72), 0.28, max(0.28, room_depth - 0.16))
    x = room_x + (room_width - width) * x_ratio
    y = room_y + (room_depth - depth) * y_ratio
    x, y = _furniture_position(room_x, room_y, room_width, room_depth, width, depth, x, y)
    return {
        "id": f"{room_id}-{suffix}",
        "kind": kind,
        "widthM": width,
        "depthM": depth,
        "xM": x,
        "yM": y,
        "rotationDeg": 0,
    }


def _furniture_position(
    room_x: float,
    room_y: float,
    room_width: float,
    room_depth: float,
    width: float,
    depth: float,
    raw_x: float,
    raw_y: float,
) -> tuple[float, float]:
    absolute_fits = (
        room_x - 0.05 <= raw_x <= room_x + room_width - width + 0.05
        and room_y - 0.05 <= raw_y <= room_y + room_depth - depth + 0.05
    )
    relative_x = room_x + raw_x
    relative_y = room_y + raw_y
    relative_fits = (
        0 <= raw_x <= room_width - width + 0.05
        and 0 <= raw_y <= room_depth - depth + 0.05
        and room_x - 0.05 <= relative_x <= room_x + room_width - width + 0.05
        and room_y - 0.05 <= relative_y <= room_y + room_depth - depth + 0.05
    )

    x = raw_x if absolute_fits else relative_x if relative_fits else raw_x
    y = raw_y if absolute_fits else relative_y if relative_fits else raw_y
    max_x = max(room_x + 0.08, room_x + room_width - width - 0.08)
    max_y = max(room_y + 0.08, room_y + room_depth - depth - 0.08)
    return _clamp(x, room_x + 0.08, max_x), _clamp(y, room_y + 0.08, max_y)


def _furniture_fits(
    room_x: float,
    room_y: float,
    room_width: float,
    room_depth: float,
    width: float,
    depth: float,
    x: float,
    y: float,
) -> bool:
    return (
        room_x - ROOM_OVERLAP_TOLERANCE_M <= x <= room_x + room_width - width + ROOM_OVERLAP_TOLERANCE_M
        and room_y - ROOM_OVERLAP_TOLERANCE_M <= y <= room_y + room_depth - depth + ROOM_OVERLAP_TOLERANCE_M
    )


def _resolve_furniture_overlaps(items: list[Any], room: dict[str, Any]) -> list[Any]:
    room_x = _number_value(room, ["xM", "x_m", "x"], 0)
    room_y = _number_value(room, ["yM", "y_m", "y"], 0)
    room_width = max(0.5, _number_value(room, ["widthM", "width_m", "width"], 1))
    room_depth = max(0.5, _number_value(room, ["depthM", "depth_m", "depth"], 1))
    placed_items: list[dict[str, Any]] = []

    for raw_item in items:
        if not isinstance(raw_item, dict):
            continue
        item = dict(raw_item)
        width = _number_field(item, ["widthM", "width_m", "width"], min(0.8, room_width * 0.6))
        depth = _number_field(item, ["depthM", "depth_m", "depth"], min(0.8, room_depth * 0.6))
        width = _clamp(width, 0.25, max(0.25, room_width - 0.16))
        depth = _clamp(depth, 0.25, max(0.25, room_depth - 0.16))
        x, y = _furniture_position(
            room_x,
            room_y,
            room_width,
            room_depth,
            width,
            depth,
            _number_value(item, ["xM", "x_m", "x"], room_x + (room_width - width) / 2),
            _number_value(item, ["yM", "y_m", "y"], room_y + (room_depth - depth) / 2),
        )

        if _furniture_overlaps(x, y, width, depth, placed_items):
            candidate = _furniture_position_candidate(x, y, width, depth, room_x, room_y, room_width, room_depth, placed_items)
            if candidate is None:
                continue
            x, y = candidate

        item["widthM"] = width
        item["depthM"] = depth
        item["xM"] = round(x, 3)
        item["yM"] = round(y, 3)
        item["rotationDeg"] = 0
        placed_items.append(item)

    return placed_items


def _furniture_position_candidate(
    source_x: float,
    source_y: float,
    width: float,
    depth: float,
    room_x: float,
    room_y: float,
    room_width: float,
    room_depth: float,
    placed_items: list[dict[str, Any]],
) -> tuple[float, float] | None:
    min_x = room_x + FURNITURE_CLEARANCE_M
    min_y = room_y + FURNITURE_CLEARANCE_M
    max_x = max(min_x, room_x + room_width - width - FURNITURE_CLEARANCE_M)
    max_y = max(min_y, room_y + room_depth - depth - FURNITURE_CLEARANCE_M)
    x_values = {source_x, min_x, max_x, room_x + (room_width - width) / 2}
    y_values = {source_y, min_y, max_y, room_y + (room_depth - depth) / 2}

    for item in placed_items:
        item_x = _number_value(item, ["xM", "x_m", "x"], room_x)
        item_y = _number_value(item, ["yM", "y_m", "y"], room_y)
        item_width = _number_field(item, ["widthM", "width_m", "width"], 0.25)
        item_depth = _number_field(item, ["depthM", "depth_m", "depth"], 0.25)
        x_values.update({item_x - width - FURNITURE_CLEARANCE_M, item_x + item_width + FURNITURE_CLEARANCE_M})
        y_values.update({item_y - depth - FURNITURE_CLEARANCE_M, item_y + item_depth + FURNITURE_CLEARANCE_M})

    candidates = [
        (_clamp(x, min_x, max_x), _clamp(y, min_y, max_y))
        for x in x_values
        for y in y_values
    ]
    valid_candidates = [
        candidate for candidate in candidates
        if not _furniture_overlaps(candidate[0], candidate[1], width, depth, placed_items)
    ]
    if not valid_candidates:
        return None

    return min(valid_candidates, key=lambda candidate: math.hypot(candidate[0] - source_x, candidate[1] - source_y))


def _furniture_overlaps(x: float, y: float, width: float, depth: float, placed_items: list[dict[str, Any]]) -> bool:
    for item in placed_items:
        item_x = _number_value(item, ["xM", "x_m", "x"], 0)
        item_y = _number_value(item, ["yM", "y_m", "y"], 0)
        item_width = _number_field(item, ["widthM", "width_m", "width"], 0.25)
        item_depth = _number_field(item, ["depthM", "depth_m", "depth"], 0.25)
        if (
            x < item_x + item_width + FURNITURE_CLEARANCE_M
            and x + width + FURNITURE_CLEARANCE_M > item_x
            and y < item_y + item_depth + FURNITURE_CLEARANCE_M
            and y + depth + FURNITURE_CLEARANCE_M > item_y
        ):
            return True
    return False


def _normalize_metrics(metrics: Any, rooms: list[Any], total_area_sqm: float) -> dict[str, Any]:
    normalized_metrics = dict(metrics) if isinstance(metrics, dict) else {}
    usable_rooms = [room for room in rooms if isinstance(room, dict)]
    room_count = len(usable_rooms)
    room_area_total = sum(_number_field(room, ["areaSqm", "area_sqm", "area"], 0) for room in usable_rooms)
    wall_length = sum(
        2 * (_number_field(room, ["widthM", "width_m", "width"], 0) + _number_field(room, ["depthM", "depth_m", "depth"], 0))
        for room in usable_rooms
    )

    normalized_metrics["roomCount"] = room_count
    if not _has_any(normalized_metrics, ["circulationAreaSqm", "circulation_area_sqm"]):
        normalized_metrics["circulationAreaSqm"] = max(total_area_sqm - room_area_total, room_area_total * 0.12, 0)
    if not _has_any(normalized_metrics, ["estimatedWallLengthM", "estimated_wall_length_m"]):
        normalized_metrics["estimatedWallLengthM"] = max(wall_length, 1)
    if not _has_any(normalized_metrics, ["furnitureFitScore", "furniture_fit_score"]):
        normalized_metrics["furnitureFitScore"] = 70
    if not _has_any(normalized_metrics, ["sightlineScore", "sightline_score"]):
        normalized_metrics["sightlineScore"] = 70

    return normalized_metrics


def _message_content(response_data: dict[str, Any]) -> str:
    error = response_data.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("detail") or json.dumps(error, separators=(",", ":"))
        raise AnalysisError(f"OpenRouter returned an error response: {message}", 502)

    choices = response_data.get("choices")
    if not isinstance(choices, list) or not choices:
        response_keys = ", ".join(sorted(response_data.keys())) or "none"
        raise AnalysisError(f"OpenRouter response did not include choices. Response keys: {response_keys}.", 502)

    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        raise AnalysisError("OpenRouter response did not include an assistant message.", 502)

    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("text"))
    return ""


def _extract_json(text: str) -> dict[str, Any] | None:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass

    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def _compact_text_preview(text: str, limit: int = 240) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if not compact:
        return "<empty>"
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit]}..."


def _normalized_content_type(content_type: str, filename: str) -> str:
    token = (content_type or "").split(";")[0].strip().lower()
    lower_name = filename.lower()
    if token in {"image/png", "image/jpeg", "image/jpg", "application/pdf"}:
        return "image/jpeg" if token == "image/jpg" else token
    if lower_name.endswith(".png"):
        return "image/png"
    if lower_name.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower_name.endswith(".pdf"):
        return "application/pdf"
    return token or "application/octet-stream"


def render_pdf_first_page_jpeg(pdf_bytes: bytes, max_dimension: int = 2200, jpg_quality: int = 90) -> bytes:
    try:
        import pymupdf
    except ImportError as exc:
        raise AnalysisError("pymupdf is required for PDF floor plan analysis.", 500) from exc

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if doc.page_count == 0:
            raise AnalysisError("The uploaded PDF has no pages.", 422)
        page = doc[0]
        long_edge = max(page.rect.width, page.rect.height, 1)
        bounded_dimension = max(400, int(max_dimension))
        zoom = max(0.2, min(2.0, bounded_dimension / long_edge))
        mat = pymupdf.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        return pix.tobytes(output="jpeg", jpg_quality=max(1, min(100, int(jpg_quality))))
    finally:
        doc.close()


def _pdf_to_jpeg(pdf_bytes: bytes) -> bytes:
    max_dimension = int(env_value("PDF_RENDER_MAX_DIMENSION", "2200"))
    return render_pdf_first_page_jpeg(pdf_bytes, max_dimension=max_dimension, jpg_quality=90)


def _analysis_prompt(filename: str) -> str:
    return (
        "You are an expert architectural spatial-analysis engine. Return only the JSON object required by the floor-plan analysis contract. "
        "Never include markdown, commentary, or extra keys. "
        f"Analyze the uploaded 2D floor plan file named {filename!r} as production geometry for a 3D floor-plan renderer. "
        "Set name to a human-friendly title derived from the filename or drawing title. "
        "Extract the visible drawing geometry first: connected unit footprint, enclosed or labeled spaces, wall centerlines, doors, windows, openings, "
        "built-in fixtures, symbols, and text labels. Then summarize the main rooms for compatibility. "
        "Treat spaces polygons as the primary geometry. Room rectangles are only compatibility bounding boxes for matching spaces, not a separate layout invention. "
        "Do not drop small spaces such as walk-in closets, closets, mechanical rooms, entries, laundries, pantries, balconies, or service yards; "
        "represent them as spaces even if their type is generic. "
        "Infer the building type, floor count, total floor area, rooms, approximate room dimensions, room positions, major furniture items, "
        "circulation area, estimated wall length, furniture-fit score, and sightline score. Use Singapore/SI units. "
        "Coordinate contract: use one absolute metre coordinate system for the whole plan. xM and yM are each room rectangle's top-left corner. "
        "widthM runs left-to-right and depthM runs top-to-bottom. All coordinates are non-negative numbers. Rectangles may share edges, "
        "but room interiors must not overlap. Do not stack rooms on top of each other. Do not place rooms in a generic grid unless the source drawing is a grid. "
        "Geometry primitive contract: floorPlate is the outer usable apartment/unit footprint polygon. spaces are actual enclosed or labeled areas as polygons, "
        "including closets and minor spaces. walls are wall centerline polylines with approximate thickness. openings are doors/windows/clear openings located "
        "on wall lines; include door swing direction in swingDeg when visible. fixtures are built-ins and plumbing/kitchen symbols, not loose decorative furniture. "
        "labels are OCR-like text from the drawing with approximate center coordinates. Preserve non-rectangular and angled geometry where visible. "
        "Completeness requirement: spaces must include at least every summarized room and usually more, because closets, entries, baths, and balconies are spaces too. "
        "For every summarized room, set linkedRoomId on the corresponding space and make the room xM/yM/widthM/depthM the bounding box of that exact space polygon. "
        "Make an OCR pass before geometry: enumerate every readable room/space label, abbreviation, and dimension text, then ensure each physical area behind those labels is represented once. "
        "Treat WIC, walk-in closet, closet, mech, laundry, pantry, store, entry, hall, bath/WC, ensuite, balcony, yard, and service spaces as real spaces. "
        "Do not leave large blank usable floor regions inside the unit footprint. Every enclosed or bounded floor surface should become a space; "
        "if an area only has dimensions or door swings but no room name, infer a concise circulation label such as Hallway, Corridor, or Entry from its adjacency. "
        "A central white region that connects bedrooms, baths, laundry, kitchen, and living is not empty background; represent it as Corridor/Entry or Hallway. "
        "For labeled residential plans, labels should include all visible room/space labels and dimension labels where readable. Walls should trace the visible black wall network, "
        "not only the exterior outline. Openings should include visible door swings and windows. "
        "Preserve visible topology: adjacent rooms should touch or align along shared walls; corridors should connect the rooms they visibly serve; "
        "balconies, service yards, bathrooms, and storage rooms should remain attached to their visible neighboring room or corridor. "
        "Geometry self-check before returning: for every pair of rooms, compute overlapWidth = min(xM+widthM) - max(xM) and "
        "overlapDepth = min(yM+depthM) - max(yM). If both are greater than 0.08, fix the coordinates before responding. "
        "Furniture contract: furniture item xM and yM are absolute top-left coordinates in the same plan coordinate system, not room-relative coordinates. "
        "Keep every furniture item fully inside its parent room with at least a small visible clearance. Furniture items in the same room must not overlap. "
        "Use rotationDeg 0 unless the item is clearly drawn rotated and still fits inside the room. "
        "Furniture inference rules: use visible symbols and labels first; if furniture is not drawn, infer a sparse practical set from the room type and name. "
        "Use specific lowercase kebab-case furniture kinds only from this vocabulary: "
        f"{', '.join(FURNITURE_KIND_VALUES)}. Do not use vague kinds like 'furniture', 'object', or 'fixture'. "
        "Bathrooms, toilets, WCs, and ensuites should include toilet and sink; include shower or bathtub only when visible or spatially plausible. "
        "Offices and study rooms should include desk and office-chair; add shelf only if there is enough wall space. "
        "Bedrooms should include bed; add wardrobe and nightstand only when they fit. "
        "Living rooms should include sofa and coffee-table; add media-console against a wall when plausible. "
        "Kitchens should include counter and sink; add stove, fridge, or appliance when visible or plausible. "
        "Dining rooms should include dining-table and chairs. Utility or service-yard rooms may include washer and shelf. Storage rooms should use shelf or storage. "
        "Place furniture like a real plan: beds and wardrobes against walls, counters along kitchen walls, toilets/sinks against bathroom walls, desks against a wall, "
        "tables with circulation clearance around them, and sofas facing the main room rather than blocking doors or corridors. Prefer 1-5 believable items per room over clutter. "
        "Keep the response compact and minified without omitting visible rooms; avoid decorative or duplicate furniture. "
        "Use sparse geometry: include enough walls/openings/fixtures/labels to preserve visible topology, but do not duplicate repeated line segments or dimension text. "
        "If dimensions are not readable, estimate from proportions and common residential/commercial standards while preserving relative shape and adjacency. "
        "Return only valid JSON matching the floor-plan analysis contract exactly. "
        "Return only the JSON object."
    )


def _validation_error_message(exc: ValidationError) -> str:
    first_error = exc.errors()[0]
    location = ".".join(str(part) for part in first_error.get("loc", ()))
    message = first_error.get("msg", "Validation failed")
    return f"{location}: {message}" if location else message


def _has_any(value: dict[str, Any], keys: list[str]) -> bool:
    return any(key in value and value[key] not in (None, "") for key in keys)


def _number_field(value: Any, keys: list[str], default: float) -> float:
    if not isinstance(value, dict):
        return default
    for key in keys:
        raw_value = value.get(key)
        if isinstance(raw_value, (int, float)) and raw_value > 0:
            return float(raw_value)
        if isinstance(raw_value, str):
            try:
                parsed = float(raw_value)
            except ValueError:
                continue
            if parsed > 0:
                return parsed
    return default


def _number_value(value: Any, keys: list[str], default: float) -> float:
    if not isinstance(value, dict):
        return default
    for key in keys:
        raw_value = value.get(key)
        if isinstance(raw_value, (int, float)):
            return float(raw_value)
        if isinstance(raw_value, str):
            try:
                return float(raw_value)
            except ValueError:
                continue
    return default


def _has_number(value: Any, keys: list[str]) -> bool:
    if not isinstance(value, dict):
        return False
    for key in keys:
        raw_value = value.get(key)
        if isinstance(raw_value, (int, float)):
            return True
        if isinstance(raw_value, str):
            try:
                float(raw_value)
            except ValueError:
                continue
            return True
    return False


def _plan_name_from_filename(filename: str) -> str:
    stem = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].rsplit(".", 1)[0]
    words = re.sub(r"[-_]+", " ", stem).strip()
    return words.title() if words else "Uploaded Floor Plan"


def _slug_id(name: str, index: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"{slug or 'room'}-{index + 1}"


def _infer_room_type(name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    for token, room_type in {
        "living": "living_room",
        "lounge": "living_room",
        "bed": "bedroom",
        "kitchen": "kitchen",
        "bath": "bathroom",
        "toilet": "bathroom",
        "wc": "bathroom",
        "corridor": "hallway",
        "hall": "hallway",
        "entry": "hallway",
        "foyer": "hallway",
        "office": "office",
        "study": "office",
        "dining": "dining_room",
        "store": "storage",
        "storage": "storage",
        "balcony": "balcony",
        "laundry": "utility",
        "utility": "utility",
    }.items():
        if token in normalized:
            return room_type
    return "storage"


def _normalize_room_type(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    allowed_room_types = {
        "living_room",
        "bedroom",
        "kitchen",
        "bathroom",
        "hallway",
        "office",
        "dining_room",
        "storage",
        "balcony",
        "utility",
    }
    aliases = {
        "living": "living_room",
        "livingroom": "living_room",
        "lounge": "living_room",
        "master_bedroom": "bedroom",
        "bed": "bedroom",
        "bath": "bathroom",
        "wc": "bathroom",
        "toilet": "bathroom",
        "restroom": "bathroom",
        "washroom": "bathroom",
        "corridor": "hallway",
        "entry": "hallway",
        "foyer": "hallway",
        "dining": "dining_room",
        "diningroom": "dining_room",
        "store": "storage",
        "closet": "storage",
        "laundry": "utility",
    }
    normalized = aliases.get(normalized, normalized)
    return normalized if normalized in allowed_room_types else "storage"


def _normalize_furniture_kind(value: str, room_type: str, room_name: str = "") -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    room_hint = re.sub(r"[^a-z0-9]+", "_", room_name.strip().lower()).strip("_")
    normalized_room_type = _normalize_room_type(room_type)

    direct = normalized.replace("_", "-")
    if direct in FURNITURE_KIND_VALUES:
        return direct

    aliases = {
        "bedside_table": "nightstand",
        "cabinet": "storage",
        "closet": "wardrobe",
        "couch": "sofa",
        "cupboard": "wardrobe",
        "dining_chair": "chair",
        "dining_table": "dining-table",
        "fridge_freezer": "fridge",
        "lavatory": "toilet",
        "media_unit": "media-console",
        "office_table": "desk",
        "refrigerator": "fridge",
        "settee": "sofa",
        "side_table": "nightstand",
        "study_table": "desk",
        "toilet_bowl": "toilet",
        "tv_console": "media-console",
        "vanity": "sink",
        "wash_basin": "sink",
        "washing_machine": "washer",
        "work_table": "desk",
        "workstation": "desk",
    }
    if normalized in aliases:
        return aliases[normalized]

    token_matches = [
        ("toilet", "toilet"),
        ("wc", "toilet"),
        ("basin", "sink"),
        ("sink", "sink"),
        ("vanity", "sink"),
        ("shower", "shower"),
        ("bath", "bathtub"),
        ("desk", "desk"),
        ("office", "office-chair" if "chair" in normalized else "desk"),
        ("study", "desk"),
        ("chair", "chair"),
        ("sofa", "sofa"),
        ("couch", "sofa"),
        ("bed", "bed"),
        ("wardrobe", "wardrobe"),
        ("closet", "wardrobe"),
        ("cupboard", "wardrobe"),
        ("shelf", "shelf"),
        ("storage", "storage"),
        ("console", "media-console"),
        ("television", "media-console"),
        ("tv", "media-console"),
        ("dining", "dining-table" if "table" in normalized else "chair"),
        ("coffee", "coffee-table"),
        ("table", "table"),
        ("counter", "counter"),
        ("stove", "stove"),
        ("hob", "stove"),
        ("fridge", "fridge"),
        ("refrigerator", "fridge"),
        ("washer", "washer"),
        ("washing", "washer"),
        ("appliance", "appliance"),
    ]
    for token, kind in token_matches:
        if token in normalized:
            return kind

    if normalized in {"fixture", "furniture", "object", "item"}:
        if normalized_room_type == "bathroom" or any(token in room_hint for token in ("toilet", "wc", "bath")):
            return "toilet"
        if normalized_room_type == "office" or "study" in room_hint:
            return "desk"
        if normalized_room_type == "bedroom":
            return "bed"
        if normalized_room_type == "kitchen":
            return "counter"
        if normalized_room_type == "dining_room":
            return "dining-table"
        if normalized_room_type == "living_room":
            return "sofa"
        if normalized_room_type == "utility":
            return "washer"

    return "storage"


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _analysis_schema_for_model(model_id: str) -> dict[str, Any]:
    if _use_compact_schema(model_id):
        return _gemini_analysis_schema()
    return _analysis_schema()


def _use_compact_schema(model_id: str) -> bool:
    normalized = model_id.lower()
    return normalized.startswith("google/gemini")


def _gemini_analysis_schema() -> dict[str, Any]:
    return _strip_gemini_unsupported_schema_keys(_compact_analysis_schema())


def _strip_gemini_unsupported_schema_keys(value: Any) -> Any:
    if isinstance(value, list):
        return [_strip_gemini_unsupported_schema_keys(item) for item in value]
    if not isinstance(value, dict):
        return value

    unsupported_keys = {"additionalProperties"}
    return {
        key: _strip_gemini_unsupported_schema_keys(item)
        for key, item in value.items()
        if key not in unsupported_keys
    }


def _compact_analysis_schema() -> dict[str, Any]:
    room_type_values = [
        "living_room",
        "bedroom",
        "kitchen",
        "bathroom",
        "hallway",
        "office",
        "dining_room",
        "storage",
        "balcony",
        "utility",
    ]
    point_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "xM": {"type": "number"},
            "yM": {"type": "number"},
        },
        "required": ["xM", "yM"],
    }
    space_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "label": {"type": "string"},
            "type": {"type": "string"},
            "polygon": {"type": "array", "items": point_schema, "minItems": 3, "maxItems": 10},
            "areaSqm": {"type": ["number", "null"]},
            "confidence": {"type": "number"},
            "linkedRoomId": {"type": ["string", "null"]},
        },
        "required": ["id", "label", "type", "polygon", "areaSqm", "confidence", "linkedRoomId"],
    }
    furniture_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "kind": {"type": "string"},
            "widthM": {"type": "number"},
            "depthM": {"type": "number"},
            "xM": {"type": "number"},
            "yM": {"type": "number"},
            "rotationDeg": {"type": "number"},
        },
        "required": ["id", "kind", "widthM", "depthM", "xM", "yM", "rotationDeg"],
    }
    room_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "name": {"type": "string"},
            "type": {"type": "string", "enum": room_type_values},
            "areaSqm": {"type": "number"},
            "widthM": {"type": "number"},
            "depthM": {"type": "number"},
            "xM": {"type": "number"},
            "yM": {"type": "number"},
            "confidence": {"type": "number"},
            "furniture": {"type": "array", "items": furniture_schema, "maxItems": 4},
        },
        "required": ["id", "name", "type", "areaSqm", "widthM", "depthM", "xM", "yM", "confidence", "furniture"],
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "name": {"type": "string"},
            "buildingType": {"type": "string"},
            "floors": {"type": "integer"},
            "totalAreaSqm": {"type": "number"},
            "notes": {"type": "string"},
            "floorPlate": {"type": "array", "items": point_schema, "minItems": 3, "maxItems": 12},
            "spaces": {"type": "array", "items": space_schema, "maxItems": 24},
            "rooms": {"type": "array", "items": room_schema, "minItems": 1, "maxItems": 16},
            "metrics": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "roomCount": {"type": "integer"},
                    "circulationAreaSqm": {"type": "number"},
                    "estimatedWallLengthM": {"type": "number"},
                    "furnitureFitScore": {"type": "number"},
                    "sightlineScore": {"type": "number"},
                },
                "required": [
                    "roomCount",
                    "circulationAreaSqm",
                    "estimatedWallLengthM",
                    "furnitureFitScore",
                    "sightlineScore",
                ],
            },
        },
        "required": [
            "name",
            "buildingType",
            "floors",
            "totalAreaSqm",
            "notes",
            "floorPlate",
            "spaces",
            "rooms",
            "metrics",
        ],
    }


def _analysis_schema() -> dict[str, Any]:
    room_type_values = [
        "living_room",
        "bedroom",
        "kitchen",
        "bathroom",
        "hallway",
        "office",
        "dining_room",
        "storage",
        "balcony",
        "utility",
    ]
    point_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "xM": {"type": "number", "minimum": 0},
            "yM": {"type": "number", "minimum": 0},
        },
        "required": ["xM", "yM"],
    }
    space_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "label": {"type": "string", "description": "Visible label or inferred concise name, e.g. WALK-IN CLOSET."},
            "type": {"type": "string", "description": "Generic semantic type such as bedroom, closet, hallway, mechanical, bathroom, balcony, or unknown."},
            "polygon": {"type": "array", "items": point_schema, "minItems": 3, "maxItems": 12, "description": "Space boundary polygon in clockwise or counter-clockwise order."},
            "areaSqm": {"type": ["number", "null"], "minimum": 0.2},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "linkedRoomId": {"type": ["string", "null"], "description": "Matching room id when this space corresponds to a compatibility room, otherwise null."},
        },
        "required": ["id", "label", "type", "polygon", "areaSqm", "confidence", "linkedRoomId"],
    }
    wall_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "points": {"type": "array", "items": point_schema, "minItems": 2, "maxItems": 8, "description": "Wall centerline or polyline points in plan metres."},
            "thicknessM": {"type": "number", "minimum": 0.03},
            "heightM": {"type": "number", "minimum": 1.8},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["id", "points", "thicknessM", "heightM", "confidence"],
    }
    opening_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "kind": {"type": "string", "enum": ["door", "window", "opening"]},
            "xM": {"type": "number", "minimum": 0, "description": "Opening center x coordinate in metres."},
            "yM": {"type": "number", "minimum": 0, "description": "Opening center y coordinate in metres."},
            "widthM": {"type": "number", "minimum": 0.2},
            "rotationDeg": {"type": "number", "description": "Opening direction in plan view."},
            "swingDeg": {"type": ["number", "null"], "description": "Door swing angle when visible, otherwise null."},
            "wallId": {"type": ["string", "null"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["id", "kind", "xM", "yM", "widthM", "rotationDeg", "swingDeg", "wallId", "confidence"],
    }
    fixture_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "kind": {"type": "string", "description": "Built-in fixture or visible symbol kind, e.g. toilet, sink, counter, island, closet-shelving, tub."},
            "xM": {"type": "number", "minimum": 0},
            "yM": {"type": "number", "minimum": 0},
            "widthM": {"type": "number", "minimum": 0.1},
            "depthM": {"type": "number", "minimum": 0.1},
            "rotationDeg": {"type": "number"},
            "spaceId": {"type": ["string", "null"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["id", "kind", "xM", "yM", "widthM", "depthM", "rotationDeg", "spaceId", "confidence"],
    }
    label_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "text": {"type": "string"},
            "xM": {"type": "number", "minimum": 0},
            "yM": {"type": "number", "minimum": 0},
            "widthM": {"type": ["number", "null"], "minimum": 0.05},
            "depthM": {"type": ["number", "null"], "minimum": 0.05},
            "linkedSpaceId": {"type": ["string", "null"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["id", "text", "xM", "yM", "widthM", "depthM", "linkedSpaceId", "confidence"],
    }
    furniture_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "kind": {
                "type": "string",
                "enum": FURNITURE_KIND_VALUES,
                "description": "Specific lowercase kebab-case furniture kind inferred from visible symbols, labels, room type, and room name.",
            },
            "widthM": {"type": "number", "minimum": 0.2, "description": "Furniture width in metres."},
            "depthM": {"type": "number", "minimum": 0.2, "description": "Furniture depth in metres."},
            "xM": {"type": "number", "minimum": 0, "description": "Absolute top-left x coordinate in the plan metre system."},
            "yM": {"type": "number", "minimum": 0, "description": "Absolute top-left y coordinate in the plan metre system."},
            "rotationDeg": {"type": "number", "description": "Use 0 unless a visible rotated item can still fit inside the room."},
        },
        "required": ["id", "kind", "widthM", "depthM", "xM", "yM", "rotationDeg"],
    }
    room_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "name": {"type": "string"},
            "type": {"type": "string", "enum": room_type_values},
            "areaSqm": {"type": "number", "minimum": 0.2},
            "widthM": {"type": "number", "minimum": 0.4, "description": "Room rectangle width in metres."},
            "depthM": {"type": "number", "minimum": 0.4, "description": "Room rectangle depth in metres."},
            "xM": {"type": "number", "minimum": 0, "description": "Absolute top-left x coordinate. Room interiors must not overlap."},
            "yM": {"type": "number", "minimum": 0, "description": "Absolute top-left y coordinate. Room interiors must not overlap."},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "furniture": {"type": "array", "items": furniture_schema, "maxItems": 5},
        },
        "required": ["id", "name", "type", "areaSqm", "widthM", "depthM", "xM", "yM", "confidence", "furniture"],
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "name": {"type": "string"},
            "buildingType": {"type": "string"},
            "floors": {"type": "integer", "minimum": 1},
            "totalAreaSqm": {"type": "number", "minimum": 0.2},
            "notes": {"type": "string"},
            "floorPlate": {"type": "array", "items": point_schema, "minItems": 3, "maxItems": 16},
            "spaces": {"type": "array", "items": space_schema, "maxItems": 24},
            "walls": {"type": "array", "items": wall_schema, "maxItems": 48},
            "openings": {"type": "array", "items": opening_schema, "maxItems": 40},
            "fixtures": {"type": "array", "items": fixture_schema, "maxItems": 40},
            "labels": {"type": "array", "items": label_schema, "maxItems": 50},
            "rooms": {"type": "array", "items": room_schema, "minItems": 1, "maxItems": 18},
            "metrics": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "roomCount": {"type": "integer", "minimum": 1},
                    "circulationAreaSqm": {"type": "number"},
                    "estimatedWallLengthM": {"type": "number"},
                    "furnitureFitScore": {"type": "number", "minimum": 0, "maximum": 100},
                    "sightlineScore": {"type": "number", "minimum": 0, "maximum": 100},
                },
                "required": [
                    "roomCount",
                    "circulationAreaSqm",
                    "estimatedWallLengthM",
                    "furnitureFitScore",
                    "sightlineScore",
                ],
            },
        },
        "required": [
            "name",
            "buildingType",
            "floors",
            "totalAreaSqm",
            "notes",
            "floorPlate",
            "spaces",
            "walls",
            "openings",
            "fixtures",
            "labels",
            "rooms",
            "metrics",
        ],
    }
