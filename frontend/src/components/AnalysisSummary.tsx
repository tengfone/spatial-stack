import { ChevronDown, FileImage, X } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { PlanAnalysis, SpaceGeometry } from "@/lib/api-client";

const roomLabels: Record<string, string> = {
  living_room: "Living",
  bedroom: "Bedroom",
  kitchen: "Kitchen",
  bathroom: "Bath",
  hallway: "Hall",
  office: "Office",
  dining_room: "Dining",
  storage: "Storage",
  balcony: "Balcony",
  utility: "Utility",
};

const roomSwatches: Record<string, string> = {
  living_room: "oklch(0.78 0.035 245)",
  bedroom: "oklch(0.80 0.035 145)",
  kitchen: "oklch(0.84 0.045 75)",
  bathroom: "oklch(0.80 0.035 210)",
  hallway: "oklch(0.80 0.01 95)",
  office: "oklch(0.78 0.035 300)",
  dining_room: "oklch(0.79 0.035 165)",
  storage: "oklch(0.79 0.01 250)",
  balcony: "oklch(0.80 0.045 125)",
  utility: "oklch(0.78 0.02 45)",
};

export function AnalysisSummary({
  analysis,
  originalFileUrl,
  originalPreviewContentType,
  onClose,
}: {
  analysis: PlanAnalysis;
  originalFileUrl?: string | null;
  originalPreviewContentType?: string | null;
  onClose?: () => void;
}) {
  const furnitureCount = analysis.rooms.reduce((total, room) => total + room.furniture.length, 0);
  const previewContentType = originalPreviewContentType ?? analysis.contentType;
  const detectedItems = detectedAnalysisItems(analysis);
  const hasSpaceGeometry = (analysis.spaces?.length ?? 0) > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[0.875rem] font-semibold leading-tight">{analysis.name}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
            <span className="truncate">{analysis.sourceFile}</span>
            <span className="mono-data rounded bg-secondary px-1.5 py-0.5 text-[0.625rem]">
              {analysis.processingMode.toUpperCase()}
            </span>
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="ml-2 shrink-0 rounded p-1 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            aria-label="Close details panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border">
        <MetricCell label="TYPE" value={analysis.buildingType} />
        <MetricCell label="TOTAL AREA" value={`${analysis.totalAreaSqm.toFixed(1)} m²`} />
        <MetricCell label="FLOORS" value={String(analysis.floors)} />
        <MetricCell label={hasSpaceGeometry ? "SPACES" : "ROOMS"} value={String(detectedItems.length)} />
      </div>

      <div className="shrink-0 border-b border-border px-4 py-3">
        <h3 className="section-label">Scores</h3>
        <div className="mt-2.5 space-y-3">
          <ScoreRow label="Furniture fit" value={analysis.metrics.furnitureFitScore} />
          <ScoreRow label="Sightline continuity" value={analysis.metrics.sightlineScore} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded bg-border">
          <MiniMetric label="FURNITURE" value={String(furnitureCount)} />
          <MiniMetric label="CIRCULATION" value={`${analysis.metrics.circulationAreaSqm.toFixed(1)} m²`} />
          <MiniMetric label="WALL LENGTH" value={`${analysis.metrics.estimatedWallLengthM.toFixed(1)} m`} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="section-label">{hasSpaceGeometry ? "Detected Spaces" : "Detected Rooms"}</h3>
            <span className="mono-data text-[0.625rem] text-muted-foreground">
              {detectedItems.length}
            </span>
          </div>
          <div className="mt-2 divide-y divide-border">
            {detectedItems.map((item, i) => (
              <div
                key={item.id}
                className={`flex items-center justify-between gap-3 ${i === 0 ? "pb-2" : "py-2"}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ background: roomSwatches[item.swatchType] ?? roomSwatches.storage }}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{item.name}</div>
                    <div className="truncate text-[0.6875rem] text-muted-foreground">
                      {item.typeLabel} · {item.widthM.toFixed(1)} × {item.depthM.toFixed(1)} m
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="mono-data">{item.areaSqm.toFixed(1)} m²</div>
                  <div className="mono-data text-muted-foreground">{Math.round(item.confidence * 100)}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {analysis.notes ? (
          <div className="border-t border-border px-4 py-3">
            <h3 className="section-label">Notes</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{analysis.notes}</p>
          </div>
        ) : null}

        {originalFileUrl ? (
          <details className="group border-t border-border px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="section-label flex items-center gap-1.5">
                <FileImage className="h-3 w-3" />
                Original Plan
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
            </summary>
            <div className="mt-2 overflow-hidden rounded border border-border bg-background">
              <OriginalPlanPreview url={originalFileUrl} contentType={previewContentType} />
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

type DetectedAnalysisItem = {
  id: string;
  name: string;
  typeLabel: string;
  swatchType: keyof typeof roomSwatches;
  widthM: number;
  depthM: number;
  areaSqm: number;
  confidence: number;
};

function detectedAnalysisItems(analysis: PlanAnalysis): DetectedAnalysisItem[] {
  const spaces = analysis.spaces?.filter((space) => space.polygon.length >= 3) ?? [];
  if (spaces.length > 0) {
    return spaces.map((space) => detectedSpaceItem(space));
  }

  return analysis.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    typeLabel: roomLabels[room.type] ?? humanizeType(room.type),
    swatchType: swatchType(room.type),
    widthM: room.widthM,
    depthM: room.depthM,
    areaSqm: room.areaSqm,
    confidence: room.confidence,
  }));
}

function detectedSpaceItem(space: SpaceGeometry): DetectedAnalysisItem {
  const bounds = polygonBounds(space.polygon);
  return {
    id: space.id,
    name: titleCaseLabel(space.label),
    typeLabel: spaceTypeLabel(space),
    swatchType: swatchType(space.type),
    widthM: bounds.widthM,
    depthM: bounds.depthM,
    areaSqm: space.areaSqm ?? polygonArea(space.polygon),
    confidence: space.confidence,
  };
}

function spaceTypeLabel(space: SpaceGeometry) {
  if (space.type === "closet") return "Closet";
  const normalized = swatchType(space.type);
  return roomLabels[normalized] ?? humanizeType(space.type);
}

function swatchType(type: string): keyof typeof roomSwatches {
  if (type === "closet") return "storage";
  if (type in roomSwatches) return type as keyof typeof roomSwatches;
  return "storage";
}

function polygonBounds(polygon: SpaceGeometry["polygon"]) {
  const xs = polygon.map((point) => point.xM);
  const ys = polygon.map((point) => point.yM);
  return {
    widthM: Math.max(...xs) - Math.min(...xs),
    depthM: Math.max(...ys) - Math.min(...ys),
  };
}

function polygonArea(polygon: SpaceGeometry["polygon"]) {
  let total = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    total += current.xM * next.yM - next.xM * current.yM;
  }
  return Math.abs(total) / 2;
}

function titleCaseLabel(label: string) {
  if (!label) return "Space";
  return label
    .toLowerCase()
    .split(" ")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function humanizeType(type: string) {
  return titleCaseLabel(type.replace(/[_-]+/g, " "));
}

function OriginalPlanPreview({ url, contentType }: { url: string; contentType?: string | null }) {
  if (isPdfContentType(contentType)) {
    return (
      <iframe
        src={pdfPreviewUrl(url)}
        title="Original PDF floor plan preview"
        loading="lazy"
        className="h-60 w-full border-0 bg-surface"
      />
    );
  }

  return (
    <img
      src={url}
      alt="Original uploaded floor plan"
      className="max-h-60 w-full object-contain"
      loading="lazy"
    />
  );
}

function isPdfContentType(contentType?: string | null) {
  return (contentType ?? "").toLowerCase().includes("pdf");
}

function pdfPreviewUrl(url: string) {
  return `${url}${url.includes("#") ? "&" : "#"}page=1&toolbar=0&navpanes=0&scrollbar=0`;
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[0.875rem] font-semibold tabular-nums" title={value}>
        {value}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-2.5 py-1.5">
      <div className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate mono-data" title={value}>
        {value}
      </div>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium">{label}</span>
        <span className="mono-data">{Math.round(value)}%</span>
      </div>
      <Progress value={value} />
    </div>
  );
}
