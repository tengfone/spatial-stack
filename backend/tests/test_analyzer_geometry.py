from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from app import analyzer
from app.analyzer import _analysis_from_payload


class AnalyzerGeometryTest(unittest.TestCase):
    def test_default_model_sequence_uses_single_gemini_model(self) -> None:
        with patch.object(analyzer, "env_value", side_effect=lambda _name, default="": default):
            model_ids = analyzer._openrouter_model_sequence()

        self.assertEqual(model_ids, ["google/gemini-3-flash-preview"])

    def test_openrouter_request_uses_direct_http_structured_outputs(self) -> None:
        class FakeResponse:
            status_code = 200
            url = analyzer.OPENROUTER_CHAT_COMPLETIONS_URL
            text = ""
            content = b"{}"

            def json(self):
                return {
                    "model": "google/gemini-3-flash-preview",
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps({"name": "HTTP structured output"})
                            }
                        }
                    ],
                }

        with (
            patch.object(analyzer, "env_value", side_effect=lambda name, default="": "test-key" if name == "OPENROUTER_API_KEY" else default),
            patch.object(analyzer.httpx, "post", return_value=FakeResponse()) as post,
        ):
            payload = analyzer._analyze_with_openrouter(b"image", "image/png", "plan.png", "google/gemini-3-flash-preview", 30)

        request_body = post.call_args.kwargs["json"]
        self.assertEqual(post.call_args.args[0], analyzer.OPENROUTER_CHAT_COMPLETIONS_URL)
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer test-key")
        self.assertEqual(request_body["model"], "google/gemini-3-flash-preview")
        self.assertEqual(request_body["response_format"]["type"], "json_schema")
        self.assertNotIn("strict", request_body["response_format"]["json_schema"])
        self.assertNotIn("additionalProperties", json.dumps(request_body["response_format"]["json_schema"]["schema"]))
        self.assertTrue(request_body["provider"]["require_parameters"])
        self.assertFalse(request_body["stream"])
        self.assertEqual(payload["modelId"], "google/gemini-3-flash-preview")

    def test_gemini_invalid_argument_retries_json_object_response_format(self) -> None:
        model_id = "google/gemini-3-flash-preview"

        class InvalidArgumentResponse:
            status_code = 400
            url = analyzer.OPENROUTER_CHAT_COMPLETIONS_URL
            text = (
                '{"error":{"message":"Provider returned error","code":400,'
                '"metadata":{"raw":"{\\"error\\":{\\"code\\":400,'
                '\\"message\\":\\"Request contains an invalid argument.\\",'
                '\\"status\\":\\"INVALID_ARGUMENT\\"}}","provider_name":"Google AI Studio"}}}'
            )
            content = text.encode("utf-8")

        class ValidResponse:
            status_code = 200
            url = analyzer.OPENROUTER_CHAT_COMPLETIONS_URL
            text = ""
            content = b"{}"

            def json(self):
                return {
                    "model": model_id,
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps({"name": "JSON object fallback"})
                            }
                        }
                    ],
                }

        with (
            patch.object(analyzer, "env_value", side_effect=lambda name, default="": "test-key" if name == "OPENROUTER_API_KEY" else default),
            patch.object(analyzer.httpx, "post", side_effect=[InvalidArgumentResponse(), ValidResponse()]) as post,
        ):
            payload = analyzer._analyze_with_openrouter(b"image", "image/png", "plan.png", model_id, 30)

        self.assertEqual(post.call_count, 2)
        first_body = post.call_args_list[0].kwargs["json"]
        retry_body = post.call_args_list[1].kwargs["json"]
        self.assertEqual(first_body["response_format"]["type"], "json_schema")
        self.assertEqual(retry_body["response_format"], {"type": "json_object"})
        self.assertEqual(payload["modelId"], model_id)

    def test_sanity_failure_does_not_retry_a_second_model(self) -> None:
        calls: list[str] = []

        def fake_openrouter(_file_bytes, _content_type, _filename, model_id, _timeout):
            calls.append(model_id)
            return {
                "name": "Empty Primary",
                "buildingType": "Apartment",
                "floors": 1,
                "totalAreaSqm": 42,
                "notes": "Primary extracted no rooms.",
                "rooms": [],
                "metrics": {
                    "roomCount": 0,
                    "circulationAreaSqm": 0,
                    "estimatedWallLengthM": 0,
                    "furnitureFitScore": 10,
                    "sightlineScore": 10,
                },
                "modelId": model_id,
            }

        with (
            patch.dict("os.environ", {"OPENROUTER_MODEL": "primary-model"}, clear=False),
            patch.object(analyzer, "_analyze_with_openrouter", side_effect=fake_openrouter),
        ):
            with self.assertRaises(analyzer.AnalysisError):
                analyzer.analyze_floor_plan(b"fake", "image/png", "fallback-test.png", "plan-test")

        self.assertEqual(calls, ["primary-model"])

    def test_ai_room_and_furniture_overlaps_are_cleaned_before_validation(self) -> None:
        payload = {
            "name": "Overlap Test",
            "buildingType": "Apartment",
            "floors": 1,
            "totalAreaSqm": 42,
            "notes": "Synthetic overlap payload.",
            "rooms": [
                {
                    "id": "living",
                    "name": "Living Room",
                    "type": "living_room",
                    "areaSqm": 16,
                    "widthM": 4,
                    "depthM": 4,
                    "xM": 0,
                    "yM": 0,
                    "confidence": 0.9,
                    "furniture": [
                        {"id": "sofa", "kind": "sofa", "widthM": 2, "depthM": 1, "xM": 0.2, "yM": 0.2, "rotationDeg": 0},
                        {"id": "table", "kind": "table", "widthM": 1.5, "depthM": 1, "xM": 0.3, "yM": 0.3, "rotationDeg": 0},
                    ],
                },
                {
                    "id": "bedroom",
                    "name": "Bedroom",
                    "type": "bedroom",
                    "areaSqm": 12,
                    "widthM": 3,
                    "depthM": 4,
                    "xM": 2,
                    "yM": 1,
                    "confidence": 0.86,
                    "furniture": [],
                },
                {
                    "id": "bath",
                    "name": "Bathroom",
                    "type": "bathroom",
                    "areaSqm": 4,
                    "widthM": 2,
                    "depthM": 2,
                    "xM": 4,
                    "yM": 0,
                    "confidence": 0.82,
                    "furniture": [],
                },
            ],
            "metrics": {
                "roomCount": 3,
                "circulationAreaSqm": 8,
                "estimatedWallLengthM": 36,
                "furnitureFitScore": 62,
                "sightlineScore": 70,
            },
        }

        analysis = _analysis_from_payload(payload, "plan-test", "overlap-test.png", "image/png")

        self.assert_no_room_overlaps(analysis.rooms)
        for room in analysis.rooms:
            self.assert_furniture_inside_room(room)
            self.assert_no_furniture_overlaps(room)

    def test_ai_furniture_kind_aliases_are_normalized_for_renderer(self) -> None:
        payload = {
            "name": "Furniture Kind Test",
            "buildingType": "Apartment",
            "floors": 1,
            "totalAreaSqm": 50,
            "notes": "Synthetic furniture alias payload.",
            "rooms": [
                {
                    "id": "bath",
                    "name": "WC",
                    "type": "bathroom",
                    "areaSqm": 4,
                    "widthM": 2,
                    "depthM": 2,
                    "xM": 0,
                    "yM": 0,
                    "confidence": 0.9,
                    "furniture": [
                        {"id": "wc-fixture", "kind": "toilet bowl", "widthM": 0.5, "depthM": 0.7, "xM": 0.2, "yM": 0.2, "rotationDeg": 0},
                        {"id": "basin", "kind": "wash basin", "widthM": 0.6, "depthM": 0.45, "xM": 1.1, "yM": 0.2, "rotationDeg": 0},
                    ],
                },
                {
                    "id": "office",
                    "name": "Study",
                    "type": "office",
                    "areaSqm": 9,
                    "widthM": 3,
                    "depthM": 3,
                    "xM": 2.2,
                    "yM": 0,
                    "confidence": 0.88,
                    "furniture": [
                        {"id": "work-table", "kind": "office table", "widthM": 1.2, "depthM": 0.7, "xM": 2.4, "yM": 0.2, "rotationDeg": 0},
                        {"id": "work-chair", "kind": "office chair", "widthM": 0.5, "depthM": 0.5, "xM": 3.8, "yM": 0.2, "rotationDeg": 0},
                    ],
                },
                {
                    "id": "kitchen",
                    "name": "Kitchen",
                    "type": "kitchen",
                    "areaSqm": 8,
                    "widthM": 3,
                    "depthM": 2.6,
                    "xM": 0,
                    "yM": 2.4,
                    "confidence": 0.87,
                    "furniture": [
                        {"id": "cold", "kind": "refrigerator", "widthM": 0.7, "depthM": 0.7, "xM": 0.2, "yM": 2.6, "rotationDeg": 0},
                    ],
                },
                {
                    "id": "living",
                    "name": "Living",
                    "type": "living_room",
                    "areaSqm": 16,
                    "widthM": 4,
                    "depthM": 4,
                    "xM": 3.4,
                    "yM": 3.2,
                    "confidence": 0.86,
                    "furniture": [
                        {"id": "tv", "kind": "tv console", "widthM": 1.2, "depthM": 0.4, "xM": 3.6, "yM": 3.4, "rotationDeg": 0},
                    ],
                },
            ],
            "metrics": {
                "roomCount": 4,
                "circulationAreaSqm": 6,
                "estimatedWallLengthM": 34,
                "furnitureFitScore": 78,
                "sightlineScore": 72,
            },
        }

        analysis = _analysis_from_payload(payload, "plan-test", "aliases.png", "image/png")
        furniture_kinds = {
            item.id: item.kind
            for room in analysis.rooms
            for item in room.furniture
        }

        self.assertEqual(furniture_kinds["wc-fixture"], "toilet")
        self.assertEqual(furniture_kinds["basin"], "sink")
        self.assertEqual(furniture_kinds["work-table"], "desk")
        self.assertEqual(furniture_kinds["work-chair"], "office-chair")
        self.assertEqual(furniture_kinds["cold"], "fridge")
        self.assertEqual(furniture_kinds["tv"], "media-console")

    def test_fallback_furniture_uses_specific_renderer_kinds(self) -> None:
        payload = {
            "name": "Fallback Kind Test",
            "buildingType": "Apartment",
            "floors": 1,
            "totalAreaSqm": 28,
            "notes": "Synthetic fallback furniture payload.",
            "rooms": [
                {
                    "id": "bedroom",
                    "name": "Bedroom",
                    "type": "bedroom",
                    "areaSqm": 12,
                    "widthM": 3,
                    "depthM": 4,
                    "xM": 0,
                    "yM": 0,
                    "confidence": 0.9,
                    "furniture": [],
                },
                {
                    "id": "office",
                    "name": "Study",
                    "type": "office",
                    "areaSqm": 8,
                    "widthM": 3,
                    "depthM": 2.6,
                    "xM": 3.3,
                    "yM": 0,
                    "confidence": 0.86,
                    "furniture": [],
                },
                {
                    "id": "living",
                    "name": "Living Room",
                    "type": "living_room",
                    "areaSqm": 8,
                    "widthM": 3,
                    "depthM": 2.6,
                    "xM": 0,
                    "yM": 4.3,
                    "confidence": 0.84,
                    "furniture": [],
                },
            ],
            "metrics": {
                "roomCount": 3,
                "circulationAreaSqm": 5,
                "estimatedWallLengthM": 28,
                "furnitureFitScore": 75,
                "sightlineScore": 70,
            },
        }

        analysis = _analysis_from_payload(payload, "plan-test", "fallback.png", "image/png")
        rooms_by_id = {room.id: room for room in analysis.rooms}
        bedroom_kinds = {item.kind for item in rooms_by_id["bedroom"].furniture}
        office_kinds = {item.kind for item in rooms_by_id["office"].furniture}
        living_kinds = {item.kind for item in rooms_by_id["living"].furniture}

        self.assertIn("wardrobe", bedroom_kinds)
        self.assertIn("nightstand", bedroom_kinds)
        self.assertIn("office-chair", office_kinds)
        self.assertIn("media-console", living_kinds)
        self.assertNotIn("storage", bedroom_kinds)

    def test_geometry_primitives_are_preserved_for_renderer(self) -> None:
        payload = {
            "name": "Unit C1",
            "buildingType": "Residential Apartment",
            "floors": 1,
            "totalAreaSqm": 115,
            "notes": "Geometry-first parse.",
            "floorPlate": [
                {"xM": 0, "yM": 0},
                {"xM": 10, "yM": 0},
                {"xM": 10, "yM": 8},
                {"xM": 0, "yM": 8},
            ],
            "spaces": [
                {
                    "id": "walk-in-closet",
                    "label": "WALK-IN CLOSET",
                    "type": "walk-in closet",
                    "polygon": [
                        {"xM": 2, "yM": 2},
                        {"xM": 3.2, "yM": 2},
                        {"xM": 3.2, "yM": 3.1},
                        {"xM": 2, "yM": 3.1},
                    ],
                    "areaSqm": 1.32,
                    "confidence": 0.86,
                    "linkedRoomId": None,
                }
            ],
            "walls": [
                {
                    "id": "wall-1",
                    "points": [{"xM": 2, "yM": 2}, {"xM": 3.2, "yM": 2}],
                    "thicknessM": 0.15,
                    "heightM": 2.7,
                    "confidence": 0.88,
                }
            ],
            "openings": [
                {
                    "id": "closet-door",
                    "kind": "door",
                    "xM": 2.4,
                    "yM": 3.1,
                    "widthM": 0.8,
                    "rotationDeg": 90,
                    "swingDeg": 90,
                    "wallId": "wall-1",
                    "confidence": 0.82,
                }
            ],
            "fixtures": [
                {
                    "id": "closet-shelving",
                    "kind": "closet shelving",
                    "xM": 2.1,
                    "yM": 2.1,
                    "widthM": 1,
                    "depthM": 0.35,
                    "rotationDeg": 0,
                    "spaceId": "walk-in-closet",
                    "confidence": 0.76,
                }
            ],
            "labels": [
                {
                    "id": "walk-in-closet-label",
                    "text": "WALK-IN CLOSET",
                    "xM": 2.6,
                    "yM": 2.55,
                    "widthM": 1.1,
                    "depthM": 0.25,
                    "linkedSpaceId": "walk-in-closet",
                    "confidence": 0.9,
                }
            ],
            "rooms": [
                {
                    "id": "bedroom",
                    "name": "Bedroom",
                    "type": "bedroom",
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
                "circulationAreaSqm": 6,
                "estimatedWallLengthM": 28,
                "furnitureFitScore": 75,
                "sightlineScore": 70,
            },
        }

        analysis = _analysis_from_payload(payload, "plan-test", "c1.png", "image/png")

        self.assertEqual(len(analysis.floor_plate), 4)
        self.assertEqual(analysis.spaces[0].label, "WALK-IN CLOSET")
        self.assertEqual(analysis.spaces[0].type, "closet")
        self.assertEqual(analysis.walls[0].height_m, 2.7)
        self.assertEqual(analysis.openings[0].kind, "door")
        self.assertEqual(analysis.fixtures[0].kind, "closet-shelving")
        self.assertEqual(analysis.labels[0].text, "WALK-IN CLOSET")

    def test_linked_space_geometry_drives_room_bounds(self) -> None:
        payload = {
            "name": "Space Authority Test",
            "buildingType": "Apartment",
            "floors": 1,
            "totalAreaSqm": 16,
            "notes": "Room rectangle is wrong but linked space is correct.",
            "floorPlate": [
                {"xM": 0, "yM": 0},
                {"xM": 5, "yM": 0},
                {"xM": 5, "yM": 4},
                {"xM": 0, "yM": 4},
            ],
            "spaces": [
                {
                    "id": "living-space",
                    "label": "Living Room",
                    "type": "living room",
                    "polygon": [
                        {"xM": 1.2, "yM": 0.5},
                        {"xM": 4.6, "yM": 0.5},
                        {"xM": 4.6, "yM": 3.5},
                        {"xM": 1.2, "yM": 3.5},
                    ],
                    "areaSqm": 10.2,
                    "confidence": 0.9,
                    "linkedRoomId": "living",
                }
            ],
            "rooms": [
                {
                    "id": "living",
                    "name": "Living Room",
                    "type": "living_room",
                    "areaSqm": 2,
                    "widthM": 1,
                    "depthM": 2,
                    "xM": 9,
                    "yM": 9,
                    "confidence": 0.9,
                    "furniture": [],
                }
            ],
            "metrics": {
                "roomCount": 1,
                "circulationAreaSqm": 2,
                "estimatedWallLengthM": 16,
                "furnitureFitScore": 80,
                "sightlineScore": 80,
            },
        }

        analysis = _analysis_from_payload(payload, "plan-test", "space-authority.png", "image/png")
        room = analysis.rooms[0]

        self.assertEqual(room.x_m, 1.2)
        self.assertEqual(room.y_m, 0.5)
        self.assertEqual(room.width_m, 3.4)
        self.assertEqual(room.depth_m, 3.0)
        self.assertEqual(room.area_sqm, 10.2)

    def test_nested_room_geometry_passes_dimension_sanity(self) -> None:
        payload = {
            "name": "Nested Gemini Geometry",
            "buildingType": "Apartment",
            "floors": 1,
            "totalAreaSqm": 28,
            "notes": "Gemini-style nested geometry.",
            "rooms": [
                {
                    "id": "living",
                    "name": "Living Room",
                    "type": "living_room",
                    "dimensions": {"areaSqm": 16, "width": 4, "height": 4},
                    "position": {"x": 0, "y": 0},
                    "confidence": 0.9,
                    "furniture": [],
                },
                {
                    "id": "bedroom",
                    "name": "Bedroom",
                    "type": "bedroom",
                    "dimensions": {"area": 12, "widthM": 3, "depthM": 4},
                    "coordinates": {"xM": 4, "yM": 0},
                    "confidence": 0.86,
                    "furniture": [],
                },
            ],
            "metrics": {
                "roomCount": 2,
                "circulationAreaSqm": 3,
                "estimatedWallLengthM": 28,
                "furnitureFitScore": 74,
                "sightlineScore": 70,
            },
        }

        analysis = _analysis_from_payload(payload, "plan-test", "nested.png", "image/png")
        issues = analyzer._analysis_sanity_issues(analysis, payload)
        rooms_by_id = {room.id: room for room in analysis.rooms}

        self.assertFalse(any("missing required dimensions or coordinates" in issue for issue in issues))
        self.assertEqual(rooms_by_id["living"].width_m, 4)
        self.assertEqual(rooms_by_id["living"].depth_m, 4)
        self.assertEqual(rooms_by_id["bedroom"].x_m, 4)
        self.assertEqual(rooms_by_id["bedroom"].y_m, 0)

    def test_space_points_alias_drives_room_bounds_and_sanity(self) -> None:
        payload = {
            "name": "Space Points Alias",
            "buildingType": "Apartment",
            "floors": 1,
            "totalAreaSqm": 14,
            "notes": "Space geometry uses a provider-specific points key.",
            "spaces": [
                {
                    "id": "study-space",
                    "label": "Study",
                    "type": "study",
                    "points": [[1, 0.5], [4.5, 0.5], [4.5, 3.5], [1, 3.5]],
                    "areaSqm": 10.5,
                    "confidence": 0.88,
                    "linkedRoomId": "study",
                }
            ],
            "rooms": [
                {
                    "id": "study",
                    "name": "Study",
                    "type": "office",
                    "confidence": 0.88,
                    "furniture": [],
                }
            ],
            "metrics": {
                "roomCount": 1,
                "circulationAreaSqm": 3,
                "estimatedWallLengthM": 16,
                "furnitureFitScore": 80,
                "sightlineScore": 80,
            },
        }

        analysis = _analysis_from_payload(payload, "plan-test", "space-points.png", "image/png")
        issues = analyzer._analysis_sanity_issues(analysis, payload)
        room = analysis.rooms[0]

        self.assertEqual(issues, [])
        self.assertEqual(room.x_m, 1)
        self.assertEqual(room.y_m, 0.5)
        self.assertEqual(room.width_m, 3.5)
        self.assertEqual(room.depth_m, 3.0)
        self.assertEqual(room.area_sqm, 10.5)

    def test_submeter_service_spaces_keep_their_dimensions(self) -> None:
        payload = {
            "name": "Small Space Test",
            "buildingType": "Apartment",
            "floors": 1,
            "totalAreaSqm": 12,
            "notes": "Synthetic tiny closet payload.",
            "rooms": [
                {
                    "id": "mech",
                    "name": "Mech",
                    "type": "utility",
                    "areaSqm": 0.36,
                    "widthM": 0.6,
                    "depthM": 0.6,
                    "xM": 0,
                    "yM": 0,
                    "confidence": 0.9,
                    "furniture": [],
                },
                {
                    "id": "closet",
                    "name": "Closet",
                    "type": "storage",
                    "areaSqm": 0.4,
                    "widthM": 0.8,
                    "depthM": 0.5,
                    "xM": 0.8,
                    "yM": 0,
                    "confidence": 0.86,
                    "furniture": [],
                },
            ],
            "metrics": {
                "roomCount": 2,
                "circulationAreaSqm": 0,
                "estimatedWallLengthM": 4,
                "furnitureFitScore": 80,
                "sightlineScore": 80,
            },
        }

        analysis = _analysis_from_payload(payload, "plan-test", "tiny.png", "image/png")
        rooms_by_id = {room.id: room for room in analysis.rooms}

        self.assertEqual(rooms_by_id["mech"].width_m, 0.6)
        self.assertEqual(rooms_by_id["mech"].depth_m, 0.6)
        self.assertEqual(rooms_by_id["closet"].width_m, 0.8)
        self.assertEqual(rooms_by_id["closet"].depth_m, 0.5)

    def assert_no_room_overlaps(self, rooms) -> None:
        for left_index, left in enumerate(rooms):
            for right in rooms[left_index + 1:]:
                self.assertFalse(
                    rects_overlap(left.x_m, left.y_m, left.width_m, left.depth_m, right.x_m, right.y_m, right.width_m, right.depth_m),
                    f"{left.name} overlaps {right.name}",
                )

    def assert_furniture_inside_room(self, room) -> None:
        for item in room.furniture:
            self.assertGreaterEqual(item.x_m, room.x_m)
            self.assertGreaterEqual(item.y_m, room.y_m)
            self.assertLessEqual(item.x_m + item.width_m, room.x_m + room.width_m)
            self.assertLessEqual(item.y_m + item.depth_m, room.y_m + room.depth_m)

    def assert_no_furniture_overlaps(self, room) -> None:
        for left_index, left in enumerate(room.furniture):
            for right in room.furniture[left_index + 1:]:
                self.assertFalse(
                    rects_overlap(left.x_m, left.y_m, left.width_m, left.depth_m, right.x_m, right.y_m, right.width_m, right.depth_m),
                    f"{room.name}: {left.kind} overlaps {right.kind}",
                )


def rects_overlap(ax: float, ay: float, aw: float, ad: float, bx: float, by: float, bw: float, bd: float) -> bool:
    return min(ax + aw, bx + bw) - max(ax, bx) > 0.001 and min(ay + ad, by + bd) - max(ay, by) > 0.001


if __name__ == "__main__":
    unittest.main()
