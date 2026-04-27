import { config } from "@/lib/config";

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown | FormData;
  timeoutMs?: number;
  timeoutMessage?: string;
};

const ANALYSIS_START_TIMEOUT_MS = 28_000;
const ANALYSIS_POLL_INTERVAL_MS = 1_500;
const ANALYSIS_POLL_TIMEOUT_MS = 180_000;

export type AnalysisProgress = {
  planId?: string;
  status: "uploading" | "pending" | "processing" | "ready" | "failed";
  message: string;
  progressPct?: number | null;
  sourceFile?: string;
};

type AnalyzeOptions = {
  onProgress?: (progress: AnalysisProgress) => void;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type ProcessingMode = "openrouter";

export type FurnitureItem = {
  id: string;
  kind: string;
  widthM: number;
  depthM: number;
  xM: number;
  yM: number;
  rotationDeg: number;
};

export type PlanPoint = {
  xM: number;
  yM: number;
};

export type SpaceGeometry = {
  id: string;
  label: string;
  type: string;
  polygon: PlanPoint[];
  areaSqm?: number | null;
  confidence: number;
  linkedRoomId?: string | null;
};

export type WallSegment = {
  id: string;
  points: PlanPoint[];
  thicknessM: number;
  heightM: number;
  confidence: number;
};

export type Opening = {
  id: string;
  kind: "door" | "window" | "opening";
  xM: number;
  yM: number;
  widthM: number;
  rotationDeg: number;
  swingDeg?: number | null;
  wallId?: string | null;
  confidence: number;
};

export type Fixture = {
  id: string;
  kind: string;
  xM: number;
  yM: number;
  widthM: number;
  depthM: number;
  rotationDeg: number;
  spaceId?: string | null;
  confidence: number;
};

export type PlanLabel = {
  id: string;
  text: string;
  xM: number;
  yM: number;
  widthM?: number | null;
  depthM?: number | null;
  linkedSpaceId?: string | null;
  confidence: number;
};

export type RoomType =
  | "living_room"
  | "bedroom"
  | "kitchen"
  | "bathroom"
  | "hallway"
  | "office"
  | "dining_room"
  | "storage"
  | "balcony"
  | "utility";

export type Room = {
  id: string;
  name: string;
  type: RoomType;
  areaSqm: number;
  widthM: number;
  depthM: number;
  xM: number;
  yM: number;
  confidence: number;
  furniture: FurnitureItem[];
};

export type SpatialMetrics = {
  roomCount: number;
  circulationAreaSqm: number;
  estimatedWallLengthM: number;
  furnitureFitScore: number;
  sightlineScore: number;
};

export type PlanAnalysis = {
  id: string;
  name: string;
  status: "ready";
  sourceFile: string;
  contentType: string;
  buildingType: string;
  floors: number;
  totalAreaSqm: number;
  notes: string;
  processingMode: ProcessingMode;
  modelId?: string | null;
  rawObjectKey?: string | null;
  floorPlate?: PlanPoint[];
  spaces?: SpaceGeometry[];
  walls?: WallSegment[];
  openings?: Opening[];
  fixtures?: Fixture[];
  labels?: PlanLabel[];
  rooms: Room[];
  metrics: SpatialMetrics;
};

export type PlanAnalysisJob = {
  id: string;
  status: "pending" | "processing" | "failed";
  sourceFile: string;
  contentType: string;
  processingMode: ProcessingMode;
  statusMessage?: string | null;
  progressPct?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  error?: string | null;
  rawObjectKey?: string | null;
};

type PlanAnalysisResponse = PlanAnalysis | PlanAnalysisJob;

export type PlanListItem = {
  id: string;
  status: "ready" | "pending" | "processing" | "failed";
  name: string;
  buildingType: string;
  totalAreaSqm: number;
  roomCount: number;
  processingMode: ProcessingMode;
  sourceFile: string;
  statusMessage?: string | null;
  progressPct?: number | null;
  updatedAt?: string | null;
};

export type HealthResponse = {
  status: string;
  service: string;
  version: string;
};

export async function health(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export async function listPlans(): Promise<{ plans: PlanListItem[]; limit: number }> {
  return request<{ plans: PlanListItem[]; limit: number }>("/plans");
}

export async function analyzePlan(file: File, options: AnalyzeOptions = {}): Promise<PlanAnalysis> {
  const data = new FormData();
  data.append("file", file);
  options.onProgress?.({
    status: "uploading",
    message: "Uploading floor plan.",
    progressPct: 2,
    sourceFile: file.name,
  });
  const response = await request<PlanAnalysisResponse>("/plans/analyze", {
    method: "POST",
    body: data,
    timeoutMs: analysisStartTimeout(),
    timeoutMessage: "Analysis did not start before the 30s API limit. Try a smaller or clearer image.",
  });
  return waitForPlanAnalysis(response, options);
}

export type SampleFile = {
  filename: string;
  sizeBytes: number;
  contentType: string;
  previewContentType?: string;
};

export async function listSampleFiles(): Promise<{ files: SampleFile[] }> {
  return request<{ files: SampleFile[] }>("/sample-files");
}

export async function analyzeSampleFile(filename: string, options: AnalyzeOptions = {}): Promise<PlanAnalysis> {
  options.onProgress?.({
    status: "pending",
    message: "Queueing sample analysis.",
    progressPct: 2,
    sourceFile: filename,
  });
  const response = await request<PlanAnalysisResponse>(`/sample-files/${encodeURIComponent(filename)}/analyze`, {
    method: "POST",
    timeoutMs: analysisStartTimeout(),
    timeoutMessage: "Analysis did not start before the 30s API limit. Try again in a moment.",
  });
  return waitForPlanAnalysis(response, options);
}

export async function getPlan(planId: string): Promise<PlanAnalysisResponse> {
  return request<PlanAnalysisResponse>(`/plans/${encodeURIComponent(planId)}`);
}

export async function loadPlanAnalysis(planId: string, options: AnalyzeOptions = {}): Promise<PlanAnalysis> {
  const response = await getPlan(planId);
  return waitForPlanAnalysis(response, options);
}

export function sampleFileUrl(filename: string): string {
  return `${config.apiBaseUrl}/sample-files/${encodeURIComponent(filename)}`;
}

export function sampleFilePreviewUrl(filename: string): string {
  return `${sampleFileUrl(filename)}/preview`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const body: BodyInit | undefined = isFormData
    ? (options.body as FormData)
    : options.body
      ? JSON.stringify(options.body)
      : undefined;
  const controller = options.timeoutMs ? new AbortController() : undefined;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), options.timeoutMs) : undefined;
  let response: Response;

  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: isFormData ? undefined : { "Content-Type": "application/json" },
      body,
      signal: controller?.signal,
    });
  } catch (err) {
    if (controller?.signal.aborted) {
      throw new ApiError(options.timeoutMessage ?? "Request timed out.", 504);
    }
    throw err;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }

  const text = await response.text();
  let payload: Record<string, unknown> | null = null;

  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = payloadValue(payload, "detail") ?? payloadValue(payload, "error") ?? payloadValue(payload, "message") ?? `Request failed with ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

function payloadValue(payload: Record<string, unknown> | null, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function waitForPlanAnalysis(response: PlanAnalysisResponse, options: AnalyzeOptions = {}): Promise<PlanAnalysis> {
  emitProgress(response, options.onProgress);
  if (isReadyAnalysis(response)) return response;
  if (response.status === "failed") {
    throw new ApiError(response.error || "Analysis failed.", 502);
  }

  const deadline = Date.now() + ANALYSIS_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await delay(ANALYSIS_POLL_INTERVAL_MS);
    const next = await getPlan(response.id);
    emitProgress(next, options.onProgress);
    if (isReadyAnalysis(next)) return next;
    if (next.status === "failed") {
      throw new ApiError(next.error || "Analysis failed.", 502);
    }
  }

  throw new ApiError("Analysis is still running. Refresh the plan list or try again later.", 504);
}

function emitProgress(response: PlanAnalysisResponse, onProgress?: (progress: AnalysisProgress) => void) {
  if (!onProgress) return;
  if (isReadyAnalysis(response)) {
    onProgress({
      planId: response.id,
      status: "ready",
      message: "Spatial model ready.",
      progressPct: 100,
      sourceFile: response.sourceFile,
    });
    return;
  }

  onProgress({
    planId: response.id,
    status: response.status,
    message: response.statusMessage || defaultStatusMessage(response.status),
    progressPct: response.progressPct,
    sourceFile: response.sourceFile,
  });
}

function defaultStatusMessage(status: PlanAnalysisJob["status"]) {
  if (status === "pending") return "Queued for analysis.";
  if (status === "processing") return "Analyzing floor plan with OpenRouter.";
  return "Analysis failed.";
}

function isReadyAnalysis(response: PlanAnalysisResponse): response is PlanAnalysis {
  return response.status === "ready" && Array.isArray((response as PlanAnalysis).rooms) && Boolean((response as PlanAnalysis).metrics);
}

function analysisStartTimeout(): number | undefined {
  return isLocalApiBaseUrl() ? undefined : ANALYSIS_START_TIMEOUT_MS;
}

function isLocalApiBaseUrl() {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(config.apiBaseUrl);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
