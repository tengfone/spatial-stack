from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


class APIModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


RoomType = Literal[
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


ProcessingMode = Literal["openrouter"]
PlanStatus = Literal["pending", "processing", "ready", "failed"]
OpeningKind = Literal["door", "window", "opening"]


class PlanPoint(APIModel):
    x_m: float
    y_m: float


class FurnitureItem(APIModel):
    id: str
    kind: str
    width_m: float = Field(gt=0)
    depth_m: float = Field(gt=0)
    x_m: float
    y_m: float
    rotation_deg: float = 0


class Room(APIModel):
    id: str
    name: str
    type: RoomType
    area_sqm: float = Field(gt=0)
    width_m: float = Field(gt=0)
    depth_m: float = Field(gt=0)
    x_m: float
    y_m: float
    confidence: float = Field(default=0.72, ge=0, le=1)
    furniture: list[FurnitureItem] = Field(default_factory=list)


class SpaceGeometry(APIModel):
    id: str
    label: str
    type: str
    polygon: list[PlanPoint] = Field(default_factory=list)
    area_sqm: float | None = Field(default=None, gt=0)
    confidence: float = Field(default=0.72, ge=0, le=1)
    linked_room_id: str | None = None


class WallSegment(APIModel):
    id: str
    points: list[PlanPoint] = Field(default_factory=list)
    thickness_m: float = Field(default=0.15, gt=0)
    height_m: float = Field(default=2.7, gt=0)
    confidence: float = Field(default=0.72, ge=0, le=1)


class Opening(APIModel):
    id: str
    kind: OpeningKind = "opening"
    x_m: float
    y_m: float
    width_m: float = Field(gt=0)
    rotation_deg: float = 0
    swing_deg: float | None = None
    wall_id: str | None = None
    confidence: float = Field(default=0.72, ge=0, le=1)


class Fixture(APIModel):
    id: str
    kind: str
    x_m: float
    y_m: float
    width_m: float = Field(gt=0)
    depth_m: float = Field(gt=0)
    rotation_deg: float = 0
    space_id: str | None = None
    confidence: float = Field(default=0.72, ge=0, le=1)


class PlanLabel(APIModel):
    id: str
    text: str
    x_m: float
    y_m: float
    width_m: float | None = Field(default=None, gt=0)
    depth_m: float | None = Field(default=None, gt=0)
    linked_space_id: str | None = None
    confidence: float = Field(default=0.72, ge=0, le=1)


class SpatialMetrics(APIModel):
    room_count: int
    circulation_area_sqm: float
    estimated_wall_length_m: float
    furniture_fit_score: float = Field(ge=0, le=100)
    sightline_score: float = Field(ge=0, le=100)


class PlanAnalysis(APIModel):
    id: str
    name: str
    status: Literal["ready"] = "ready"
    source_file: str
    content_type: str
    building_type: str
    floors: int = Field(default=1, ge=1)
    total_area_sqm: float = Field(gt=0)
    notes: str
    processing_mode: ProcessingMode
    model_id: str | None = None
    raw_object_key: str | None = None
    floor_plate: list[PlanPoint] = Field(default_factory=list)
    spaces: list[SpaceGeometry] = Field(default_factory=list)
    walls: list[WallSegment] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    fixtures: list[Fixture] = Field(default_factory=list)
    labels: list[PlanLabel] = Field(default_factory=list)
    rooms: list[Room]
    metrics: SpatialMetrics


class PlanRecord(APIModel):
    id: str
    status: PlanStatus
    source_file: str
    content_type: str
    processing_mode: ProcessingMode = "openrouter"
    status_message: str | None = None
    progress_pct: int | None = Field(default=None, ge=0, le=100)
    name: str | None = None
    building_type: str | None = None
    floors: int | None = None
    total_area_sqm: float | None = None
    notes: str | None = None
    model_id: str | None = None
    raw_object_key: str | None = None
    error: str | None = None
    floor_plate: list[PlanPoint] = Field(default_factory=list)
    spaces: list[SpaceGeometry] = Field(default_factory=list)
    walls: list[WallSegment] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    fixtures: list[Fixture] = Field(default_factory=list)
    labels: list[PlanLabel] = Field(default_factory=list)
    rooms: list[Room] = Field(default_factory=list)
    metrics: SpatialMetrics | None = None
    created_at: str | None = None
    updated_at: str | None = None


class PlanListItem(APIModel):
    id: str
    status: PlanStatus
    name: str
    building_type: str
    total_area_sqm: float
    room_count: int
    processing_mode: ProcessingMode
    source_file: str
    status_message: str | None = None
    progress_pct: int | None = None
    updated_at: str | None = None
