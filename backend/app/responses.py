from __future__ import annotations

import json
from typing import Any


CORS_HEADERS = {
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Filename",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
}


def json_response(payload: Any, status_code: int = 200) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            **CORS_HEADERS,
            "Content-Type": "application/json",
        },
        "body": json.dumps(payload, default=str),
    }


def error_response(message: str, status_code: int = 400) -> dict[str, Any]:
    return json_response({"error": message}, status_code)


def options_response() -> dict[str, Any]:
    return {
        "statusCode": 204,
        "headers": CORS_HEADERS,
        "body": "",
    }

