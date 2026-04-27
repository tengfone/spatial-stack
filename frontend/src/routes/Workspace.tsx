import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileImage, FileText, Loader2, PanelRight, RotateCcw, Upload as UploadIcon, X } from "lucide-react";

import { AnalysisSummary } from "@/components/AnalysisSummary";
import { FileDropzone } from "@/components/FileDropzone";
import { SpatialViewer, type FloorMaterialKey, type ViewMode, type WallColorKey } from "@/components/SpatialViewer";
import { ViewerTools, type ToolId } from "@/components/ViewerTools";
import { analyzePlan, analyzeSampleFile, ApiError, health, type HealthResponse, listPlans, listSampleFiles, loadPlanAnalysis, type AnalysisProgress, type PlanAnalysis, type PlanListItem, type SampleFile, sampleFilePreviewUrl } from "@/lib/api-client";

const SUPPORTED_UPLOAD_MESSAGE = "Upload a PNG, JPG, or PDF floor plan.";
const SUPPORTED_FILE_TYPES = new Set(["image/png", "image/jpeg", "application/pdf"]);

type SamplePreview = {
  url: string;
  contentType: string;
};

export function Workspace() {
  const dragDepth = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<PlanAnalysis | null>(null);
  const [healthStatus, setHealthStatus] = useState<HealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [measureMode, setMeasureMode] = useState(false);
  const [measureResult, setMeasureResult] = useState<number | null>(null);
  const [measurementScale, setMeasurementScale] = useState(1);
  const [showSourceOverlay, setShowSourceOverlay] = useState(false);
  const [sourceOverlayOpacity, setSourceOverlayOpacity] = useState(0.35);
  const [showFurniture, setShowFurniture] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [sunHour, setSunHour] = useState(12);
  const [compassDeg, setCompassDeg] = useState(180);
  const [firstPersonMode, setFirstPersonMode] = useState(false);
  const [floorMaterial, setFloorMaterial] = useState<FloorMaterialKey>("default");
  const [wallColor, setWallColor] = useState<WallColorKey>("white");
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [samplePreview, setSamplePreview] = useState<SamplePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);

  const [sampleFiles, setSampleFiles] = useState<SampleFile[]>([]);
  const [recentPlans, setRecentPlans] = useState<PlanListItem[]>([]);
  const canResetWorkspace = Boolean(file || analysis || samplePreview || error || activeTool);
  const currentSourceOverlayUrl = analysis ? sourceOverlayUrl(filePreviewUrl, samplePreview, file, analysis, sampleFiles) : null;

  const refreshRecentPlans = useCallback(() => {
    void listPlans().then((res) => setRecentPlans(res.plans)).catch(() => {});
  }, []);

  useEffect(() => {
    void health().then(setHealthStatus).catch(() => setHealthStatus(null));
    void listSampleFiles().then((res) => setSampleFiles(res.files)).catch(() => {});
    refreshRecentPlans();
  }, [refreshRecentPlans]);

  useEffect(() => {
    const intervalId = window.setInterval(refreshRecentPlans, 5_000);
    return () => window.clearInterval(intervalId);
  }, [refreshRecentPlans]);

  useEffect(() => {
    if (analysis) setShowPanel(true);
  }, [analysis]);

  useEffect(() => {
    if (!file) {
      setFilePreviewUrl(null);
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setFilePreviewUrl(nextPreviewUrl);
    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [file]);

  const resetDragState = () => {
    dragDepth.current = 0;
    setIsDraggingFile(false);
  };

  const handleFileChange = (nextFile: File | null) => {
    resetDragState();
    if (!nextFile) {
      setFile(null);
      setAnalysis(null);
      setActiveTool(null);
      setMeasureMode(false);
      setMeasureResult(null);
      setMeasurementScale(1);
      setShowSourceOverlay(false);
      setSourceOverlayOpacity(0.35);
      setAutoRotate(true);
      setSamplePreview(null);
      setError(null);
      return;
    }
    if (!isSupportedUpload(nextFile)) {
      setError(SUPPORTED_UPLOAD_MESSAGE);
      return;
    }
    setFile(nextFile);
    setAnalysis(null);
    setActiveTool(null);
    setMeasureMode(false);
    setMeasureResult(null);
    setMeasurementScale(1);
    setShowSourceOverlay(false);
    setSourceOverlayOpacity(0.35);
    setAutoRotate(true);
    setSamplePreview(null);
    setError(null);
  };

  const handleActiveToolChange = (tool: ToolId | null) => {
    if (tool !== "source" && activeTool === "source") {
      setShowSourceOverlay(false);
    }
    setActiveTool(tool);
    if (tool === "walk") {
      setViewMode("3d");
      setFirstPersonMode(true);
    }
    if (tool === "sun") {
      setViewMode("3d");
    }
    if (tool === "furniture") {
      setShowFurniture(true);
    }
    if (tool === "source") {
      setViewMode("top");
      setShowSourceOverlay(Boolean(currentSourceOverlayUrl));
    }
    if (tool !== "measure") {
      setMeasureMode(false);
      setMeasureResult(null);
    }
    if (tool !== "walk") {
      setFirstPersonMode(false);
    }
  };

  const handleViewModeChange = (nextViewMode: ViewMode) => {
    setViewMode(nextViewMode);
    if (nextViewMode === "top" && activeTool === "walk") {
      setActiveTool(null);
      setFirstPersonMode(false);
    }
  };

  const handleFirstPersonToggle = () => {
    setFirstPersonMode((enabled) => {
      const nextEnabled = !enabled;
      if (nextEnabled) {
        setViewMode("3d");
        setActiveTool("walk");
      } else if (activeTool === "walk") {
        setActiveTool(null);
      }
      return nextEnabled;
    });
  };

  const handleResetWorkspace = () => {
    if (isLoading) return;
    resetDragState();
    setFile(null);
    setAnalysis(null);
    setShowPanel(true);
    setActiveTool(null);
    setViewMode("3d");
    setMeasureMode(false);
    setMeasureResult(null);
    setMeasurementScale(1);
    setShowSourceOverlay(false);
    setSourceOverlayOpacity(0.35);
    setShowFurniture(true);
    setAutoRotate(true);
    setSunHour(12);
    setCompassDeg(180);
    setFirstPersonMode(false);
    setFloorMaterial("default");
    setWallColor("white");
    setSamplePreview(null);
    setError(null);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = isLoading ? "none" : "copy";
    setIsDraggingFile(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDraggingFile(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    const nextFile = event.dataTransfer.files.item(0);
    resetDragState();
    if (isLoading) return;
    handleFileChange(nextFile);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setIsLoading(true);
    setError(null);
    setAnalysisProgress({
      status: "uploading",
      message: "Uploading floor plan.",
      progressPct: 2,
      sourceFile: file.name,
    });
    try {
      setAnalysis(await analyzePlan(file, { onProgress: setAnalysisProgress }));
      refreshRecentPlans();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAnalysisProgress(null);
      setIsLoading(false);
    }
  };

  const handleSampleFile = async (sample: SampleFile) => {
    if (isLoading) return;
    setFile(null);
    setAnalysis(null);
    setActiveTool(null);
    setMeasureMode(false);
    setMeasureResult(null);
    setShowSourceOverlay(false);
    setSourceOverlayOpacity(0.35);
    setAutoRotate(true);
    setSamplePreview({
      url: sampleFilePreviewUrl(sample.filename),
      contentType: sample.previewContentType ?? sample.contentType,
    });
    setError(null);
    setIsLoading(true);
    setAnalysisProgress({
      status: "pending",
      message: "Queueing sample analysis.",
      progressPct: 2,
      sourceFile: sample.filename,
    });
    try {
      setAnalysis(await analyzeSampleFile(sample.filename, { onProgress: setAnalysisProgress }));
      refreshRecentPlans();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAnalysisProgress(null);
      setIsLoading(false);
    }
  };

  const handleRecentPlan = async (plan: PlanListItem) => {
    if (isLoading) return;
    setFile(null);
    setSamplePreview(null);
    setError(null);
    setIsLoading(true);
    setAnalysisProgress({
      planId: plan.id,
      status: plan.status === "ready" ? "ready" : plan.status,
      message: plan.statusMessage || (plan.status === "ready" ? "Loading saved spatial model." : "Waiting for analysis to finish."),
      progressPct: plan.progressPct ?? (plan.status === "ready" ? 100 : 20),
      sourceFile: plan.sourceFile,
    });
    try {
      setAnalysis(await loadPlanAnalysis(plan.id, { onProgress: setAnalysisProgress }));
      setActiveTool(null);
      setMeasureMode(false);
      setMeasureResult(null);
      setShowSourceOverlay(false);
      setSourceOverlayOpacity(0.35);
      setAutoRotate(true);
      refreshRecentPlans();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAnalysisProgress(null);
      setIsLoading(false);
    }
  };

  const handleExportSvg = () => {
    if (!analysis) return;
    const svg = document.querySelector("[data-spatial-viewer-svg]");
    if (!(svg instanceof SVGSVGElement)) return;

    const serialized = new XMLSerializer().serializeToString(svg);
    downloadBlob(`${fileStem(analysis.name)}-scene.svg`, "image/svg+xml", serialized);
  };

  const handleExportJson = () => {
    if (!analysis) return;
    downloadBlob(`${fileStem(analysis.name)}-spatial-contract.json`, "application/json", JSON.stringify(analysis, null, 2));
  };

  return (
    <div
      className="relative flex h-full overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFile ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-2 rounded border border-dashed border-primary bg-surface px-8 py-6 text-center">
            <UploadIcon className="h-5 w-5 text-primary" />
            <p className="text-[0.875rem] font-semibold text-foreground">
              {isLoading ? "Analysis in progress" : "Drop floor plan to upload"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isLoading ? "Wait for the current plan to finish." : "PNG, JPG, or PDF"}
            </p>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/50">
          <div className="w-[min(380px,calc(100vw-2rem))] rounded border border-border bg-surface px-3 py-3 shadow-panel">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="truncate text-xs font-semibold text-foreground">
                {analysisProgress?.message ?? "Analyzing floor plan"}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
              <div
                className="h-full rounded bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(4, Math.min(100, analysisProgress?.progressPct ?? 18))}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[0.6875rem] text-muted-foreground">
              <span className="truncate">{analysisProgress?.sourceFile ?? "floor plan"}</span>
              {analysisProgress?.planId ? <span className="mono-data shrink-0">{analysisProgress.planId}</span> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="relative flex-1">
        {analysis ? (
          <SpatialViewer
            analysis={analysis}
            viewMode={viewMode}
            showFurniture={showFurniture}
            measureMode={measureMode}
            firstPersonMode={firstPersonMode}
            sunHour={sunHour}
            compassDeg={compassDeg}
            floorMaterial={floorMaterial}
            wallColor={wallColor}
            autoRotate={autoRotate}
            sourceOverlayUrl={currentSourceOverlayUrl}
            sourceOverlayOpacity={sourceOverlayOpacity}
            showSourceOverlay={showSourceOverlay}
            measurementScale={measurementScale}
            onMeasure={setMeasureResult}
          />
        ) : (
          <WorkspaceSplash
            sampleFiles={sampleFiles}
            recentPlans={recentPlans}
            isLoading={isLoading}
            onSampleFile={handleSampleFile}
            onRecentPlan={handleRecentPlan}
          />
        )}

        <div className="absolute left-3 top-3 z-20 flex flex-col items-start gap-1.5">
          <div className="flex items-center gap-1.5">
            <div className="flex items-center rounded border border-border bg-surface px-2 py-1 shadow-panel">
              <FileDropzone file={file} isLoading={isLoading} onAnalyze={handleAnalyze} onFileChange={handleFileChange} />
            </div>
            {canResetWorkspace ? (
              <button
                type="button"
                onClick={handleResetWorkspace}
                disabled={isLoading}
                className="flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-muted-foreground shadow-panel transition-colors duration-150 hover:text-foreground disabled:pointer-events-none disabled:opacity-55"
                aria-label="Reset workspace"
                title="Reset workspace"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {analysis ? (
              <button
                type="button"
                onClick={() => setShowPanel((v) => !v)}
                className="flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-muted-foreground shadow-panel transition-colors duration-150 hover:text-foreground"
                aria-label={showPanel ? "Hide details" : "Show details"}
              >
                <PanelRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {analysis ? (
            <ViewerTools
              activeTool={activeTool}
              onActiveToolChange={handleActiveToolChange}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              measureMode={measureMode}
              onMeasureModeChange={(enabled) => {
                setMeasureMode(enabled);
                if (!enabled) setMeasureResult(null);
              }}
              measureResult={measureResult}
              measurementScale={measurementScale}
              onMeasurementScaleChange={setMeasurementScale}
              hasSourceOverlay={Boolean(currentSourceOverlayUrl)}
              showSourceOverlay={showSourceOverlay}
              onSourceOverlayToggle={() => setShowSourceOverlay((value) => !value)}
              sourceOverlayOpacity={sourceOverlayOpacity}
              onSourceOverlayOpacityChange={setSourceOverlayOpacity}
              showFurniture={showFurniture}
              onFurnitureToggle={() => setShowFurniture((value) => !value)}
              autoRotate={autoRotate}
              onAutoRotateToggle={() => setAutoRotate((value) => !value)}
              sunHour={sunHour}
              onSunHourChange={setSunHour}
              compassDeg={compassDeg}
              onCompassChange={setCompassDeg}
              firstPersonMode={firstPersonMode}
              onFirstPersonToggle={handleFirstPersonToggle}
              floorMaterial={floorMaterial}
              onFloorMaterialChange={setFloorMaterial}
              wallColor={wallColor}
              onWallColorChange={setWallColor}
              onExportSvg={handleExportSvg}
              onExportJson={handleExportJson}
            />
          ) : null}
        </div>

        <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
          {error ? (
            <div className="flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 shadow-panel">
              <AlertTriangle className="h-3 w-3 shrink-0 text-[oklch(0.50_0.16_25)]" />
              <span className="max-w-[180px] truncate text-[0.6875rem] font-medium text-[oklch(0.50_0.16_25)]">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
                aria-label="Dismiss error"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 shadow-panel">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: healthStatus ? "oklch(0.62 0.14 145)" : "oklch(0.70 0.12 55)" }}
            />
            <span className="text-[0.6875rem] text-muted-foreground">
              {healthStatus ? healthStatus.service : "Connecting"}
            </span>
          </div>
        </div>
      </div>

      {analysis && showPanel ? (
        <aside className="w-[340px] shrink-0 overflow-hidden border-l border-border bg-surface">
          <AnalysisSummary
            analysis={analysis}
            originalFileUrl={filePreviewUrl ?? samplePreview?.url}
            originalPreviewContentType={file?.type || samplePreview?.contentType || analysis.contentType}
            onClose={() => setShowPanel(false)}
          />
        </aside>
      ) : null}
    </div>
  );
}

function WorkspaceSplash({
  sampleFiles,
  recentPlans,
  isLoading,
  onSampleFile,
  onRecentPlan,
}: {
  sampleFiles: SampleFile[];
  recentPlans: PlanListItem[];
  isLoading: boolean;
  onSampleFile: (sample: SampleFile) => void;
  onRecentPlan: (plan: PlanListItem) => void;
}) {
  const visibleSamples = sampleFiles.slice(0, 2);
  const visiblePlans = recentPlans.slice(0, 5);

  return (
    <div
      className="flex h-full items-center justify-center px-6"
      style={{ background: "oklch(0.96 0.005 250)" }}
    >
      <div className="w-full max-w-[760px]">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-border bg-surface">
            <UploadIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-[0.875rem] font-semibold text-foreground">Drop a floor plan here</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload a PNG, JPG, or PDF, or load a sample plan.
            </p>
          </div>
        </div>

        {visibleSamples.length > 0 ? (
          <div className="mt-7">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-label">Sample Plans</h2>
              <span className="mono-data text-muted-foreground">
                {visibleSamples.length} files
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleSamples.map((sample) => {
                const isPdf = sample.contentType.toLowerCase().includes("pdf");
                const PreviewIcon = isPdf ? FileText : FileImage;

                return (
                  <button
                    key={sample.filename}
                    type="button"
                    onClick={() => onSampleFile(sample)}
                    disabled={isLoading}
                    className="group overflow-hidden rounded border border-border bg-surface text-left transition-colors duration-150 hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-55"
                    aria-label={`Load sample plan ${sample.filename}`}
                  >
                    <div className="aspect-[16/10] border-b border-border bg-background p-2">
                      <img
                        src={sampleFilePreviewUrl(sample.filename)}
                        alt={`Preview of ${sample.filename}`}
                        className="h-full w-full object-contain"
                        loading="eager"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <PreviewIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-foreground" title={sample.filename}>
                            {sample.filename}
                          </div>
                          <div className="mono-data mt-0.5 text-muted-foreground">
                            {sampleLabel(sample.contentType)} · {formatBytes(sample.sizeBytes)}
                          </div>
                        </div>
                      </div>
                      <span className="mono-data shrink-0 text-primary">LOAD</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {visiblePlans.length > 0 ? (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-label">Recent Plans</h2>
              <span className="mono-data text-muted-foreground">
                {visiblePlans.length} saved
              </span>
            </div>
            <div className="overflow-hidden rounded border border-border bg-surface">
              {visiblePlans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => onRecentPlan(plan)}
                  disabled={isLoading}
                  className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left transition-colors duration-150 last:border-b-0 hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-55"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground" title={plan.name}>
                      {plan.name}
                    </div>
                    <div className="mono-data mt-0.5 truncate text-muted-foreground">
                      {plan.sourceFile} · {planStatusLabel(plan)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="mono-data text-primary">{planActionLabel(plan)}</div>
                    <div className="mono-data mt-0.5 text-muted-foreground">{formatPlanUpdated(plan.updatedAt)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function downloadBlob(filename: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function fileStem(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "floor-plan";
}

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function isSupportedUpload(file: File) {
  if (SUPPORTED_FILE_TYPES.has(file.type)) return true;
  return /\.(png|jpe?g|pdf)$/i.test(file.name);
}

function sampleLabel(contentType: string) {
  if (contentType.toLowerCase().includes("pdf")) return "PDF";
  if (contentType.toLowerCase().includes("jpeg")) return "JPG";
  if (contentType.toLowerCase().includes("png")) return "PNG";
  return "FILE";
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024)).toLocaleString()} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatArea(areaSqm: number) {
  if (!Number.isFinite(areaSqm) || areaSqm <= 0) return "area pending";
  return `${areaSqm.toFixed(1)} m²`;
}

function sourceOverlayUrl(
  filePreviewUrl: string | null,
  samplePreview: SamplePreview | null,
  file: File | null,
  analysis: PlanAnalysis,
  sampleFiles: SampleFile[],
) {
  const url = filePreviewUrl ?? samplePreview?.url ?? null;
  const contentType = file?.type || samplePreview?.contentType || analysis.contentType;
  if (url && contentType.toLowerCase().startsWith("image/")) return url;

  const matchingSample = sampleFiles.find((sample) => sample.filename === analysis.sourceFile);
  const sampleContentType = matchingSample?.previewContentType ?? matchingSample?.contentType ?? "";
  if (matchingSample && sampleContentType.toLowerCase().startsWith("image/")) {
    return sampleFilePreviewUrl(matchingSample.filename);
  }

  return null;
}

function formatPlanUpdated(value?: string | null) {
  if (!value) return "saved";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "saved";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function planStatusLabel(plan: PlanListItem) {
  if (plan.status === "ready") return `${plan.roomCount} rooms · ${formatArea(plan.totalAreaSqm)}`;
  if (plan.status === "failed") return "failed";
  const pct = typeof plan.progressPct === "number" ? `${plan.progressPct}%` : plan.status;
  return `${plan.status} · ${pct}`;
}

function planActionLabel(plan: PlanListItem) {
  if (plan.status === "ready") return "OPEN";
  if (plan.status === "failed") return "ERROR";
  return "WAIT";
}

function errorMessage(err: unknown) {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Request failed.";
}
