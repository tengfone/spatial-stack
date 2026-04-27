import { useEffect, useState } from "react";
import {
  Cloud,
  Database,
  FileCode2,
  FileImage,
  Globe2,
  HardDrive,
  LockKeyhole,
  Maximize2,
  RotateCcw,
  Server,
  ShieldCheck,
  SquareFunction,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const requestPath = [
  {
    number: "01",
    label: "Browser",
    detail: "Vite React workbench renders the spatial review surface.",
    meta: "STATIC CLIENT",
    icon: Globe2,
  },
  {
    number: "02",
    label: "CloudFront",
    detail: "Private S3 origin, same-origin routing for browser and API traffic.",
    meta: "EDGE",
    icon: Cloud,
  },
  {
    number: "03",
    label: "API Gateway",
    detail: "HTTP API forwards analysis requests to the Lambda service.",
    meta: "PUBLIC API",
    icon: Server,
  },
  {
    number: "04",
    label: "Lambda",
    detail: "FastAPI handler queues deployed jobs; the worker runs validation and spatial sanity checks.",
    meta: "COMPUTE",
    icon: SquareFunction,
  },
  {
    number: "05",
    label: "DynamoDB",
    detail: "Single-table persistence for pending, processing, ready, and failed plan records.",
    meta: "STATE",
    icon: Database,
  },
  {
    number: "06",
    label: "S3 Raw Plans",
    detail: "Private object storage for uploaded source plans.",
    meta: "EVIDENCE",
    icon: FileImage,
  },
];

const runtimeLayers = [
  { label: "Frontend", value: "Vite, React, TypeScript" },
  { label: "API", value: "FastAPI via Lambda proxy" },
  { label: "Model calls", value: "OpenRouter structured output with the configured model" },
  { label: "Validation", value: "Pydantic contract and spatial sanity checks" },
];

const deploymentContract = [
  { label: "Frontend origin", value: "Private S3 bucket behind CloudFront" },
  { label: "API route", value: "CloudFront forwards /api to HTTP API" },
  { label: "Analysis runtime", value: "Lambda queues jobs and self-invokes the async worker" },
  { label: "Persistence", value: "DynamoDB stores plan status and validated contracts" },
  { label: "Raw storage", value: "S3 retains uploaded plans under IAM control" },
];

const guardrails = [
  { label: "Public surface", value: "CloudFront and API Gateway only" },
  { label: "Private origins", value: "S3 buckets remain blocked from direct public access" },
  { label: "Backend boundary", value: "OpenRouter calls, Pydantic validation, and sanity checks stay behind the API service" },
];

const artifacts = [
  { label: "Diagram source", value: "docs/aws-architecture.drawio", icon: FileCode2 },
  { label: "Rendered asset", value: "frontend/public/architecture/aws-architecture.png", icon: HardDrive },
  { label: "Terraform", value: "infra/terraform", icon: Workflow },
];

const ARCHITECTURE_DIAGRAM_SRC = "/architecture/aws-architecture.png";
const DIAGRAM_ZOOM_STEP = 20;
const DIAGRAM_MIN_ZOOM = 100;
const DIAGRAM_MAX_ZOOM = 220;

export function Architecture() {
  const [isDiagramOpen, setIsDiagramOpen] = useState(false);
  const [diagramZoom, setDiagramZoom] = useState(DIAGRAM_MIN_ZOOM);

  useEffect(() => {
    if (!isDiagramOpen || typeof document === "undefined") return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDiagramOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDiagramOpen]);

  function zoomDiagram(delta: number) {
    setDiagramZoom((currentZoom) => Math.min(DIAGRAM_MAX_ZOOM, Math.max(DIAGRAM_MIN_ZOOM, currentZoom + delta)));
  }

  function resetZoom() {
    setDiagramZoom(DIAGRAM_MIN_ZOOM);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background lg:overflow-hidden">
      <header className="shrink-0 border-b border-border bg-surface px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="section-label">Architecture Reference</p>
            <h1 className="mt-1 text-[0.875rem] font-semibold text-foreground">
              Spatial Stack AWS serverless deployment
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono-data inline-flex h-7 items-center rounded border border-border bg-muted px-2.5 text-muted-foreground">
              3086 x 1816 PNG
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setIsDiagramOpen(true)} aria-haspopup="dialog">
              <Maximize2 className="h-3.5 w-3.5" />
              Inspect diagram
            </Button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="order-2 border-t border-border bg-surface lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-t-0">
          <section className="border-b border-border px-4 py-4">
            <h2 className="section-label">Request Path</h2>
            <ol className="mt-2 divide-y divide-border">
              {requestPath.map((step) => {
                const Icon = step.icon;
                return (
                  <li key={step.label} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-3">
                    <span className="mono-data pt-0.5 text-muted-foreground">{step.number}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <p className="truncate text-xs font-semibold text-foreground">{step.label}</p>
                        <span className="mono-data ml-auto shrink-0 text-muted-foreground">{step.meta}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="px-4 py-4">
            <h2 className="section-label">Runtime Layers</h2>
            <div className="mt-3 overflow-hidden rounded border border-border">
              {runtimeLayers.map((layer) => (
                <div key={layer.label} className="grid grid-cols-[6rem_minmax(0,1fr)] border-b border-border last:border-b-0">
                  <div className="bg-muted px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {layer.label}
                  </div>
                  <div className="px-3 py-2 text-xs font-medium text-foreground">{layer.value}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <main className="order-1 flex min-h-[520px] min-w-0 flex-col border-b border-border bg-[oklch(0.955_0.005_250)] lg:order-2 lg:min-h-0 lg:border-b-0">
          <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-muted">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-foreground">Infrastructure topology</p>
                <p className="text-[0.6875rem] text-muted-foreground">Click the diagram for full-screen inspection.</p>
              </div>
            </div>
            <DiagramControls
              zoom={diagramZoom}
              onZoomOut={() => zoomDiagram(-DIAGRAM_ZOOM_STEP)}
              onReset={resetZoom}
              onZoomIn={() => zoomDiagram(DIAGRAM_ZOOM_STEP)}
              onOpen={() => setIsDiagramOpen(true)}
            />
          </div>

          <div className="relative min-h-0 flex-1 overflow-auto p-3 sm:p-4">
            <button
              type="button"
              className="flex min-h-full max-w-none items-start justify-start text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              style={{ width: `max(${diagramZoom}%, 620px)` }}
              onClick={() => setIsDiagramOpen(true)}
              aria-label="Open architecture diagram in inspection view"
              aria-haspopup="dialog"
            >
              <img
                src={ARCHITECTURE_DIAGRAM_SRC}
                alt="Spatial Stack AWS serverless architecture diagram"
                className="block aspect-[3086/1816] w-full max-w-none rounded-sm border border-border bg-[oklch(0.985_0.004_250)] object-contain"
                loading="eager"
                decoding="async"
              />
            </button>
            <div className="pointer-events-none absolute bottom-3 left-3 hidden rounded border border-border bg-surface px-2.5 py-1 shadow-panel sm:block">
              <span className="mono-data text-muted-foreground">CLICK IMAGE TO INSPECT</span>
            </div>
          </div>
        </main>

        <aside className="order-3 border-t border-border bg-surface lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <section className="border-b border-border px-4 py-4">
            <h2 className="section-label">Deployment Contract</h2>
            <div className="mt-3 divide-y divide-border">
              {deploymentContract.map((item) => (
                <div key={item.label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {item.label}
                  </span>
                  <span className="text-xs font-medium leading-5 text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="border-b border-border px-4 py-4">
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-3.5 w-3.5 text-primary" />
              <h2 className="section-label">Boundary Rules</h2>
            </div>
            <div className="mt-3 divide-y divide-border">
              {guardrails.map((item) => (
                <div key={item.label} className="py-2 first:pt-0 last:pb-0">
                  <p className="text-xs font-semibold text-foreground">{item.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="px-4 py-4">
            <h2 className="section-label">Repository Artifacts</h2>
            <div className="mt-3 overflow-hidden rounded border border-border">
              {artifacts.map((artifact) => {
                const Icon = artifact.icon;
                return (
                  <div key={artifact.label} className="flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">{artifact.label}</p>
                      <p className="mono-data mt-1 truncate text-muted-foreground" title={artifact.value}>
                        {artifact.value}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>

      {isDiagramOpen ? (
        <div
          className="fixed inset-0 z-50 bg-[oklch(0.22_0.012_250_/_0.88)] p-2 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="architecture-diagram-title"
          onClick={() => setIsDiagramOpen(false)}
        >
          <div
            className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-surface"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-3 border-b border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="section-label">Inspection View</p>
                <h3 id="architecture-diagram-title" className="mt-1 truncate text-[0.875rem] font-semibold">
                  Spatial Stack AWS serverless deployment
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DiagramControls
                  zoom={diagramZoom}
                  onZoomOut={() => zoomDiagram(-DIAGRAM_ZOOM_STEP)}
                  onReset={resetZoom}
                  onZoomIn={() => zoomDiagram(DIAGRAM_ZOOM_STEP)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsDiagramOpen(false)}
                  aria-label="Close diagram"
                  title="Close diagram"
                  autoFocus
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-[oklch(0.955_0.005_250)] p-3 sm:p-5">
              <img
                src={ARCHITECTURE_DIAGRAM_SRC}
                alt="Spatial Stack AWS serverless architecture diagram"
                className="mx-auto block aspect-[3086/1816] max-w-none rounded-sm border border-border bg-[oklch(0.985_0.004_250)] object-contain"
                style={{ width: `max(${diagramZoom}%, 860px)` }}
                decoding="async"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DiagramControls({
  zoom,
  onZoomOut,
  onReset,
  onZoomIn,
  onOpen,
}: {
  zoom: number;
  onZoomOut: () => void;
  onReset: () => void;
  onZoomIn: () => void;
  onOpen?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mono-data inline-flex h-8 min-w-12 items-center justify-center rounded border border-border bg-muted px-2 text-muted-foreground">
        {zoom}%
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onZoomOut}
        disabled={zoom <= DIAGRAM_MIN_ZOOM}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onReset}
        disabled={zoom === DIAGRAM_MIN_ZOOM}
        aria-label="Reset zoom"
        title="Reset zoom"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onZoomIn}
        disabled={zoom >= DIAGRAM_MAX_ZOOM}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      {onOpen ? (
        <Button type="button" variant="outline" size="icon" onClick={onOpen} aria-label="Open diagram" title="Open diagram">
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
