from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3

from .config import env_value
from .models import PlanAnalysis, PlanListItem, PlanRecord
from .store import PlanNotFound


_PK_PLAN = "PLAN"
_PK_AUDIT = "AUDIT"


class DynamoPlanStore:
    def __init__(self, table_name: str) -> None:
        region = env_value("AWS_REGION", "ap-southeast-1")
        self._table = boto3.resource("dynamodb", region_name=region).Table(table_name)

    def save_plan(self, analysis: PlanAnalysis) -> PlanAnalysis:
        now = _now_iso()
        try:
            existing = self.get_plan_record(analysis.id)
            created_at = existing.created_at or now
        except PlanNotFound:
            created_at = now
        payload = analysis.model_dump(by_alias=True)
        payload.update({
            "statusMessage": "Spatial model ready.",
            "progressPct": 100,
            "createdAt": created_at,
            "updatedAt": now,
        })
        self._table.put_item(
            Item={
                "pk": _PK_PLAN,
                "sk": analysis.id,
                "data": _sanitize_for_dynamo(payload),
                "updatedAt": now,
            }
        )
        return analysis

    def get_plan(self, plan_id: str) -> PlanAnalysis:
        record = self.get_plan_record(plan_id)
        if record.status != "ready":
            raise PlanNotFound(f"Plan not found: {plan_id}")
        return PlanAnalysis.model_validate(record.model_dump(by_alias=True))

    def save_plan_record(self, record: PlanRecord) -> PlanRecord:
        now = _now_iso()
        if not record.updated_at:
            record.updated_at = now
        if not record.created_at:
            try:
                existing = self.get_plan_record(record.id)
                record.created_at = existing.created_at or now
            except PlanNotFound:
                record.created_at = now
        self._table.put_item(
            Item={
                "pk": _PK_PLAN,
                "sk": record.id,
                "data": _sanitize_for_dynamo(record.model_dump(by_alias=True, exclude_none=True)),
                "updatedAt": record.updated_at,
            }
        )
        return record

    def get_plan_record(self, plan_id: str) -> PlanRecord:
        resp = self._table.get_item(Key={"pk": _PK_PLAN, "sk": plan_id})
        item = resp.get("Item")
        if not item or "data" not in item:
            raise PlanNotFound(f"Plan not found: {plan_id}")
        return PlanRecord.model_validate(_decimal_to_native(item["data"]))

    def list_plans(self, limit: int = 20) -> list[PlanListItem]:
        resp = self._table.query(
            KeyConditionExpression="pk = :pk",
            ExpressionAttributeValues={":pk": _PK_PLAN},
            ScanIndexForward=False,
        )
        records = [PlanRecord.model_validate(_decimal_to_native(item["data"])) for item in resp.get("Items", [])]
        records.sort(key=lambda record: record.updated_at or "", reverse=True)
        return [
            PlanListItem(
                id=record.id,
                status=record.status,
                name=record.name or record.source_file,
                building_type=record.building_type or "Unknown building",
                total_area_sqm=record.total_area_sqm or 0,
                room_count=len(record.rooms),
                processing_mode=record.processing_mode,
                source_file=record.source_file,
                status_message=record.status_message,
                progress_pct=record.progress_pct,
                updated_at=record.updated_at,
            )
            for record in records
        ][: max(1, min(limit, 50))]

    def reset(self) -> None:
        resp = self._table.query(
            KeyConditionExpression="pk = :pk",
            ExpressionAttributeValues={":pk": _PK_PLAN},
            ProjectionExpression="pk, sk",
        )
        with self._table.batch_writer() as batch:
            for item in resp.get("Items", []):
                batch.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})
        self.audit("reset", {})

    def audit(self, action: str, detail: dict) -> None:
        ts = _now_iso()
        self._table.put_item(
            Item={
                "pk": _PK_AUDIT,
                "sk": f"{ts}#{action}",
                "timestamp": ts,
                "action": action,
                "detail": _sanitize_for_dynamo(detail),
            }
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _sanitize_for_dynamo(obj: Any) -> Any:
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {key: _sanitize_for_dynamo(value) for key, value in obj.items() if value is not None and value != ""}
    if isinstance(obj, list):
        return [_sanitize_for_dynamo(value) for value in obj]
    return obj


def _decimal_to_native(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    if isinstance(obj, dict):
        return {key: _decimal_to_native(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [_decimal_to_native(value) for value in obj]
    return obj
