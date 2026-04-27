from __future__ import annotations

import unittest
from unittest.mock import patch

from app import api
from app.models import PlanAnalysis
from app.store import InMemoryPlanStore


class ApiStatusTest(unittest.TestCase):
    def test_inline_analysis_saves_pending_processing_and_ready_records(self) -> None:
        test_store = InMemoryPlanStore()
        snapshots: list[tuple[str, str | None, int | None]] = []

        def fake_analysis(_file_bytes, _content_type, _filename, plan_id, status_callback=None):
            if status_callback:
                status_callback("Fake model running.", 55)
                record = test_store.get_plan_record(plan_id)
                snapshots.append((record.status, record.status_message, record.progress_pct))
            return PlanAnalysis.model_validate({
                "id": plan_id,
                "name": "Unit Test Plan",
                "status": "ready",
                "sourceFile": "unit.png",
                "contentType": "image/png",
                "buildingType": "Residential",
                "floors": 1,
                "totalAreaSqm": 12,
                "notes": "Synthetic analysis.",
                "processingMode": "openrouter",
                "rooms": [
                    {
                        "id": "living",
                        "name": "Living",
                        "type": "living_room",
                        "areaSqm": 12,
                        "widthM": 3,
                        "depthM": 4,
                        "xM": 0,
                        "yM": 0,
                        "confidence": 0.9,
                        "furniture": [],
                    }
                ],
                "metrics": {
                    "roomCount": 1,
                    "circulationAreaSqm": 0,
                    "estimatedWallLengthM": 14,
                    "furnitureFitScore": 90,
                    "sightlineScore": 90,
                },
            })

        with (
            patch.object(api, "store", test_store),
            patch.object(api, "analyze_floor_plan", side_effect=fake_analysis),
        ):
            queued, event = api.start_inline_plan_analysis_job(b"image", "image/png", "unit.png")
            plan_id = queued["id"]

            self.assertEqual(queued["status"], "pending")
            self.assertEqual(queued["statusMessage"], "Queued for analysis.")
            self.assertEqual(queued["progressPct"], 5)
            self.assertEqual(api.list_plans_payload()["plans"][0]["status"], "pending")

            result = api.run_plan_analysis_job(event)
            record = test_store.get_plan_record(plan_id)

        self.assertEqual(result, {"status": "ready", "planId": plan_id})
        self.assertEqual(snapshots, [("processing", "Fake model running.", 55)])
        self.assertEqual(record.status, "ready")
        self.assertEqual(record.status_message, "Spatial model ready.")
        self.assertEqual(record.progress_pct, 100)
