import { type MouseEvent, type PointerEvent, type ReactNode, type WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import { Navigation, Ruler, ZoomIn, ZoomOut } from "lucide-react";

import type { Fixture, FurnitureItem, Opening, PlanAnalysis, PlanLabel, PlanPoint, Room, RoomType, SpaceGeometry, WallSegment } from "@/lib/api-client";

type Point = { x: number; y: number };
type Viewport = { x: number; y: number; scale: number };
type WalkState = { xM: number; yM: number; yawDeg: number };
type DragStart = { clientX: number; clientY: number; rotation: number; viewport: Viewport; walkState: WalkState };

export type ViewMode = "3d" | "top";

export const FLOOR_MATERIALS = {
  default: { label: "Room tone", color: "var(--room-floor)" },
  hardwood: { label: "Hardwood", color: "oklch(0.52 0.09 55)" },
  tile: { label: "Stone tile", color: "oklch(0.82 0.018 78)" },
  carpet: { label: "Carpet", color: "oklch(0.62 0.025 245)" },
  concrete: { label: "Concrete", color: "oklch(0.66 0.008 250)" },
  marble: { label: "Marble", color: "oklch(0.93 0.008 70)" },
} as const;

export const WALL_COLORS = {
  white: { label: "White", color: "oklch(0.96 0.005 250)" },
  cream: { label: "Cream", color: "oklch(0.94 0.025 82)" },
  gray: { label: "Gray", color: "oklch(0.82 0.01 250)" },
  blue: { label: "Blue", color: "oklch(0.82 0.04 245)" },
  green: { label: "Sage", color: "oklch(0.80 0.04 155)" },
  charcoal: { label: "Charcoal", color: "oklch(0.32 0.012 250)" },
} as const;

export type FloorMaterialKey = keyof typeof FLOOR_MATERIALS;
export type WallColorKey = keyof typeof WALL_COLORS;

type SpatialViewerProps = {
  analysis: PlanAnalysis;
  viewMode: ViewMode;
  showFurniture: boolean;
  measureMode: boolean;
  firstPersonMode: boolean;
  sunHour: number;
  compassDeg: number;
  floorMaterial: FloorMaterialKey;
  wallColor: WallColorKey;
  autoRotate: boolean;
  sourceOverlayUrl?: string | null;
  sourceOverlayOpacity: number;
  showSourceOverlay: boolean;
  measurementScale: number;
  onMeasure: (distance: number | null) => void;
};

const roomColors: Record<RoomType, { floor: string; wall: string; stroke: string }> = {
  living_room: { floor: "oklch(0.78 0.035 245)", wall: "oklch(0.66 0.05 245)", stroke: "oklch(0.42 0.06 245)" },
  bedroom: { floor: "oklch(0.80 0.035 145)", wall: "oklch(0.66 0.045 145)", stroke: "oklch(0.42 0.05 145)" },
  kitchen: { floor: "oklch(0.84 0.045 75)", wall: "oklch(0.70 0.055 75)", stroke: "oklch(0.47 0.06 75)" },
  bathroom: { floor: "oklch(0.80 0.035 210)", wall: "oklch(0.67 0.045 210)", stroke: "oklch(0.43 0.05 210)" },
  hallway: { floor: "oklch(0.80 0.01 95)", wall: "oklch(0.68 0.012 95)", stroke: "oklch(0.47 0.014 95)" },
  office: { floor: "oklch(0.78 0.035 300)", wall: "oklch(0.65 0.045 300)", stroke: "oklch(0.43 0.05 300)" },
  dining_room: { floor: "oklch(0.79 0.035 165)", wall: "oklch(0.66 0.045 165)", stroke: "oklch(0.43 0.05 165)" },
  storage: { floor: "oklch(0.79 0.01 250)", wall: "oklch(0.67 0.012 250)", stroke: "oklch(0.47 0.014 250)" },
  balcony: { floor: "oklch(0.80 0.045 125)", wall: "oklch(0.66 0.055 125)", stroke: "oklch(0.43 0.06 125)" },
  utility: { floor: "oklch(0.78 0.02 45)", wall: "oklch(0.66 0.03 45)", stroke: "oklch(0.45 0.035 45)" },
};

const MODEL_WALL_HEIGHT_M = 1.08;
const WALK_WALL_HEIGHT_M = 2.35;

function spaceColors(type: string): { floor: string; wall: string; stroke: string } {
  const token = type.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (token in roomColors) return roomColors[token as RoomType];
  if (token.includes("living")) return roomColors.living_room;
  if (token.includes("bed")) return roomColors.bedroom;
  if (token.includes("kitchen")) return roomColors.kitchen;
  if (token.includes("bath") || token.includes("wc") || token.includes("toilet")) return roomColors.bathroom;
  if (token.includes("hall") || token.includes("entry") || token.includes("corridor")) return roomColors.hallway;
  if (token.includes("balcony")) return roomColors.balcony;
  if (token.includes("laundry") || token.includes("utility")) return roomColors.utility;
  if (token.includes("closet") || token.includes("wardrobe") || token.includes("mech") || token.includes("storage")) {
    return { floor: "oklch(0.82 0.012 112)", wall: "oklch(0.70 0.018 112)", stroke: "oklch(0.45 0.022 112)" };
  }
  return roomColors.storage;
}

export function SpatialViewer({
  analysis,
  viewMode,
  showFurniture,
  measureMode,
  firstPersonMode,
  sunHour,
  compassDeg,
  floorMaterial,
  wallColor,
  autoRotate,
  sourceOverlayUrl,
  sourceOverlayOpacity,
  showSourceOverlay,
  measurementScale,
  onMeasure,
}: SpatialViewerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const [rotation, setRotation] = useState(-34);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [walkState, setWalkState] = useState<WalkState>(() => initialWalkState(analysis));
  const [dragStart, setDragStart] = useState<DragStart | null>(null);
  const [measurePoints, setMeasurePoints] = useState<Point[]>([]);
  const walkBounds = useMemo(() => analysisBounds(analysis), [analysis]);
  const sceneRotation = firstPersonMode ? walkState.yawDeg : rotation;
  const scene = useMemo(
    () => buildScene(analysis, viewMode, sceneRotation, firstPersonMode, walkState),
    [analysis, firstPersonMode, sceneRotation, viewMode, walkState],
  );
  const sun = useMemo(() => sunVector(sunHour, compassDeg), [sunHour, compassDeg]);
  const viewportTransform = `matrix(${viewport.scale} 0 0 ${viewport.scale} ${viewport.x} ${viewport.y})`;
  const zoomMin = firstPersonMode ? 0.9 : 0.62;
  const zoomMax = firstPersonMode ? 2.8 : 2.4;
  const zoomPercent = Math.round(viewport.scale * 100);

  useEffect(() => {
    setMeasurePoints([]);
    onMeasure(null);
  }, [analysis.id, measureMode, onMeasure, viewMode]);

  useEffect(() => {
    setViewport({ x: 0, y: 0, scale: 1 });
    setDragStart(null);
  }, [analysis.id, firstPersonMode, viewMode]);

  useEffect(() => {
    setWalkState(initialWalkState(analysis));
    pressedKeysRef.current.clear();
  }, [analysis]);

  useEffect(() => {
    if (!autoRotate || viewMode !== "3d" || firstPersonMode || measureMode || dragStart) {
      return undefined;
    }

    let animationFrame = 0;
    let lastTimestamp = performance.now();
    const tick = (timestamp: number) => {
      const deltaSeconds = Math.min(0.06, (timestamp - lastTimestamp) / 1000);
      lastTimestamp = timestamp;
      setRotation((current) => normalizeYaw(current + deltaSeconds * 9));
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [autoRotate, dragStart, firstPersonMode, measureMode, viewMode]);

  useEffect(() => {
    if (!firstPersonMode) {
      pressedKeysRef.current.clear();
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = normalizeWalkKey(event.key);
      if (!key) return;
      pressedKeysRef.current.add(key);
      event.preventDefault();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const key = normalizeWalkKey(event.key);
      if (!key) return;
      pressedKeysRef.current.delete(key);
      event.preventDefault();
    };

    let animationFrame = 0;
    let lastTimestamp = performance.now();
    const tick = (timestamp: number) => {
      const deltaSeconds = Math.min(0.08, (timestamp - lastTimestamp) / 1000);
      lastTimestamp = timestamp;
      if (pressedKeysRef.current.size > 0) {
        setWalkState((current) => advanceWalk(current, pressedKeysRef.current, deltaSeconds, walkBounds));
      }
      animationFrame = requestAnimationFrame(tick);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    animationFrame = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      cancelAnimationFrame(animationFrame);
      pressedKeysRef.current.clear();
    };
  }, [firstPersonMode, walkBounds]);

  const handleMeasureClick = (event: MouseEvent<SVGSVGElement>) => {
    if (!measureMode || !svgRef.current) return;
    event.stopPropagation();

    const point = inverseViewportPoint(clientToSvgPoint(svgRef.current, event.clientX, event.clientY), viewport);
    const nextPoints = measurePoints.length >= 2 ? [point] : [...measurePoints, point];
    setMeasurePoints(nextPoints);

    if (nextPoints.length === 2) {
      const distance = screenDistanceToMeters(nextPoints[0], nextPoints[1], scene.scale, viewMode, measurementScale);
      onMeasure(distance);
    } else {
      onMeasure(null);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (measureMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({ clientX: event.clientX, clientY: event.clientY, rotation, viewport, walkState });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;

    const dx = event.clientX - dragStart.clientX;
    const dy = event.clientY - dragStart.clientY;
    const delta = clientDeltaToSvg(svgRef.current, scene, dx, dy);

    if (firstPersonMode && viewMode === "3d") {
      const yawDeg = normalizeYaw(dragStart.walkState.yawDeg + dx * 0.18);
      const yawRad = (yawDeg * Math.PI) / 180;
      const distanceM = clamp(-dy * 0.012, -1.8, 1.8);
      setWalkState(clampWalk({
        xM: dragStart.walkState.xM + Math.sin(yawRad) * distanceM,
        yM: dragStart.walkState.yM + Math.cos(yawRad) * distanceM,
        yawDeg,
      }, walkBounds));
      return;
    }

    if (viewMode === "top") {
      setViewport({
        ...dragStart.viewport,
        x: dragStart.viewport.x + delta.x,
        y: dragStart.viewport.y + delta.y,
      });
      return;
    }

    setRotation(dragStart.rotation + dx * (firstPersonMode ? 0.18 : 0.34));
    setViewport({
      ...dragStart.viewport,
      x: dragStart.viewport.x + delta.x * (firstPersonMode ? 0.45 : 0.22),
      y: dragStart.viewport.y + delta.y * (firstPersonMode ? 0.72 : 0.5),
    });
  };

  const zoomViewport = (pointer: Point, factor: number) => {
    setViewport((current) => {
      const nextScale = clamp(current.scale * factor, zoomMin, zoomMax);
      const anchoredPoint = inverseViewportPoint(pointer, current);
      return {
        scale: nextScale,
        x: pointer.x - anchoredPoint.x * nextScale,
        y: pointer.y - anchoredPoint.y * nextScale,
      };
    });
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!svgRef.current) return;
    event.preventDefault();

    zoomViewport(clientToSvgPoint(svgRef.current, event.clientX, event.clientY), event.deltaY > 0 ? 0.9 : 1.1);
  };

  const handleZoomButton = (factor: number) => {
    zoomViewport({ x: scene.width / 2, y: scene.height / 2 }, factor);
  };

  return (
    <div className="relative flex h-full flex-col">
      <div
        className="viewer-surface"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDragStart(null)}
        onPointerCancel={() => setDragStart(null)}
        onWheel={handleWheel}
        style={{ cursor: measureMode ? "crosshair" : dragStart ? "grabbing" : "grab" }}
      >
        <svg
          ref={svgRef}
          data-spatial-viewer-svg
          className="h-full w-full"
          viewBox={`0 0 ${scene.width} ${scene.height}`}
          role="img"
          aria-label="Interactive spatial model"
          onClick={handleMeasureClick}
        >
          <defs>
            <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="oklch(0.22 0.01 250)" floodOpacity="0.12" />
            </filter>
            <linearGradient id="sun-wash" x1={sun.gradient.x1} y1={sun.gradient.y1} x2={sun.gradient.x2} y2={sun.gradient.y2}>
              <stop offset="0%" stopColor={sun.color} stopOpacity={sun.opacity} />
              <stop offset="100%" stopColor="oklch(0.985 0.004 250)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect width={scene.width} height={scene.height} fill="url(#sun-wash)" />
          {firstPersonMode ? <WalkBackdrop scene={scene} /> : null}

          <g transform={viewportTransform}>
            {viewMode === "top" ? (
              <TopGrid scene={scene} />
            ) : (
              <g filter="url(#soft-shadow)">
                {scene.usesGeometry ? (
                  <GeometryModel scene={scene} showFurniture={showFurniture} floorMaterial={floorMaterial} wallColor={wallColor} sun={sun} />
                ) : (
                  scene.rooms.map((room) => (
                    <RoomPrism
                      key={room.room.id}
                      projected={room}
                      showFurniture={showFurniture}
                      floorMaterial={floorMaterial}
                      wallColor={wallColor}
                      sun={sun}
                    />
                  ))
                )}
              </g>
            )}

            {viewMode === "top" ? (
              <g>
                {scene.usesGeometry ? (
                  <TopGeometry
                    scene={scene}
                    showFurniture={showFurniture}
                    floorMaterial={floorMaterial}
                    sourceOverlayUrl={showSourceOverlay ? sourceOverlayUrl : null}
                    sourceOverlayOpacity={sourceOverlayOpacity}
                  />
                ) : (
                  scene.rooms.map((room) => (
                    <TopRoom
                      key={room.room.id}
                      projected={room}
                      showFurniture={showFurniture}
                      floorMaterial={floorMaterial}
                    />
                  ))
                )}
              </g>
            ) : null}

            <MeasurementOverlay points={measurePoints} />
          </g>

          {firstPersonMode ? <WalkHud scene={scene} /> : null}
        </svg>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5">
        <span className="mono-data rounded border border-border bg-surface px-1.5 py-0.5 text-muted-foreground shadow-panel">
          {firstPersonMode ? "WALK" : viewMode === "top" ? "TOP" : autoRotate ? `AUTO ${Math.round(sceneRotation)} deg` : `${Math.round(sceneRotation)} deg`}
        </span>
        {firstPersonMode ? (
          <span className="mono-data rounded border border-border bg-surface px-1.5 py-0.5 text-muted-foreground shadow-panel">
            {walkState.xM.toFixed(1)}, {walkState.yM.toFixed(1)}
          </span>
        ) : null}
        <div className="pointer-events-auto flex h-7 items-center overflow-hidden rounded border border-border bg-surface shadow-panel" role="group" aria-label="Zoom controls">
          <button
            type="button"
            onClick={() => handleZoomButton(0.86)}
            disabled={viewport.scale <= zoomMin + 0.001}
            className="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="mono-data min-w-10 border-x border-border px-1.5 text-center text-muted-foreground">
            {zoomPercent}%
          </span>
          <button
            type="button"
            onClick={() => handleZoomButton(1.16)}
            disabled={viewport.scale >= zoomMax - 0.001}
            className="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
        {measureMode ? (
          <span className="flex items-center gap-1 rounded border border-[oklch(0.82_0.10_72)] bg-[oklch(0.95_0.035_72)] px-1.5 py-0.5 text-[0.6875rem] font-medium text-[oklch(0.42_0.08_72)] shadow-panel">
            <Ruler className="h-3 w-3" />
            {measurePoints.length === 0 ? "Click first point" : measurePoints.length === 1 ? "Click second point" : "Click to reset"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RoomPrism({
  projected,
  showFurniture,
  floorMaterial,
  wallColor,
  sun,
}: {
  projected: ProjectedRoom;
  showFurniture: boolean;
  floorMaterial: FloorMaterialKey;
  wallColor: WallColorKey;
  sun: ReturnType<typeof sunVector>;
}) {
  const colors = roomColors[projected.room.type] ?? roomColors.storage;
  const floorFill = floorMaterial === "default" ? colors.floor : FLOOR_MATERIALS[floorMaterial].color;
  const wallFill = wallColor === "white" ? colors.wall : WALL_COLORS[wallColor].color;

  return (
    <g>
      <polygon
        points={points(offsetPoints(projected.floor, sun.shadow.x * projected.shadowLength, sun.shadow.y * projected.shadowLength))}
        fill="oklch(0.22 0.012 250)"
        opacity={sun.shadowOpacity}
      />
      <polygon points={points(projected.walls.back)} fill={wallFill} opacity="0.74" stroke={colors.stroke} strokeWidth="1" />
      <polygon points={points(projected.walls.left)} fill={wallFill} opacity="0.58" stroke={colors.stroke} strokeWidth="1" />
      <polygon points={points(projected.walls.right)} fill={wallFill} opacity="0.52" stroke={colors.stroke} strokeWidth="1" />
      <polygon points={points(projected.floor)} fill={floorFill} stroke={colors.stroke} strokeWidth="1.4" />
      {showFurniture ? projected.furniture.map((item) => <FurnitureBlock key={item.item.id} block={item} />) : null}
      <RoomLabel projected={projected} />
    </g>
  );
}

function TopRoom({
  projected,
  showFurniture,
  floorMaterial,
}: {
  projected: ProjectedRoom;
  showFurniture: boolean;
  floorMaterial: FloorMaterialKey;
}) {
  const colors = roomColors[projected.room.type] ?? roomColors.storage;
  const fill = floorMaterial === "default" ? colors.floor : FLOOR_MATERIALS[floorMaterial].color;

  return (
    <g>
      <polygon points={points(projected.floor)} fill={fill} stroke={colors.stroke} strokeWidth="1.4" />
      {showFurniture ? projected.furniture.map((item) => <FurnitureBlock key={item.item.id} block={item} flat />) : null}
      <RoomLabel projected={projected} />
    </g>
  );
}

function TopGrid({ scene }: { scene: Scene }) {
  const lines = [];
  const step = Math.max(20, scene.scale);
  for (let x = scene.bounds.x; x <= scene.bounds.x + scene.bounds.width; x += step) {
    lines.push(<line key={`x-${x}`} x1={x} y1={scene.bounds.y} x2={x} y2={scene.bounds.y + scene.bounds.height} stroke="oklch(0.88 0.008 250)" strokeWidth="0.8" />);
  }
  for (let y = scene.bounds.y; y <= scene.bounds.y + scene.bounds.height; y += step) {
    lines.push(<line key={`y-${y}`} x1={scene.bounds.x} y1={y} x2={scene.bounds.x + scene.bounds.width} y2={y} stroke="oklch(0.88 0.008 250)" strokeWidth="0.8" />);
  }
  return <g opacity="0.7">{lines}</g>;
}

function WalkBackdrop({ scene }: { scene: Scene }) {
  return (
    <g pointerEvents="none">
      <rect x="0" y="0" width={scene.width} height={scene.height} fill="oklch(0.94 0.008 250)" opacity="0.58" />
      <path
        d={`M 0 ${scene.height * 0.62} C ${scene.width * 0.32} ${scene.height * 0.54}, ${scene.width * 0.68} ${scene.height * 0.54}, ${scene.width} ${scene.height * 0.62} L ${scene.width} ${scene.height} L 0 ${scene.height} Z`}
        fill="oklch(0.88 0.012 250)"
        opacity="0.44"
      />
      <line
        x1={scene.width * 0.08}
        y1={scene.height * 0.62}
        x2={scene.width * 0.92}
        y2={scene.height * 0.62}
        stroke="oklch(0.78 0.012 250)"
        strokeWidth="1"
        strokeDasharray="8 8"
      />
    </g>
  );
}

function WalkHud({ scene }: { scene: Scene }) {
  return (
    <g pointerEvents="none">
      <rect
        x={scene.width / 2 - 124}
        y={scene.height - 76}
        width="248"
        height="42"
        rx="6"
        fill="oklch(0.985 0.004 250 / 0.94)"
        stroke="oklch(0.88 0.008 250)"
      />
      <Navigation x={scene.width / 2 - 106} y={scene.height - 64} width={16} height={16} color="oklch(0.45 0.08 250)" />
      <text x={scene.width / 2 - 82} y={scene.height - 53} className="fill-slate-700 text-[11px] font-semibold">
        Walk-through preview
      </text>
      <line x1={scene.width / 2 - 12} y1={scene.height / 2} x2={scene.width / 2 + 12} y2={scene.height / 2} stroke="oklch(0.45 0.08 250)" strokeWidth="1.5" opacity="0.55" />
      <line x1={scene.width / 2} y1={scene.height / 2 - 12} x2={scene.width / 2} y2={scene.height / 2 + 12} stroke="oklch(0.45 0.08 250)" strokeWidth="1.5" opacity="0.55" />
    </g>
  );
}

function GeometryModel({
  scene,
  showFurniture,
  floorMaterial,
  wallColor,
  sun,
}: {
  scene: Scene;
  showFurniture: boolean;
  floorMaterial: FloorMaterialKey;
  wallColor: WallColorKey;
  sun: ReturnType<typeof sunVector>;
}) {
  return (
    <g>
      {scene.floorPlate.length >= 3 ? (
        <>
          <polygon
            points={points(offsetPoints(scene.floorPlate, sun.shadow.x * 0.12, sun.shadow.y * 0.12))}
            fill="oklch(0.22 0.012 250)"
            opacity={sun.shadowOpacity}
          />
          <polygon points={points(scene.floorPlate)} fill="oklch(0.90 0.008 250)" stroke="oklch(0.68 0.012 250)" strokeWidth="1.1" />
        </>
      ) : null}

      {scene.spaces.map((space) => (
        <polygon
          key={`${space.space.id}-shadow`}
          points={points(offsetPoints(space.floor, sun.shadow.x * space.shadowLength, sun.shadow.y * space.shadowLength))}
          fill="oklch(0.22 0.012 250)"
          opacity={sun.shadowOpacity * 0.72}
        />
      ))}

      {scene.spaces.map((space) => (
        <SpaceFloor key={space.space.id} projected={space} floorMaterial={floorMaterial} />
      ))}

      {scene.walls.map((wall) => <WallExtrusion key={wall.wall.id} wall={wall} wallColor={wallColor} />)}
      {scene.openings.map((opening) => <OpeningGlyph key={opening.opening.id} projected={opening} mode="3d" />)}
      {showFurniture ? <GeometryFurnitureLayer scene={scene} /> : null}
      {scene.labels.map((label) => <PlanTextLabel key={label.label.id} projected={label} />)}
    </g>
  );
}

function TopGeometry({
  scene,
  showFurniture,
  floorMaterial,
  sourceOverlayUrl,
  sourceOverlayOpacity,
}: {
  scene: Scene;
  showFurniture: boolean;
  floorMaterial: FloorMaterialKey;
  sourceOverlayUrl?: string | null;
  sourceOverlayOpacity: number;
}) {
  const hasSourceOverlay = Boolean(sourceOverlayUrl);

  return (
    <g>
      {sourceOverlayUrl ? <SourceOverlay scene={scene} url={sourceOverlayUrl} opacity={sourceOverlayOpacity} /> : null}

      {scene.floorPlate.length >= 3 ? (
        <polygon
          points={points(scene.floorPlate)}
          fill="oklch(0.92 0.008 250)"
          stroke="oklch(0.70 0.012 250)"
          strokeWidth="1.1"
          opacity={hasSourceOverlay ? 0.28 : 1}
        />
      ) : null}

      {scene.spaces.map((space) => (
        <SpaceFloor key={space.space.id} projected={space} floorMaterial={floorMaterial} opacity={hasSourceOverlay ? 0.58 : 0.92} />
      ))}

      {showFurniture ? <GeometryFurnitureLayer scene={scene} flat /> : null}

      {scene.walls.map((wall) => <TopWall key={wall.wall.id} wall={wall} />)}
      {scene.openings.map((opening) => <OpeningGlyph key={opening.opening.id} projected={opening} mode="top" />)}
      {scene.labels.map((label) => <PlanTextLabel key={label.label.id} projected={label} />)}
    </g>
  );
}

function SourceOverlay({ scene, url, opacity }: { scene: Scene; url: string; opacity: number }) {
  const bounds = scene.floorPlate.length >= 3 ? screenBounds(scene.floorPlate) : scene.bounds;

  return (
    <image
      href={url}
      x={bounds.x}
      y={bounds.y}
      width={Math.max(1, bounds.width)}
      height={Math.max(1, bounds.height)}
      opacity={opacity}
      preserveAspectRatio="none"
    />
  );
}

function SpaceFloor({ projected, floorMaterial, opacity = 0.92 }: { projected: ProjectedSpace; floorMaterial: FloorMaterialKey; opacity?: number }) {
  const colors = spaceColors(projected.space.type);
  const fill = floorMaterial === "default" ? colors.floor : FLOOR_MATERIALS[floorMaterial].color;

  return (
    <g>
      <polygon points={points(projected.floor)} fill={fill} stroke={colors.stroke} strokeWidth="1.05" opacity={opacity} />
    </g>
  );
}

function GeometryFurnitureLayer({ scene, flat = false }: { scene: Scene; flat?: boolean }) {
  const blocks = [
    ...scene.fixtures.map((fixture) => ({
      key: `fixture-${fixture.fixture.id}`,
      sortY: averageY(fixture.bottom),
      node: <FixtureBlock block={fixture} flat={flat} />,
    })),
    ...scene.rooms.flatMap((room) => room.furniture
      .filter((item) => !scene.fixtures.length || !isBuiltInFixtureFurniture(item.item))
      .map((item) => ({
        key: `room-${room.room.id}-${item.item.id}`,
        sortY: averageY(item.bottom),
        node: <FurnitureBlock block={item} flat={flat} />,
      }))),
  ].sort((a, b) => a.sortY - b.sortY);

  return (
    <>
      {blocks.map((block) => (
        <g key={block.key}>{block.node}</g>
      ))}
    </>
  );
}

function WallExtrusion({ wall, wallColor }: { wall: ProjectedWall; wallColor: WallColorKey }) {
  const fill = wallColor === "white" ? "oklch(0.93 0.006 250)" : WALL_COLORS[wallColor].color;
  const edgeStroke = wallColor === "charcoal" ? "oklch(0.18 0.012 250)" : "oklch(0.26 0.016 250)";
  const baseStrokeWidth = Math.max(2.4, Math.min(5.2, wall.wall.thicknessM * wall.scale * 0.68));

  return (
    <g>
      {wall.segments.map((segment, index) => (
        <g key={`${wall.wall.id}-${index}`}>
          <polygon
            points={points([segment.topStart, segment.topEnd, segment.end, segment.start])}
            fill={fill}
            stroke={edgeStroke}
            strokeWidth="1.15"
            opacity={wallColor === "charcoal" ? "0.72" : "0.84"}
          />
          <line
            x1={segment.start.x}
            y1={segment.start.y}
            x2={segment.end.x}
            y2={segment.end.y}
            stroke={edgeStroke}
            strokeWidth={baseStrokeWidth}
            strokeLinecap="square"
            opacity="0.88"
          />
          <line
            x1={segment.topStart.x}
            y1={segment.topStart.y}
            x2={segment.topEnd.x}
            y2={segment.topEnd.y}
            stroke={edgeStroke}
            strokeWidth="1.35"
            strokeLinecap="square"
            opacity="0.94"
          />
        </g>
      ))}
    </g>
  );
}

function TopWall({ wall }: { wall: ProjectedWall }) {
  return (
    <g>
      {wall.polyline.map((point, index) => {
        const next = wall.polyline[index + 1];
        if (!next) return null;
        return (
          <line
            key={`${wall.wall.id}-${index}`}
            x1={point.x}
            y1={point.y}
            x2={next.x}
            y2={next.y}
            stroke="oklch(0.18 0.01 250)"
            strokeWidth={Math.max(3, wall.wall.thicknessM * wall.scale)}
            strokeLinecap="square"
          />
        );
      })}
    </g>
  );
}

function OpeningGlyph({ projected, mode }: { projected: ProjectedOpening; mode: "3d" | "top" }) {
  const stroke = projected.opening.kind === "window" ? "oklch(0.62 0.07 220)" : "oklch(0.43 0.08 250)";
  const strokeWidth = mode === "top" ? 2.2 : 1.45;

  return (
    <g>
      <line
        x1={projected.line[0].x}
        y1={projected.line[0].y}
        x2={projected.line[1].x}
        y2={projected.line[1].y}
        stroke="oklch(0.985 0.004 250)"
        strokeWidth={strokeWidth + 2}
        strokeLinecap="round"
      />
      <line
        x1={projected.line[0].x}
        y1={projected.line[0].y}
        x2={projected.line[1].x}
        y2={projected.line[1].y}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {projected.opening.kind === "door" && projected.swing ? (
        <path
          d={`M ${projected.swing.hinge.x.toFixed(1)} ${projected.swing.hinge.y.toFixed(1)} Q ${projected.swing.control.x.toFixed(1)} ${projected.swing.control.y.toFixed(1)} ${projected.swing.end.x.toFixed(1)} ${projected.swing.end.y.toFixed(1)}`}
          fill="none"
          stroke={stroke}
          strokeWidth="1"
          strokeDasharray={mode === "top" ? "none" : "4 3"}
          opacity="0.78"
        />
      ) : null}
    </g>
  );
}

function FixtureBlock({ block, flat = false }: { block: ProjectedFixture; flat?: boolean }) {
  const item: FurnitureItem = {
    id: block.fixture.id,
    kind: block.fixture.kind,
    widthM: block.fixture.widthM,
    depthM: block.fixture.depthM,
    xM: block.fixture.xM,
    yM: block.fixture.yM,
    rotationDeg: block.fixture.rotationDeg,
  };

  return <FurnitureBlock block={{ item, bottom: block.bottom, top: block.top, front: block.front, right: block.right }} flat={flat} />;
}

function PlanTextLabel({ projected }: { projected: ProjectedPlanLabel }) {
  if (!projected.labelSpec.visible) return null;

  return (
    <text
      x={projected.point.x}
      y={projected.point.y}
      textAnchor="middle"
      dominantBaseline="middle"
      className="select-none fill-slate-800 font-bold"
      fontSize={projected.labelSpec.titleFontSize}
      paintOrder="stroke"
      stroke="oklch(0.985 0.004 250)"
      strokeWidth="3"
      strokeLinejoin="round"
    >
      {projected.labelSpec.title}
    </text>
  );
}

function RoomLabel({ projected }: { projected: ProjectedRoom }) {
  if (!projected.labelSpec.visible) return null;

  return (
    <g>
      <text
        x={projected.label.x}
        y={projected.label.y}
        textAnchor="middle"
        dominantBaseline="middle"
        className="select-none fill-slate-800 font-bold"
        fontSize={projected.labelSpec.titleFontSize}
        paintOrder="stroke"
        stroke="oklch(0.985 0.004 250)"
        strokeWidth="3"
        strokeLinejoin="round"
      >
        {projected.labelSpec.title}
      </text>
      {projected.labelSpec.showArea ? (
        <text
          x={projected.label.x}
          y={projected.label.y + projected.labelSpec.titleFontSize + 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="select-none fill-slate-600 font-semibold"
          fontSize={projected.labelSpec.areaFontSize}
          paintOrder="stroke"
          stroke="oklch(0.985 0.004 250)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        >
          {projected.room.areaSqm.toFixed(1)} sqm
        </text>
      ) : null}
    </g>
  );
}

function FurnitureBlock({ block, flat = false }: { block: ProjectedFurniture; flat?: boolean }) {
  const role = furnitureRole(block.item);

  if (role === "bed") return <BedFurniture block={block} flat={flat} />;
  if (role === "sofa") return <SofaFurniture block={block} flat={flat} />;
  if (role === "chair") return <ChairFurniture block={block} flat={flat} />;
  if (role === "desk") return <DeskFurniture block={block} flat={flat} />;
  if (role === "table") return <TableFurniture block={block} flat={flat} />;
  if (role === "counter") return <CounterFurniture block={block} flat={flat} />;
  if (role === "sink") return <SinkFurniture block={block} flat={flat} />;
  if (role === "shower") return <ShowerFurniture block={block} flat={flat} />;
  if (role === "toilet") return <ToiletFurniture block={block} flat={flat} />;
  if (role === "appliance") return <ApplianceFurniture block={block} flat={flat} />;
  if (role === "storage") return <StorageFurniture block={block} flat={flat} />;

  return <GenericFurniture block={block} flat={flat} />;
}

function FurnitureVolume({
  block,
  flat,
  palette,
  children,
}: {
  block: ProjectedFurniture;
  flat: boolean;
  palette: FurniturePalette;
  children?: ReactNode;
}) {
  return (
    <g className="furniture-piece">
      {!flat ? (
        <>
          <polygon points={points(block.right)} fill={palette.sideDark} stroke={palette.stroke} strokeWidth="0.55" />
          <polygon points={points(block.front)} fill={palette.side} stroke={palette.stroke} strokeWidth="0.6" />
        </>
      ) : null}
      <polygon points={points(block.top)} fill={palette.top} stroke={palette.stroke} strokeWidth="0.75" />
      {children}
    </g>
  );
}

function BedFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("bed");
  const hasTwoPillows = block.item.widthM >= 1.15;

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(quadRect(block.top, 0.04, 0.05, 0.96, 0.95))} fill="oklch(0.93 0.012 78)" stroke={palette.stroke} strokeWidth="0.45" />
      <polygon points={points(quadRect(block.top, 0.04, 0.05, 0.96, 0.17))} fill="oklch(0.56 0.035 54)" opacity="0.86" />
      {hasTwoPillows ? (
        <>
          <polygon points={points(quadRect(block.top, 0.14, 0.22, 0.46, 0.36))} fill="oklch(0.975 0.004 250)" stroke="oklch(0.78 0.012 250)" strokeWidth="0.35" />
          <polygon points={points(quadRect(block.top, 0.54, 0.22, 0.86, 0.36))} fill="oklch(0.975 0.004 250)" stroke="oklch(0.78 0.012 250)" strokeWidth="0.35" />
        </>
      ) : (
        <polygon points={points(quadRect(block.top, 0.22, 0.22, 0.78, 0.36))} fill="oklch(0.975 0.004 250)" stroke="oklch(0.78 0.012 250)" strokeWidth="0.35" />
      )}
      <polygon points={points(quadRect(block.top, 0.09, 0.48, 0.91, 0.9))} fill="oklch(0.70 0.026 245)" opacity="0.72" />
      <LocalLine quad={block.top} start={[0.1, 0.48]} end={[0.9, 0.48]} stroke="oklch(0.42 0.035 245)" opacity="0.45" />
    </FurnitureVolume>
  );
}

function SofaFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("sofa");

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(quadRect(block.top, 0.05, 0.07, 0.95, 0.32))} fill="oklch(0.48 0.035 240)" opacity="0.9" />
      <polygon points={points(quadRect(block.top, 0.05, 0.18, 0.18, 0.92))} fill="oklch(0.50 0.038 240)" opacity="0.92" />
      <polygon points={points(quadRect(block.top, 0.82, 0.18, 0.95, 0.92))} fill="oklch(0.50 0.038 240)" opacity="0.92" />
      <polygon points={points(quadRect(block.top, 0.2, 0.38, 0.8, 0.88))} fill="oklch(0.64 0.035 240)" stroke={palette.stroke} strokeWidth="0.35" />
      <LocalLine quad={block.top} start={[0.5, 0.4]} end={[0.5, 0.86]} stroke={palette.detail} opacity="0.52" />
    </FurnitureVolume>
  );
}

function ChairFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("sofa");

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(quadRect(block.top, 0.12, 0.16, 0.88, 0.88))} fill="oklch(0.65 0.035 240)" stroke={palette.stroke} strokeWidth="0.35" />
      <polygon points={points(quadRect(block.top, 0.12, 0.04, 0.88, 0.28))} fill="oklch(0.48 0.035 240)" opacity="0.92" />
      {!flat ? <FurnitureLegs block={block} stroke={palette.detail} /> : null}
    </FurnitureVolume>
  );
}

function TableFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("table");
  const token = furnitureToken(block.item);
  const isDining = token.includes("dining");

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(quadRect(block.top, 0.06, 0.08, 0.94, 0.92))} fill="oklch(0.72 0.048 62)" stroke={palette.stroke} strokeWidth="0.35" />
      <LocalLine quad={block.top} start={[0.16, 0.5]} end={[0.84, 0.5]} stroke={palette.detail} opacity={isDining ? "0.38" : "0.2"} />
      {!flat ? <FurnitureLegs block={block} stroke={palette.detail} inset={0.18} /> : null}
    </FurnitureVolume>
  );
}

function DeskFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("table");

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(quadRect(block.top, 0.06, 0.08, 0.94, 0.92))} fill="oklch(0.71 0.042 62)" stroke={palette.stroke} strokeWidth="0.35" />
      <polygon points={points(quadRect(block.top, 0.36, 0.16, 0.64, 0.3))} fill="oklch(0.30 0.012 250)" opacity="0.82" />
      <LocalLine quad={block.top} start={[0.5, 0.3]} end={[0.5, 0.45]} stroke="oklch(0.30 0.012 250)" opacity="0.62" />
      {!flat ? <FurnitureLegs block={block} stroke={palette.detail} inset={0.18} /> : null}
    </FurnitureVolume>
  );
}

function CounterFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("counter");

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(quadRect(block.top, 0.04, 0.06, 0.96, 0.94))} fill="oklch(0.89 0.008 230)" stroke={palette.stroke} strokeWidth="0.35" />
      <LocalLine quad={block.top} start={[0.24, 0.08]} end={[0.24, 0.92]} stroke={palette.detail} opacity="0.34" />
      <LocalLine quad={block.top} start={[0.48, 0.08]} end={[0.48, 0.92]} stroke={palette.detail} opacity="0.34" />
      <LocalLine quad={block.top} start={[0.72, 0.08]} end={[0.72, 0.92]} stroke={palette.detail} opacity="0.34" />
    </FurnitureVolume>
  );
}

function SinkFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("counter");
  const center = quadPoint(block.top, 0.5, 0.52);
  const xRadius = distance(quadPoint(block.top, 0.26, 0.52), quadPoint(block.top, 0.74, 0.52)) / 2;
  const yRadius = Math.max(2.5, distance(quadPoint(block.top, 0.5, 0.34), quadPoint(block.top, 0.5, 0.7)) / 2);

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(quadRect(block.top, 0.06, 0.08, 0.94, 0.92))} fill="oklch(0.92 0.006 230)" stroke={palette.stroke} strokeWidth="0.35" />
      <ellipse
        cx={center.x}
        cy={center.y}
        rx={Math.max(4, xRadius)}
        ry={yRadius}
        fill="oklch(0.84 0.018 220)"
        stroke={palette.stroke}
        strokeWidth="0.35"
        transform={`rotate(${quadAngle(block.top)} ${center.x} ${center.y})`}
      />
    </FurnitureVolume>
  );
}

function ShowerFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("porcelain");

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(quadRect(block.top, 0.07, 0.08, 0.93, 0.92))} fill="oklch(0.94 0.006 215)" stroke={palette.stroke} strokeWidth="0.35" />
      <LocalLine quad={block.top} start={[0.12, 0.18]} end={[0.88, 0.82]} stroke="oklch(0.64 0.035 215)" opacity="0.5" />
      <LocalLine quad={block.top} start={[0.88, 0.18]} end={[0.12, 0.82]} stroke="oklch(0.64 0.035 215)" opacity="0.5" />
      {!flat ? <polygon points={points(block.right)} fill="oklch(0.88 0.028 215)" opacity="0.28" /> : null}
    </FurnitureVolume>
  );
}

function ToiletFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("porcelain");
  const bowl = quadPoint(block.top, 0.5, 0.62);
  const tank = quadRect(block.top, 0.18, 0.08, 0.82, 0.34);

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(tank)} fill="oklch(0.96 0.004 220)" stroke={palette.stroke} strokeWidth="0.35" />
      <ellipse
        cx={bowl.x}
        cy={bowl.y}
        rx={Math.max(4, distance(quadPoint(block.top, 0.25, 0.62), quadPoint(block.top, 0.75, 0.62)) / 2)}
        ry={Math.max(3, distance(quadPoint(block.top, 0.5, 0.44), quadPoint(block.top, 0.5, 0.84)) / 2)}
        fill="oklch(0.97 0.003 220)"
        stroke={palette.stroke}
        strokeWidth="0.35"
        transform={`rotate(${quadAngle(block.top)} ${bowl.x} ${bowl.y})`}
      />
      <ellipse
        cx={bowl.x}
        cy={bowl.y}
        rx={Math.max(2, distance(quadPoint(block.top, 0.38, 0.62), quadPoint(block.top, 0.62, 0.62)) / 2)}
        ry={Math.max(1.5, distance(quadPoint(block.top, 0.5, 0.54), quadPoint(block.top, 0.5, 0.72)) / 2)}
        fill="oklch(0.84 0.018 220)"
        opacity="0.72"
        transform={`rotate(${quadAngle(block.top)} ${bowl.x} ${bowl.y})`}
      />
    </FurnitureVolume>
  );
}

function ApplianceFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("counter");
  const door = quadPoint(block.front, 0.5, 0.58);

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(quadRect(block.top, 0.08, 0.08, 0.92, 0.92))} fill="oklch(0.90 0.006 235)" stroke={palette.stroke} strokeWidth="0.35" />
      {!flat ? (
        <ellipse
          cx={door.x}
          cy={door.y}
          rx={Math.max(3, distance(quadPoint(block.front, 0.34, 0.58), quadPoint(block.front, 0.66, 0.58)) / 2)}
          ry={Math.max(3, distance(quadPoint(block.front, 0.5, 0.42), quadPoint(block.front, 0.5, 0.74)) / 2)}
          fill="oklch(0.72 0.022 230)"
          stroke={palette.stroke}
          strokeWidth="0.35"
          transform={`rotate(${quadAngle(block.front)} ${door.x} ${door.y})`}
        />
      ) : null}
    </FurnitureVolume>
  );
}

function StorageFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("storage");
  const token = furnitureToken(block.item);
  const isTall = token.includes("wardrobe") || token.includes("shelf") || token.includes("storage");

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <polygon points={points(quadRect(block.top, 0.06, 0.08, 0.94, 0.92))} fill="oklch(0.76 0.012 250)" stroke={palette.stroke} strokeWidth="0.35" />
      {flat ? (
        <>
          <LocalLine quad={block.top} start={[0.12, 0.36]} end={[0.88, 0.36]} stroke={palette.detail} opacity="0.48" />
          <LocalLine quad={block.top} start={[0.12, 0.64]} end={[0.88, 0.64]} stroke={palette.detail} opacity="0.48" />
        </>
      ) : (
        <>
          <LocalLine quad={block.front} start={[0.5, 0.1]} end={[0.5, 0.9]} stroke={palette.detail} opacity="0.42" />
          {isTall ? (
            <>
              <LocalLine quad={block.front} start={[0.08, 0.36]} end={[0.92, 0.36]} stroke={palette.detail} opacity="0.4" />
              <LocalLine quad={block.front} start={[0.08, 0.62]} end={[0.92, 0.62]} stroke={palette.detail} opacity="0.4" />
            </>
          ) : null}
          <circle cx={quadPoint(block.front, 0.44, 0.5).x} cy={quadPoint(block.front, 0.44, 0.5).y} r="1.1" fill={palette.detail} opacity="0.72" />
          <circle cx={quadPoint(block.front, 0.56, 0.5).x} cy={quadPoint(block.front, 0.56, 0.5).y} r="1.1" fill={palette.detail} opacity="0.72" />
        </>
      )}
    </FurnitureVolume>
  );
}

function GenericFurniture({ block, flat }: { block: ProjectedFurniture; flat: boolean }) {
  const palette = furniturePalette("generic");

  return (
    <FurnitureVolume block={block} flat={flat} palette={palette}>
      <LocalLine quad={block.top} start={[0.14, 0.16]} end={[0.86, 0.84]} stroke={palette.detail} opacity="0.42" />
      <LocalLine quad={block.top} start={[0.86, 0.16]} end={[0.14, 0.84]} stroke={palette.detail} opacity="0.42" />
    </FurnitureVolume>
  );
}

function FurnitureLegs({ block, stroke, inset = 0.16 }: { block: ProjectedFurniture; stroke: string; inset?: number }) {
  const anchors: Array<[number, number]> = [
    [inset, inset],
    [1 - inset, inset],
    [1 - inset, 1 - inset],
    [inset, 1 - inset],
  ];

  return (
    <>
      {anchors.map(([u, v]) => {
        const top = quadPoint(block.top, u, v);
        const bottom = quadPoint(block.bottom, u, v);
        return (
          <line
            key={`${u}-${v}`}
            x1={top.x}
            y1={top.y}
            x2={bottom.x}
            y2={bottom.y}
            stroke={stroke}
            strokeWidth="0.8"
            opacity="0.62"
          />
        );
      })}
    </>
  );
}

function LocalLine({
  quad,
  start,
  end,
  stroke,
  opacity = "1",
}: {
  quad: Point[];
  start: [number, number];
  end: [number, number];
  stroke: string;
  opacity?: string;
}) {
  const a = quadPoint(quad, start[0], start[1]);
  const b = quadPoint(quad, end[0], end[1]);

  return (
    <line
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
      stroke={stroke}
      strokeWidth="0.65"
      strokeLinecap="round"
      opacity={opacity}
    />
  );
}

function MeasurementOverlay({ points: selectedPoints }: { points: Point[] }) {
  return (
    <g>
      {selectedPoints.length === 2 ? (
        <line
          x1={selectedPoints[0].x}
          y1={selectedPoints[0].y}
          x2={selectedPoints[1].x}
          y2={selectedPoints[1].y}
          stroke="oklch(0.70 0.12 55)"
          strokeWidth="2"
          strokeDasharray="5 4"
        />
      ) : null}
      {selectedPoints.map((point, index) => (
        <circle
          key={`${point.x}-${point.y}-${index}`}
          cx={point.x}
          cy={point.y}
          r="5"
          fill="oklch(0.70 0.12 55)"
          stroke="oklch(0.985 0.004 250)"
          strokeWidth="2"
        />
      ))}
    </g>
  );
}

type ProjectedRoom = {
  room: Room;
  floor: Point[];
  walls: {
    back: Point[];
    left: Point[];
    right: Point[];
  };
  label: Point;
  labelSpec: LabelSpec;
  furniture: ProjectedFurniture[];
  shadowLength: number;
};

type ProjectedSpace = {
  space: SpaceGeometry;
  floor: Point[];
  label: Point;
  labelSpec: LabelSpec;
  shadowLength: number;
};

type LabelSpec = {
  visible: boolean;
  title: string;
  showArea: boolean;
  titleFontSize: number;
  areaFontSize: number;
};

type ProjectedFurniture = {
  item: FurnitureItem;
  bottom: Point[];
  top: Point[];
  front: Point[];
  right: Point[];
};

type ProjectedFixture = {
  fixture: Fixture;
  bottom: Point[];
  top: Point[];
  front: Point[];
  right: Point[];
};

type ProjectedWallSegment = {
  start: Point;
  end: Point;
  topStart: Point;
  topEnd: Point;
};

type ProjectedWall = {
  wall: WallSegment;
  polyline: Point[];
  segments: ProjectedWallSegment[];
  scale: number;
};

type ProjectedOpening = {
  opening: Opening;
  center: Point;
  line: [Point, Point];
  swing: { hinge: Point; control: Point; end: Point } | null;
};

type ProjectedPlanLabel = {
  label: PlanLabel;
  point: Point;
  labelSpec: LabelSpec;
};

type PlanBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  depth: number;
  centerX: number;
  centerY: number;
};

type Scene = {
  width: number;
  height: number;
  scale: number;
  bounds: { x: number; y: number; width: number; height: number };
  usesGeometry: boolean;
  floorPlate: Point[];
  spaces: ProjectedSpace[];
  walls: ProjectedWall[];
  openings: ProjectedOpening[];
  fixtures: ProjectedFixture[];
  labels: ProjectedPlanLabel[];
  rooms: ProjectedRoom[];
};

function buildScene(analysis: PlanAnalysis, viewMode: ViewMode, rotationDeg: number, firstPersonMode: boolean, walkState: WalkState): Scene {
  const rooms = analysis.rooms;
  const bounds = analysisBounds(analysis);
  const planWidth = bounds.width;
  const planDepth = bounds.depth;
  const width = 980;
  const height = 640;
  const isWalkMode = firstPersonMode && viewMode === "3d";
  const scale = viewMode === "top"
    ? Math.min(72, (width - 160) / planWidth, (height - 120) / planDepth)
    : Math.min(isWalkMode ? 84 : 60, width / (planWidth + planDepth + (isWalkMode ? 1.4 : 3)));
  const offset = viewMode === "top"
    ? { x: (width - planWidth * scale) / 2, y: (height - planDepth * scale) / 2 }
    : { x: width / 2, y: height / 2 + (isWalkMode ? 252 : 138) };
  const depthCompression = isWalkMode ? 0.24 : 0.48;
  const heightLift = isWalkMode ? 1.22 : 1;
  const theta = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const project = (x: number, y: number, z = 0): Point => {
    if (viewMode === "top") {
      return {
        x: offset.x + (x - bounds.minX) * scale,
        y: offset.y + (y - bounds.minY) * scale,
      };
    }

    const centeredX = isWalkMode ? x - walkState.xM : x - bounds.centerX;
    const centeredY = isWalkMode ? y - walkState.yM : y - bounds.centerY;
    const rx = centeredX * cos - centeredY * sin;
    const ry = centeredX * sin + centeredY * cos;
    return {
      x: offset.x + rx * scale,
      y: offset.y + ry * scale * depthCompression - z * scale * heightLift,
    };
  };
  const usesGeometry = hasPlanGeometry(analysis);
  const floorPlate = validPolygon(analysis.floorPlate).map((point) => project(point.xM, point.yM));
  const spaces = normalizedSpaces(analysis)
    .map((space) => {
      const floor = space.polygon.map((point) => project(point.xM, point.yM));
      const centroid = polygonCentroid(space.polygon);
      return {
        space,
        floor,
        label: project(centroid.xM, centroid.yM, viewMode === "top" ? 0 : 0.05),
        labelSpec: spaceLabelSpec(space, floor, viewMode),
        shadowLength: projectedPolygonSpan(space.polygon) * 0.18,
      };
    })
    .sort((a, b) => averageY(a.floor) - averageY(b.floor));
  const walls = (analysis.walls ?? [])
    .filter((wall) => wall.points.length >= 2)
    .map((wall) => {
      const wallHeightM = isWalkMode
        ? Math.min(wall.heightM || WALK_WALL_HEIGHT_M, WALK_WALL_HEIGHT_M)
        : MODEL_WALL_HEIGHT_M;
      return {
        wall,
        polyline: wall.points.map((point) => project(point.xM, point.yM)),
        segments: wall.points.slice(0, -1).map((point, index) => {
          const next = wall.points[index + 1];
          return {
            start: project(point.xM, point.yM),
            end: project(next.xM, next.yM),
            topStart: project(point.xM, point.yM, wallHeightM),
            topEnd: project(next.xM, next.yM, wallHeightM),
          };
        }),
        scale,
      };
    });
  const openings = (analysis.openings ?? []).map((opening) => projectOpening(opening, project));
  const fixtures = (analysis.fixtures ?? [])
    .map((fixture) => projectFixture(fixture, project))
    .sort((a, b) => averageY(a.bottom) - averageY(b.bottom));
  const labels = normalizedPlanLabels(analysis, spaces)
    .map((label) => ({
      label,
      point: project(label.xM, label.yM, viewMode === "top" ? 0 : 0.05),
      labelSpec: planLabelSpec(label, viewMode),
    }));

  return {
    width,
    height,
    scale,
    bounds: {
      x: viewMode === "top" ? offset.x : 80,
      y: viewMode === "top" ? offset.y : 80,
      width: viewMode === "top" ? planWidth * scale : width - 160,
      height: viewMode === "top" ? planDepth * scale : height - 160,
    },
    usesGeometry,
    floorPlate,
    spaces,
    walls,
    openings,
    fixtures,
    labels,
    rooms: rooms.map((room) => {
      const x1 = room.xM;
      const y1 = room.yM;
      const x2 = room.xM + room.widthM;
      const y2 = room.yM + room.depthM;
      const h = isWalkMode ? WALK_WALL_HEIGHT_M : MODEL_WALL_HEIGHT_M;
      const floor = [project(x1, y1), project(x2, y1), project(x2, y2), project(x1, y2)];
      const topBack = [project(x1, y1, h), project(x2, y1, h), project(x2, y1), project(x1, y1)];
      const left = [project(x1, y1, h), project(x1, y2, h), project(x1, y2), project(x1, y1)];
      const right = [project(x2, y1, h), project(x2, y2, h), project(x2, y2), project(x2, y1)];
      const furniture = furnitureForRoom(room)
        .map((item) => projectFurniture(item, project))
        .sort((a, b) => averageY(a.bottom) - averageY(b.bottom));

      return {
        room,
        floor,
        walls: { back: topBack, left, right },
        label: project(room.xM + room.widthM / 2, room.yM + room.depthM / 2, viewMode === "top" ? 0 : 0.05),
        labelSpec: roomLabelSpec(room, floor, viewMode),
        furniture,
        shadowLength: Math.max(room.widthM, room.depthM) * 0.18,
      };
    }).sort((a, b) => averageY(a.floor) - averageY(b.floor)),
  };
}

function hasPlanGeometry(analysis: PlanAnalysis) {
  return Boolean(
    validPolygon(analysis.floorPlate).length >= 3
      || (analysis.spaces ?? []).some((space) => validPolygon(space.polygon).length >= 3)
      || (analysis.walls ?? []).some((wall) => wall.points.length >= 2)
      || (analysis.openings ?? []).length
      || (analysis.fixtures ?? []).length
      || (analysis.labels ?? []).length,
  );
}

function normalizedSpaces(analysis: PlanAnalysis): SpaceGeometry[] {
  const explicitSpaces = (analysis.spaces ?? []).filter((space) => validPolygon(space.polygon).length >= 3);
  if (explicitSpaces.length > 0) return explicitSpaces;

  return analysis.rooms.map((room) => ({
    id: room.id,
    label: room.name,
    type: room.type,
    polygon: roomPolygon(room),
    areaSqm: room.areaSqm,
    confidence: room.confidence,
    linkedRoomId: room.id,
  }));
}

function normalizedPlanLabels(analysis: PlanAnalysis, spaces: ProjectedSpace[]): PlanLabel[] {
  const explicitLabels = analysis.labels ?? [];
  if (explicitLabels.length > 0) return explicitLabels;

  return spaces.map((space) => ({
    id: `${space.space.id}-label`,
    text: space.space.label,
    xM: polygonCentroid(space.space.polygon).xM,
    yM: polygonCentroid(space.space.polygon).yM,
    widthM: null,
    depthM: null,
    linkedSpaceId: space.space.id,
    confidence: space.space.confidence,
  }));
}

function projectOpening(opening: Opening, project: (x: number, y: number, z?: number) => Point): ProjectedOpening {
  const theta = (opening.rotationDeg * Math.PI) / 180;
  const halfWidth = opening.widthM / 2;
  const dx = Math.cos(theta) * halfWidth;
  const dy = Math.sin(theta) * halfWidth;
  const leftM = { xM: opening.xM - dx, yM: opening.yM - dy };
  const rightM = { xM: opening.xM + dx, yM: opening.yM + dy };
  const line: [Point, Point] = [project(leftM.xM, leftM.yM, 0.06), project(rightM.xM, rightM.yM, 0.06)];
  let swing: ProjectedOpening["swing"] = null;

  if (opening.kind === "door") {
    const swingDeg = opening.swingDeg ?? 90;
    const swingTheta = theta + (swingDeg * Math.PI) / 180;
    const endM = {
      xM: leftM.xM + Math.cos(swingTheta) * opening.widthM,
      yM: leftM.yM + Math.sin(swingTheta) * opening.widthM,
    };
    const controlM = {
      xM: leftM.xM + Math.cos(theta + (swingTheta - theta) / 2) * opening.widthM * 0.86,
      yM: leftM.yM + Math.sin(theta + (swingTheta - theta) / 2) * opening.widthM * 0.86,
    };
    swing = {
      hinge: project(leftM.xM, leftM.yM, 0.08),
      control: project(controlM.xM, controlM.yM, 0.08),
      end: project(endM.xM, endM.yM, 0.08),
    };
  }

  return {
    opening,
    center: project(opening.xM, opening.yM, 0.08),
    line,
    swing,
  };
}

function projectFixture(fixture: Fixture, project: (x: number, y: number, z?: number) => Point): ProjectedFixture {
  const item: FurnitureItem = {
    id: fixture.id,
    kind: fixture.kind,
    widthM: fixture.widthM,
    depthM: fixture.depthM,
    xM: fixture.xM,
    yM: fixture.yM,
    rotationDeg: fixture.rotationDeg,
  };
  const corners = rotatedCorners(item);
  const h = furnitureHeight(item);
  const bottom = corners.map(([x, y]) => project(x, y));
  const top = corners.map(([x, y]) => project(x, y, h));

  return {
    fixture,
    bottom,
    top,
    front: [top[2], top[3], bottom[3], bottom[2]],
    right: [top[1], top[2], bottom[2], bottom[1]],
  };
}

function spaceLabelSpec(space: SpaceGeometry, floor: Point[], viewMode: ViewMode): LabelSpec {
  return labelSpec(space.label, space.areaSqm ?? null, floor, viewMode);
}

function planLabelSpec(label: PlanLabel, viewMode: ViewMode): LabelSpec {
  const width = Math.max(28, (label.widthM ?? 1.8) * (viewMode === "top" ? 32 : 20));
  const height = Math.max(18, (label.depthM ?? 0.6) * (viewMode === "top" ? 32 : 18));
  const titleFontSize = width < 48 ? 8 : 10;
  const maxChars = Math.max(4, Math.floor(width / (titleFontSize * 0.58)));

  return {
    visible: height >= 12 && width >= 18,
    title: truncateLabel(label.text, maxChars),
    showArea: false,
    titleFontSize,
    areaFontSize: 0,
  };
}

function roomLabelSpec(room: Room, floor: Point[], viewMode: ViewMode): LabelSpec {
  return labelSpec(room.name, room.areaSqm, floor, viewMode);
}

function labelSpec(titleValue: string, areaSqm: number | null, floor: Point[], viewMode: ViewMode): LabelSpec {
  const bounds = pointBounds(floor);
  const minSide = Math.min(bounds.width, bounds.height);
  const floorArea = polygonArea(floor);

  if (minSide < 22 || floorArea < 620) {
    return { visible: false, title: "", showArea: false, titleFontSize: 0, areaFontSize: 0 };
  }

  const titleFontSize = minSide < 38 ? 8 : 10;
  const areaFontSize = Math.max(7, titleFontSize - 2);
  const titleWidth = Math.max(20, bounds.width * (viewMode === "top" ? 0.78 : 0.64));
  const maxChars = Math.max(4, Math.floor(titleWidth / (titleFontSize * 0.58)));
  const title = truncateLabel(titleValue, maxChars);
  const showArea = areaSqm !== null && minSide >= 40 && bounds.height >= titleFontSize + areaFontSize + 12;

  return { visible: true, title, showArea, titleFontSize, areaFontSize };
}

function truncateLabel(value: string, maxChars: number) {
  const cleanValue = value.trim();
  if (cleanValue.length <= maxChars) return cleanValue;
  if (maxChars <= 4) return cleanValue.slice(0, maxChars);
  return `${cleanValue.slice(0, maxChars - 3).trimEnd()}...`;
}

function projectFurniture(item: FurnitureItem, project: (x: number, y: number, z?: number) => Point): ProjectedFurniture {
  const corners = rotatedCorners(item);
  const h = furnitureHeight(item);
  const bottom = corners.map(([x, y]) => project(x, y));
  const top = corners.map(([x, y]) => project(x, y, h));

  return {
    item,
    bottom,
    top,
    front: [top[2], top[3], bottom[3], bottom[2]],
    right: [top[1], top[2], bottom[2], bottom[1]],
  };
}

function analysisBounds(analysis: PlanAnalysis): PlanBounds {
  const pointsM: PlanPoint[] = [];

  pointsM.push(...validPolygon(analysis.floorPlate));
  for (const space of analysis.spaces ?? []) pointsM.push(...validPolygon(space.polygon));
  for (const wall of analysis.walls ?? []) pointsM.push(...wall.points);
  for (const opening of analysis.openings ?? []) {
    pointsM.push({ xM: opening.xM - opening.widthM / 2, yM: opening.yM - opening.widthM / 2 });
    pointsM.push({ xM: opening.xM + opening.widthM / 2, yM: opening.yM + opening.widthM / 2 });
  }
  for (const fixture of analysis.fixtures ?? []) {
    pointsM.push({ xM: fixture.xM, yM: fixture.yM });
    pointsM.push({ xM: fixture.xM + fixture.widthM, yM: fixture.yM + fixture.depthM });
  }
  for (const room of analysis.rooms) pointsM.push(...roomPolygon(room));

  if (pointsM.length === 0) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, depth: 1, centerX: 0.5, centerY: 0.5 };
  }

  const raw = pointsM.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.xM),
      minY: Math.min(acc.minY, point.yM),
      maxX: Math.max(acc.maxX, point.xM),
      maxY: Math.max(acc.maxY, point.yM),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const width = Math.max(1, raw.maxX - raw.minX);
  const depth = Math.max(1, raw.maxY - raw.minY);

  return {
    ...raw,
    width,
    depth,
    centerX: raw.minX + width / 2,
    centerY: raw.minY + depth / 2,
  };
}

function roomPolygon(room: Room): PlanPoint[] {
  return [
    { xM: room.xM, yM: room.yM },
    { xM: room.xM + room.widthM, yM: room.yM },
    { xM: room.xM + room.widthM, yM: room.yM + room.depthM },
    { xM: room.xM, yM: room.yM + room.depthM },
  ];
}

function validPolygon(polygon: PlanPoint[] | undefined): PlanPoint[] {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  return polygon.filter((point) => Number.isFinite(point.xM) && Number.isFinite(point.yM));
}

function polygonCentroid(polygon: PlanPoint[]): PlanPoint {
  const valid = validPolygon(polygon);
  if (valid.length === 0) return { xM: 0, yM: 0 };

  let signedArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < valid.length; index += 1) {
    const current = valid[index];
    const next = valid[(index + 1) % valid.length];
    const cross = current.xM * next.yM - next.xM * current.yM;
    signedArea += cross;
    cx += (current.xM + next.xM) * cross;
    cy += (current.yM + next.yM) * cross;
  }

  if (Math.abs(signedArea) < 0.0001) {
    return {
      xM: valid.reduce((sum, point) => sum + point.xM, 0) / valid.length,
      yM: valid.reduce((sum, point) => sum + point.yM, 0) / valid.length,
    };
  }

  return { xM: cx / (3 * signedArea), yM: cy / (3 * signedArea) };
}

function projectedPolygonSpan(polygon: PlanPoint[]) {
  const xs = polygon.map((point) => point.xM);
  const ys = polygon.map((point) => point.yM);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function initialWalkState(analysis: PlanAnalysis): WalkState {
  const bounds = analysisBounds(analysis);
  const rooms = analysis.rooms;
  const preferredRoom = rooms.find((room) => room.type === "living_room")
    ?? rooms.filter((room) => room.type !== "bathroom" && room.type !== "storage")
      .sort((a, b) => b.areaSqm - a.areaSqm)[0]
    ?? rooms[0];

  if (!preferredRoom) {
    return { xM: bounds.centerX, yM: bounds.centerY, yawDeg: -12 };
  }

  return {
    xM: preferredRoom.xM + preferredRoom.widthM / 2,
    yM: preferredRoom.yM + preferredRoom.depthM / 2,
    yawDeg: -12,
  };
}

function normalizeWalkKey(value: string) {
  const key = value.toLowerCase();
  if (key === "w" || key === "arrowup") return "forward";
  if (key === "s" || key === "arrowdown") return "backward";
  if (key === "a") return "left";
  if (key === "d") return "right";
  if (key === "q" || key === "arrowleft") return "turnLeft";
  if (key === "e" || key === "arrowright") return "turnRight";
  return null;
}

function advanceWalk(current: WalkState, keys: Set<string>, deltaSeconds: number, bounds: PlanBounds): WalkState {
  const forward = (keys.has("forward") ? 1 : 0) - (keys.has("backward") ? 1 : 0);
  const strafe = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
  const turn = (keys.has("turnRight") ? 1 : 0) - (keys.has("turnLeft") ? 1 : 0);

  if (!forward && !strafe && !turn) return current;

  const yawDeg = normalizeYaw(current.yawDeg + turn * 96 * deltaSeconds);
  const yawRad = (yawDeg * Math.PI) / 180;
  const vectorLength = Math.hypot(forward, strafe) || 1;
  const speed = 2.6 * deltaSeconds;
  const moveForward = (forward / vectorLength) * speed;
  const moveStrafe = (strafe / vectorLength) * speed;

  return clampWalk({
    xM: current.xM + Math.sin(yawRad) * moveForward + Math.cos(yawRad) * moveStrafe,
    yM: current.yM + Math.cos(yawRad) * moveForward - Math.sin(yawRad) * moveStrafe,
    yawDeg,
  }, bounds);
}

function clampWalk(state: WalkState, bounds: PlanBounds): WalkState {
  const margin = Math.min(0.35, bounds.width / 3, bounds.depth / 3);
  return {
    ...state,
    xM: clamp(state.xM, bounds.minX + margin, bounds.maxX - margin),
    yM: clamp(state.yM, bounds.minY + margin, bounds.maxY - margin),
  };
}

function normalizeYaw(value: number) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function furnitureForRoom(room: Room): FurnitureItem[] {
  if (room.furniture.length > 0) {
    return room.furniture.map((item) => fitFurnitureToRoom(room, item));
  }

  return fallbackFurnitureForRoom(room);
}

function fallbackFurnitureForRoom(room: Room): FurnitureItem[] {
  switch (room.type) {
    case "living_room":
      return [
        roomFurniture(room, "sofa", "sofa", Math.min(room.widthM * 0.58, 2.4), 0.85, 0.12, 0.68),
        roomFurniture(room, "coffee-table", "table", 1.1, 0.62, 0.42, 0.46),
        roomFurniture(room, "media-console", "media-console", Math.min(room.widthM * 0.46, 1.8), 0.35, 0.34, 0.12),
      ];
    case "bedroom":
      return [
        roomFurniture(room, "bed", "bed", Math.min(room.widthM * 0.58, 1.8), Math.min(room.depthM * 0.66, 2.1), 0.12, 0.12),
        roomFurniture(room, "wardrobe", "wardrobe", Math.min(room.widthM * 0.34, 1.2), 0.55, 0.62, 0.08),
        roomFurniture(room, "nightstand", "nightstand", 0.46, 0.42, 0.72, 0.58),
      ];
    case "kitchen":
      return [
        roomFurniture(room, "counter", "counter", Math.min(room.widthM * 0.72, 3), 0.6, 0.08, 0.08),
        roomFurniture(room, "sink", "sink", 0.72, 0.48, 0.58, 0.1),
        roomFurniture(room, "prep-table", "table", Math.min(room.widthM * 0.44, 1.4), 0.72, 0.42, 0.58),
      ];
    case "bathroom":
      return [
        roomFurniture(room, "shower", "shower", Math.min(room.widthM * 0.48, 1.3), Math.min(room.depthM * 0.4, 1), 0.08, 0.08),
        roomFurniture(room, "vanity", "sink", 0.72, 0.48, 0.56, 0.12),
        roomFurniture(room, "toilet", "toilet", 0.48, 0.64, 0.62, 0.58),
      ];
    case "dining_room":
      return [
        roomFurniture(room, "dining-table", "table", Math.min(room.widthM * 0.54, 1.8), Math.min(room.depthM * 0.42, 1.05), 0.5, 0.48),
        roomFurniture(room, "chair-1", "chair", 0.42, 0.42, 0.22, 0.48),
        roomFurniture(room, "chair-2", "chair", 0.42, 0.42, 0.78, 0.48),
        roomFurniture(room, "chair-3", "chair", 0.42, 0.42, 0.5, 0.2),
        roomFurniture(room, "chair-4", "chair", 0.42, 0.42, 0.5, 0.76),
      ];
    case "office":
      return [
        roomFurniture(room, "desk", "desk", Math.min(room.widthM * 0.52, 1.6), 0.72, 0.14, 0.16),
        roomFurniture(room, "office-chair", "chair", 0.52, 0.52, 0.42, 0.46),
        roomFurniture(room, "shelf", "shelf", 0.45, Math.min(room.depthM * 0.52, 1.4), 0.78, 0.18),
      ];
    case "balcony":
      return [
        roomFurniture(room, "outdoor-table", "table", 0.72, 0.72, 0.48, 0.42),
        roomFurniture(room, "outdoor-chair", "chair", 0.44, 0.44, 0.18, 0.46),
      ];
    case "utility":
      return [
        roomFurniture(room, "washer", "appliance", 0.68, 0.68, 0.12, 0.12),
        roomFurniture(room, "utility-shelf", "shelf", Math.min(room.widthM * 0.44, 1.2), 0.42, 0.52, 0.14),
      ];
    case "storage":
      return [roomFurniture(room, "shelf", "shelf", Math.min(room.widthM * 0.7, 1.4), 0.44, 0.14, 0.12)];
    case "hallway":
    default:
      return [];
  }
}

function roomFurniture(
  room: Room,
  idSuffix: string,
  kind: string,
  widthM: number,
  depthM: number,
  xRatio: number,
  yRatio: number,
  rotationDeg = 0,
): FurnitureItem {
  const fitted = fitSizeToRoom(room, widthM, depthM);
  return {
    id: `${room.id}-${idSuffix}`,
    kind,
    widthM: fitted.widthM,
    depthM: fitted.depthM,
    xM: room.xM + (room.widthM - fitted.widthM) * xRatio,
    yM: room.yM + (room.depthM - fitted.depthM) * yRatio,
    rotationDeg,
  };
}

function fitFurnitureToRoom(room: Room, item: FurnitureItem): FurnitureItem {
  const fitted = fitSizeToRoom(room, item.widthM, item.depthM);
  const xM = clamp(item.xM, room.xM + 0.08, Math.max(room.xM + 0.08, room.xM + room.widthM - fitted.widthM - 0.08));
  const yM = clamp(item.yM, room.yM + 0.08, Math.max(room.yM + 0.08, room.yM + room.depthM - fitted.depthM - 0.08));
  return { ...item, ...fitted, xM, yM };
}

function fitSizeToRoom(room: Room, widthM: number, depthM: number) {
  return {
    widthM: Math.max(0.28, Math.min(widthM, Math.max(0.28, room.widthM - 0.18))),
    depthM: Math.max(0.28, Math.min(depthM, Math.max(0.28, room.depthM - 0.18))),
  };
}

function rotatedCorners(item: FurnitureItem): Array<[number, number]> {
  const centerX = item.xM + item.widthM / 2;
  const centerY = item.yM + item.depthM / 2;
  const theta = (item.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const corners: Array<[number, number]> = [
    [-item.widthM / 2, -item.depthM / 2],
    [item.widthM / 2, -item.depthM / 2],
    [item.widthM / 2, item.depthM / 2],
    [-item.widthM / 2, item.depthM / 2],
  ];

  return corners.map(([x, y]) => [
    centerX + x * cos - y * sin,
    centerY + x * sin + y * cos,
  ]);
}

type FurnitureRole =
  | "appliance"
  | "bed"
  | "chair"
  | "counter"
  | "desk"
  | "generic"
  | "shower"
  | "sink"
  | "sofa"
  | "storage"
  | "table"
  | "toilet";

type FurniturePalette = {
  top: string;
  side: string;
  sideDark: string;
  stroke: string;
  detail: string;
};

function furnitureHeight(item: FurnitureItem) {
  const token = furnitureToken(item);
  if (token.includes("shower")) return 1.55;
  if (token.includes("wardrobe")) return 1.55;
  if (token.includes("shelf")) return 1.16;
  if (token.includes("media") || token.includes("console")) return 0.55;
  if (token.includes("nightstand")) return 0.5;
  if (token.includes("storage") || token.includes("cabinet")) return 0.95;
  if (token.includes("counter") || token.includes("sink") || token.includes("vanity")) return 0.82;
  if (token.includes("desk") || token.includes("table")) return token.includes("coffee") ? 0.42 : 0.72;
  if (token.includes("fridge")) return 1.35;
  if (token.includes("appliance") || token.includes("washer") || token.includes("stove")) return 0.88;
  if (token.includes("toilet")) return 0.46;
  if (token.includes("sofa")) return 0.52;
  if (token.includes("bed")) return 0.46;
  if (token.includes("chair")) return 0.46;
  return 0.42;
}

function furnitureRole(item: FurnitureItem): FurnitureRole {
  const token = furnitureToken(item);
  if (token.includes("toilet")) return "toilet";
  if (token.includes("shower") || token.includes("bath")) return "shower";
  if (token.includes("sink") || token.includes("vanity")) return "sink";
  if (token.includes("counter")) return "counter";
  if (token.includes("appliance") || token.includes("washer") || token.includes("stove") || token.includes("fridge")) return "appliance";
  if (token.includes("bed")) return "bed";
  if (token.includes("sofa")) return "sofa";
  if (token.includes("chair") || token.includes("stool")) return "chair";
  if (token.includes("desk")) return "desk";
  if (token.includes("table")) return "table";
  if (token.includes("storage") || token.includes("wardrobe") || token.includes("shelf") || token.includes("media") || token.includes("console") || token.includes("nightstand")) return "storage";
  return "generic";
}

function isBuiltInFixtureFurniture(item: FurnitureItem) {
  const role = furnitureRole(item);
  if (role === "counter" || role === "sink" || role === "shower" || role === "toilet" || role === "appliance") return true;

  const token = furnitureToken(item);
  return token.includes("tub") || token.includes("vanity") || token.includes("island");
}

function furniturePalette(role: "bed" | "counter" | "generic" | "porcelain" | "sofa" | "storage" | "table"): FurniturePalette {
  switch (role) {
    case "bed":
      return {
        top: "oklch(0.70 0.035 58)",
        side: "oklch(0.55 0.035 58)",
        sideDark: "oklch(0.49 0.035 58)",
        stroke: "oklch(0.33 0.035 58)",
        detail: "oklch(0.42 0.035 58)",
      };
    case "sofa":
      return {
        top: "oklch(0.58 0.04 240)",
        side: "oklch(0.45 0.04 240)",
        sideDark: "oklch(0.40 0.038 240)",
        stroke: "oklch(0.30 0.038 240)",
        detail: "oklch(0.31 0.032 240)",
      };
    case "table":
      return {
        top: "oklch(0.66 0.052 62)",
        side: "oklch(0.50 0.046 62)",
        sideDark: "oklch(0.44 0.042 62)",
        stroke: "oklch(0.32 0.04 62)",
        detail: "oklch(0.38 0.04 62)",
      };
    case "counter":
      return {
        top: "oklch(0.84 0.01 230)",
        side: "oklch(0.68 0.012 230)",
        sideDark: "oklch(0.60 0.014 230)",
        stroke: "oklch(0.42 0.018 230)",
        detail: "oklch(0.48 0.018 230)",
      };
    case "porcelain":
      return {
        top: "oklch(0.94 0.006 215)",
        side: "oklch(0.80 0.016 215)",
        sideDark: "oklch(0.72 0.018 215)",
        stroke: "oklch(0.48 0.028 215)",
        detail: "oklch(0.54 0.03 215)",
      };
    case "storage":
      return {
        top: "oklch(0.72 0.012 250)",
        side: "oklch(0.58 0.012 250)",
        sideDark: "oklch(0.52 0.012 250)",
        stroke: "oklch(0.36 0.014 250)",
        detail: "oklch(0.32 0.014 250)",
      };
    case "generic":
    default:
      return {
        top: "oklch(0.80 0.01 250)",
        side: "oklch(0.66 0.012 250)",
        sideDark: "oklch(0.58 0.012 250)",
        stroke: "oklch(0.38 0.014 250)",
        detail: "oklch(0.34 0.014 250)",
      };
  }
}

function furnitureToken(item: FurnitureItem) {
  return `${item.kind} ${item.id}`.toLowerCase();
}

function quadRect(quad: Point[], u1: number, v1: number, u2: number, v2: number) {
  return [
    quadPoint(quad, u1, v1),
    quadPoint(quad, u2, v1),
    quadPoint(quad, u2, v2),
    quadPoint(quad, u1, v2),
  ];
}

function quadPoint(quad: Point[], u: number, v: number): Point {
  const top = lerpPoint(quad[0], quad[1], u);
  const bottom = lerpPoint(quad[3], quad[2], u);
  return lerpPoint(top, bottom, v);
}

function quadAngle(quad: Point[]) {
  return (Math.atan2(quad[1].y - quad[0].y, quad[1].x - quad[0].x) * 180) / Math.PI;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function averageY(items: Point[]) {
  return items.reduce((total, item) => total + item.y, 0) / Math.max(1, items.length);
}

function pointBounds(items: Point[]) {
  const xs = items.map((item) => item.x);
  const ys = items.map((item) => item.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { width: maxX - minX, height: maxY - minY };
}

function polygonArea(items: Point[]) {
  let area = 0;
  for (let index = 0; index < items.length; index += 1) {
    const current = items[index];
    const next = items[(index + 1) % items.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

function sunVector(hour: number, compassDeg: number) {
  const t = Math.max(0, Math.min(1, (hour - 6) / 15));
  const highSun = Math.sin(t * Math.PI);
  const lowSun = 1 - highSun;
  const angle = (compassDeg * Math.PI) / 180;
  const shadowLength = 10 + lowSun * 24;
  const lightX = Math.sin(angle);
  const lightY = Math.cos(angle);
  return {
    color: hour < 9 || hour > 17 ? "oklch(0.82 0.12 62)" : "oklch(0.88 0.07 92)",
    opacity: hour < 7 || hour > 20 ? 0.08 : 0.16 + lowSun * 0.08,
    gradient: {
      x1: `${50 - lightX * 46}%`,
      y1: `${50 - lightY * 46}%`,
      x2: `${50 + lightX * 46}%`,
      y2: `${50 + lightY * 46}%`,
    },
    shadow: {
      x: lightX * shadowLength,
      y: lightY * shadowLength,
    },
    shadowOpacity: hour < 7 || hour > 20 ? 0.06 : 0.12 + lowSun * 0.14,
  };
}

function clientToSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

function inverseViewportPoint(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

function clientDeltaToSvg(svg: SVGSVGElement | null, scene: Scene, dx: number, dy: number): Point {
  const rect = svg?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return { x: dx, y: dy };
  return {
    x: dx * (scene.width / rect.width),
    y: dy * (scene.height / rect.height),
  };
}

function screenDistanceToMeters(first: Point, second: Point, scale: number, viewMode: ViewMode, measurementScale: number) {
  const pixelDistance = Math.hypot(second.x - first.x, second.y - first.y);
  const correction = viewMode === "top" ? 1 : 0.78;
  return Number(((pixelDistance / (scale * correction)) * measurementScale).toFixed(2));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function offsetPoints(items: Point[], x: number, y: number) {
  return items.map((item) => ({ x: item.x + x, y: item.y + y }));
}

function screenBounds(items: Point[]) {
  const xs = items.map((item) => item.x);
  const ys = items.map((item) => item.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function points(items: Point[]) {
  return items.map((item) => `${item.x.toFixed(1)},${item.y.toFixed(1)}`).join(" ");
}
