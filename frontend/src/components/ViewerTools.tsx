import {
  Download,
  Eye,
  Image as ImageIcon,
  Layers,
  Paintbrush,
  PersonStanding,
  Ruler,
  RotateCw,
  Sofa,
  Sun,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { FLOOR_MATERIALS, type FloorMaterialKey, type ViewMode, WALL_COLORS, type WallColorKey } from "@/components/SpatialViewer";
import { cn } from "@/lib/utils";

export type ToolId = "measure" | "source" | "furniture" | "sun" | "walk" | "materials" | "export";

type ViewerToolsProps = {
  activeTool: ToolId | null;
  onActiveToolChange: (tool: ToolId | null) => void;
  viewMode: ViewMode;
  onViewModeChange: (viewMode: ViewMode) => void;
  measureMode: boolean;
  onMeasureModeChange: (enabled: boolean) => void;
  measureResult: number | null;
  measurementScale: number;
  onMeasurementScaleChange: (scale: number) => void;
  hasSourceOverlay: boolean;
  showSourceOverlay: boolean;
  onSourceOverlayToggle: () => void;
  sourceOverlayOpacity: number;
  onSourceOverlayOpacityChange: (opacity: number) => void;
  showFurniture: boolean;
  onFurnitureToggle: () => void;
  autoRotate: boolean;
  onAutoRotateToggle: () => void;
  sunHour: number;
  onSunHourChange: (hour: number) => void;
  compassDeg: number;
  onCompassChange: (degrees: number) => void;
  firstPersonMode: boolean;
  onFirstPersonToggle: () => void;
  floorMaterial: FloorMaterialKey;
  onFloorMaterialChange: (material: FloorMaterialKey) => void;
  wallColor: WallColorKey;
  onWallColorChange: (wallColor: WallColorKey) => void;
  onExportSvg: () => void;
  onExportJson: () => void;
};

const tools: Array<{ id: ToolId; icon: typeof Ruler; label: string }> = [
  { id: "measure", icon: Ruler, label: "Measure" },
  { id: "source", icon: ImageIcon, label: "Source" },
  { id: "furniture", icon: Sofa, label: "Furniture" },
  { id: "sun", icon: Sun, label: "Sun" },
  { id: "walk", icon: PersonStanding, label: "Walk" },
  { id: "materials", icon: Paintbrush, label: "Materials" },
  { id: "export", icon: Download, label: "Export" },
];

const compassPoints = [
  { label: "N", deg: 0 },
  { label: "NE", deg: 45 },
  { label: "E", deg: 90 },
  { label: "SE", deg: 135 },
  { label: "S", deg: 180 },
  { label: "SW", deg: 225 },
  { label: "W", deg: 270 },
  { label: "NW", deg: 315 },
];

const hourLabels: Record<number, string> = {
  6: "Sunrise",
  9: "Morning",
  12: "Noon",
  15: "Afternoon",
  18: "Sunset",
  21: "Night",
};

export function ViewerTools({
  activeTool,
  onActiveToolChange,
  viewMode,
  onViewModeChange,
  measureMode,
  onMeasureModeChange,
  measureResult,
  measurementScale,
  onMeasurementScaleChange,
  hasSourceOverlay,
  showSourceOverlay,
  onSourceOverlayToggle,
  sourceOverlayOpacity,
  onSourceOverlayOpacityChange,
  showFurniture,
  onFurnitureToggle,
  autoRotate,
  onAutoRotateToggle,
  sunHour,
  onSunHourChange,
  compassDeg,
  onCompassChange,
  firstPersonMode,
  onFirstPersonToggle,
  floorMaterial,
  onFloorMaterialChange,
  wallColor,
  onWallColorChange,
  onExportSvg,
  onExportJson,
}: ViewerToolsProps) {
  return (
    <div className="w-[min(680px,calc(100vw-376px))] min-w-[380px]">
      <div className="flex flex-wrap items-center gap-0.5 rounded border border-border bg-surface px-1 py-1 shadow-panel">
        <div className="mr-0.5 flex items-center gap-0.5 border-r border-border pr-1">
          <ToolButton
            active={viewMode === "3d"}
            icon={Eye}
            label="3D"
            onClick={() => onViewModeChange("3d")}
          />
          <ToolButton
            active={viewMode === "top"}
            icon={Layers}
            label="Top"
            onClick={() => onViewModeChange("top")}
          />
          <ToolButton
            active={viewMode === "3d" && autoRotate}
            disabled={viewMode !== "3d"}
            icon={RotateCw}
            label="Auto"
            onClick={onAutoRotateToggle}
          />
        </div>
        {tools.map(({ id, icon, label }) => (
          <ToolButton
            key={id}
            active={activeTool === id}
            icon={icon}
            label={label}
            onClick={() => onActiveToolChange(activeTool === id ? null : id)}
          />
        ))}
      </div>

      {activeTool ? (
        <div className="mt-1.5 rounded border border-border bg-surface p-3 shadow-panel">
          {activeTool === "measure" ? (
            <ToolSection title="Distance measurement" detail="Click two points in the model to measure.">
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant={measureMode ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-[0.6875rem]"
                  onClick={() => onMeasureModeChange(!measureMode)}
                >
                  <Ruler className="h-3 w-3" />
                  {measureMode ? "Measuring" : "Enable"}
                </Button>
                <div className="text-right">
                  <div className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Distance</div>
                  <div className="mono-data text-[0.875rem]">
                    {measureResult === null ? "---" : `${measureResult.toFixed(2)} m`}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_70px] items-center gap-2">
                <input
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.01}
                  value={measurementScale}
                  onChange={(event) => onMeasurementScaleChange(Number(event.currentTarget.value))}
                  className="w-full accent-[oklch(0.45_0.08_250)]"
                  aria-label="Measurement scale"
                />
                <input
                  type="number"
                  min={0.5}
                  max={1.5}
                  step={0.01}
                  value={measurementScale}
                  onChange={(event) => onMeasurementScaleChange(clampScale(Number(event.currentTarget.value)))}
                  className="h-7 rounded border border-border bg-background px-1.5 text-right text-[0.6875rem]"
                  aria-label="Measurement scale factor"
                />
              </div>
            </ToolSection>
          ) : null}

          {activeTool === "source" ? (
            <ToolSection title="Source overlay" detail="Top-view image overlay for comparing extraction against the submitted plan.">
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant={showSourceOverlay && hasSourceOverlay ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-[0.6875rem]"
                  onClick={onSourceOverlayToggle}
                  disabled={!hasSourceOverlay}
                >
                  <ImageIcon className="h-3 w-3" />
                  {showSourceOverlay && hasSourceOverlay ? "Visible" : "Hidden"}
                </Button>
                <input
                  type="range"
                  min={0.15}
                  max={0.75}
                  step={0.05}
                  value={sourceOverlayOpacity}
                  onChange={(event) => onSourceOverlayOpacityChange(Number(event.currentTarget.value))}
                  className="w-40 accent-[oklch(0.45_0.08_250)] disabled:opacity-45"
                  aria-label="Source overlay opacity"
                  disabled={!hasSourceOverlay}
                />
              </div>
            </ToolSection>
          ) : null}

          {activeTool === "furniture" ? (
            <ToolSection title="Furniture layer" detail="Detected placements and room-type defaults.">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-1 flex-wrap gap-1 text-[0.6875rem] text-muted-foreground">
                  {["Beds", "Sofas", "Tables", "Counters", "Fixtures", "Storage"].map((item) => (
                    <span key={item} className="rounded bg-secondary px-1.5 py-0.5">
                      {item}
                    </span>
                  ))}
                </div>
                <Button
                  type="button"
                  variant={showFurniture ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-[0.6875rem]"
                  onClick={onFurnitureToggle}
                >
                  <Sofa className="h-3 w-3" />
                  {showFurniture ? "Visible" : "Hidden"}
                </Button>
              </div>
            </ToolSection>
          ) : null}

          {activeTool === "sun" ? (
            <ToolSection title="Sun and orientation" detail="Light direction and shadow by time and compass.">
              <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{formatHour(sunHour)}</span>
                    <span className="text-muted-foreground">{nearestHourLabel(sunHour)}</span>
                  </div>
                  <input
                    type="range"
                    min={6}
                    max={21}
                    step={0.5}
                    value={sunHour}
                    onChange={(event) => onSunHourChange(Number(event.currentTarget.value))}
                    className="w-full accent-[oklch(0.45_0.08_250)]"
                    aria-label="Time of day"
                  />
                  <div className="mt-0.5 flex justify-between text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">
                    <span>Sunrise</span>
                    <span>Noon</span>
                    <span>Night</span>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {compassPoints.map(({ label, deg }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => onCompassChange(deg)}
                      className={cn(
                        "h-6 rounded border text-[0.6875rem] font-semibold transition-colors duration-150",
                        compassDeg === deg
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-secondary text-secondary-foreground hover:bg-[oklch(0.90_0.01_250)]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </ToolSection>
          ) : null}

          {activeTool === "walk" ? (
            <ToolSection title="Walk-through preview" detail="Low-angle inspection with keyboard and drag.">
              <div className="flex items-center justify-between gap-3">
                <div className="grid flex-1 grid-cols-2 gap-1 text-[0.6875rem] text-muted-foreground">
                  <span><kbd className="rounded bg-secondary px-1 font-mono text-[0.625rem] text-foreground">W/S</kbd> move</span>
                  <span><kbd className="rounded bg-secondary px-1 font-mono text-[0.625rem] text-foreground">Q/E</kbd> turn</span>
                  <span><kbd className="rounded bg-secondary px-1 font-mono text-[0.625rem] text-foreground">A/D</kbd> strafe</span>
                  <span><kbd className="rounded bg-secondary px-1 font-mono text-[0.625rem] text-foreground">Drag</kbd> inspect</span>
                </div>
                <Button
                  type="button"
                  variant={firstPersonMode ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-[0.6875rem]"
                  onClick={onFirstPersonToggle}
                >
                  <PersonStanding className="h-3 w-3" />
                  {firstPersonMode ? "Active" : "Preview"}
                </Button>
              </div>
            </ToolSection>
          ) : null}

          {activeTool === "materials" ? (
            <ToolSection title="Material preview" detail="Compare finishes on the extracted geometry.">
              <div className="grid gap-3 sm:grid-cols-2">
                <SwatchGroup
                  label="Floor"
                  value={floorMaterial}
                  items={FLOOR_MATERIALS}
                  onChange={(value) => onFloorMaterialChange(value as FloorMaterialKey)}
                />
                <SwatchGroup
                  label="Wall"
                  value={wallColor}
                  items={WALL_COLORS}
                  onChange={(value) => onWallColorChange(value as WallColorKey)}
                />
              </div>
            </ToolSection>
          ) : null}

          {activeTool === "export" ? (
            <ToolSection title="Export" detail="Download visualization or spatial contract.">
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" className="h-7 text-[0.6875rem]" onClick={onExportSvg}>
                  <Download className="h-3 w-3" />
                  SVG scene
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 text-[0.6875rem]" onClick={onExportJson}>
                  Spatial JSON
                </Button>
              </div>
            </ToolSection>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolButton({
  active,
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: typeof Ruler;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-6 items-center gap-1 rounded px-1.5 text-[0.6875rem] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
      aria-pressed={active}
      title={label}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function ToolSection({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5">
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{detail}</p>
      </div>
      {children}
    </div>
  );
}

function SwatchGroup({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: Record<string, { label: string; color: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="section-label mb-1.5">{label}</div>
      <div className="grid grid-cols-3 gap-1">
        {Object.entries(items).map(([key, item]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded border px-1.5 py-1 text-left text-[0.6875rem] font-medium transition-colors duration-150",
              value === key ? "border-primary bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: item.color }} />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function formatHour(hour: number) {
  const rounded = Math.floor(hour);
  const minutes = hour % 1 === 0 ? "00" : "30";
  const display = rounded > 12 ? rounded - 12 : rounded;
  return `${display}:${minutes} ${rounded >= 12 ? "PM" : "AM"}`;
}

function nearestHourLabel(hour: number) {
  const nearest = Object.keys(hourLabels)
    .map(Number)
    .reduce((best, next) => (Math.abs(next - hour) < Math.abs(best - hour) ? next : best), 12);
  return hourLabels[nearest];
}

function clampScale(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.5, Math.min(1.5, value));
}
