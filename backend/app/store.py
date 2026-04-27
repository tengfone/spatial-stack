from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol

from .config import env_value
from .models import PlanAnalysis, PlanListItem, PlanRecord


class PlanNotFound(Exception):
    pass


class PlanStore(Protocol):
    def save_plan(self, analysis: PlanAnalysis) -> PlanAnalysis: ...
    def get_plan(self, plan_id: str) -> PlanAnalysis: ...
    def save_plan_record(self, record: PlanRecord) -> PlanRecord: ...
    def get_plan_record(self, plan_id: str) -> PlanRecord: ...
    def list_plans(self, limit: int = 20) -> list[PlanListItem]: ...
    def reset(self) -> None: ...
    def audit(self, action: str, detail: dict) -> None: ...


class InMemoryPlanStore:
    def __init__(self) -> None:
        self._plans: dict[str, PlanRecord] = {}
        self._audit_log: list[dict] = []

    def save_plan(self, analysis: PlanAnalysis) -> PlanAnalysis:
        now = _now_iso()
        existing = self._plans.get(analysis.id)
        payload = analysis.model_dump(by_alias=True)
        payload.update({
            "statusMessage": "Spatial model ready.",
            "progressPct": 100,
            "createdAt": existing.created_at if existing else now,
            "updatedAt": now,
        })
        self._plans[analysis.id] = PlanRecord.model_validate(payload)
        return analysis

    def get_plan(self, plan_id: str) -> PlanAnalysis:
        record = self.get_plan_record(plan_id)
        if record.status != "ready":
            raise PlanNotFound(f"Plan not found: {plan_id}")
        return PlanAnalysis.model_validate(record.model_dump(by_alias=True))

    def save_plan_record(self, record: PlanRecord) -> PlanRecord:
        self._plans[record.id] = record
        return record

    def get_plan_record(self, plan_id: str) -> PlanRecord:
        record = self._plans.get(plan_id)
        if not record:
            raise PlanNotFound(f"Plan not found: {plan_id}")
        return record

    def list_plans(self, limit: int = 20) -> list[PlanListItem]:
        items = [
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
            for record in self._plans.values()
        ]
        items.sort(key=lambda item: item.updated_at or "", reverse=True)
        return items[: max(1, min(limit, 50))]

    def reset(self) -> None:
        self._plans.clear()
        self.audit("reset", {})

    def audit(self, action: str, detail: dict) -> None:
        self._audit_log.append(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                "action": action,
                "detail": detail,
            }
        )


def _create_store() -> PlanStore:
    table_name = env_value("APP_DATA_TABLE_NAME", "").strip()
    if table_name:
        from .dynamo_store import DynamoPlanStore

        return DynamoPlanStore(table_name)
    return InMemoryPlanStore()


store: PlanStore = _create_store()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")
