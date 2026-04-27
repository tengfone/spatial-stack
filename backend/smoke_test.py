from __future__ import annotations

import os
from pathlib import Path

from app.analyzer import AnalysisError
from app.api import analyze_plan_payload, health_payload


def main() -> None:
    health = health_payload()
    assert health["status"] == "ok"

    if not os.getenv("OPENROUTER_API_KEY"):
        try:
            analyze_plan_payload(b"fake image bytes", "image/png", "smoke-test.png")
        except AnalysisError as exc:
            assert "OPENROUTER_API_KEY" in str(exc)
            print({"status": "ok", "service": health["service"], "openrouterConfigured": False})
            return
        raise AssertionError("Expected missing OPENROUTER_API_KEY to fail explicitly.")

    test_file = os.getenv("SMOKE_TEST_FLOOR_PLAN", "").strip()
    if not test_file:
        print({"status": "ok", "service": health["service"], "openrouterConfigured": True, "liveCall": "skipped"})
        return

    path = Path(test_file)
    content_type = _content_type(path)
    result = analyze_plan_payload(path.read_bytes(), content_type, path.name)
    assert result["id"].startswith("plan-")
    assert result["processingMode"] == "openrouter"
    assert result["rooms"]

    print(
        {
            "status": "ok",
            "service": health["service"],
            "planId": result["id"],
            "roomCount": len(result["rooms"]),
            "processingMode": result["processingMode"],
        }
    )


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    return "application/octet-stream"


if __name__ == "__main__":
    main()
