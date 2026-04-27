# Build Approach

## Approach

The build focused on the smallest complete Scenario C demo that could withstand hackathon judging: a planner uploads or selects a 2D floor plan, the backend converts it into a structured spatial contract with OpenRouter, the UI renders an inspectable model, and the architecture page proves the deployment is a real serverless system rather than a browser-only mockup.

The product is shaped around the institutional review flow: source plan -> AI interpretation -> dual validation -> spatial viewer -> source comparison -> export. Each step answers one question a government planner or facilities manager would ask: What was submitted? What did the model extract? Did the contract pass schema and spatial sanity checks? Can I inspect the geometry? Can I verify it against the original? Can I hand off the result?

The backend owns the model boundary, validation, geometry cleanup, shared job status, persistence, and raw-plan storage. The frontend owns professional review: model inspection, progress display, measurements, visual toggles, source preview, saved-plan reopening, and export. That separation is intentional. A planning product should not hide model access in the browser, and it should not treat AI output as final planning authority.

The product stance is model-assisted extraction, human-verified review. OpenRouter converts visual evidence into a first-pass spatial contract through the configured multimodal model; Python validates the contract twice, first structurally with Pydantic and then spatially with sanity checks; the reviewer remains responsible for trusting or rejecting the result.

## Priorities

- Stable 5-10 minute hackathon demo flow.
- Viewer-first UI: the spatial model dominates the screen.
- Institutional tone: precise, dense, professional, and light-theme for office use.
- Direct upload or sample-plan path for PNG, JPG, and PDF.
- Backend-only OpenRouter integration with no browser-side model credentials.
- Typed spatial contract that the frontend can render and export.
- Shared saved plan queue with pending, processing, ready, and failed status.
- Progress messages while slow model calls are running.
- Explicit error when model access is unavailable, rather than fabricated fallback geometry.
- Original-plan preview for reviewer verification.
- Geometry guardrails for overlapping rooms and furniture.
- Useful planner tools: 3D, top view, source overlay, measure, furniture, sun/orientation, walk-through, materials, export.
- Minimal AWS serverless deployment path that can be explained quickly.
- Terraform-managed cost guardrails for hackathon safety.

## Tech Choices

- **Vite + React + TypeScript**: Fast iteration and a static frontend deployable to private S3 behind CloudFront. Typed API contracts in `frontend/src/lib/api-client.ts` keep the UI aligned with backend payloads.
- **Tailwind CSS + local primitives**: Gives a controlled design system without adopting a heavy UI library. The interface uses compact toolbars, right-side analysis panels, and restrained controls instead of a generic dashboard layout.
- **SVG spatial renderer**: The viewer in `SpatialViewer.tsx` renders 3D-style room prisms, top view, source overlays, furniture, labels, shadows, measurement overlays, and walk-through HUD with standard browser primitives. This keeps the demo lightweight and makes SVG export straightforward.
- **Python + FastAPI + Pydantic**: FastAPI provides the local development API. Pydantic defines the plan analysis contract and rejects malformed model output before it reaches the UI.
- **Direct OpenRouter HTTP client**: The backend posts directly to OpenRouter's `/chat/completions` endpoint with `response_format.type = "json_schema"` and one configured model. `OPENROUTER_MODEL` controls local runs, Terraform's `openrouter_model` controls AWS, and the current backend/Terraform default is `google/gemini-3-flash-preview`. Gemini-family models use a compact provider-compatible schema and can retry the same model with `json_object` if the provider rejects schema arguments.
- **PyMuPDF**: PDF floor plans are rendered to first-page JPEG images before analysis, which lets the same multimodal path handle image and PDF sources.
- **S3 raw-plan storage**: When `RAW_PLAN_BUCKET_NAME` is configured, uploaded source plans are stored under `plans/{planId}/...` with server-side encryption.
- **DynamoDB**: On-demand billing and a simple `pk`/`sk` table support shared plan records, worker status, stored analysis contracts, and audit records without standing database cost.
- **AWS Lambda + API Gateway HTTP API**: The backend can run without servers. API Gateway forwards to Lambda, while Lambda enforces the CloudFront private origin header in deployed mode.
- **CloudFront + private S3**: One public HTTPS surface serves the frontend and routes `/api/*` to the backend. The frontend bucket stays private through Origin Access Control.
- **Terraform + Makefile scripts**: `make infradeploy`, `make fedeploy`, `make health`, and packaging scripts provide a repeatable deployment story for the judging panel.

## Tradeoffs

- The viewer is an SVG 3D-style renderer, not a full CAD, BIM, WebGL, or Three.js environment. That is a deliberate hackathon tradeoff: it is reliable, inspectable, exportable, and enough to prove the workflow.
- OpenRouter is required for analysis. There is no local mock layout path, because a fake fallback would undermine the trust story. The smoke test checks that missing credentials fail explicitly.
- Model output can vary between runs. The demo script avoids hardcoded room counts and dimensions and tells the presenter to read current values from the UI.
- PDF handling renders the first page only. Multi-sheet plans, drawing indexes, page selection, scale bars, and scanned-image cleanup are future work.
- Dimensions are model-derived estimates. They are useful for early review and triage, but they are not survey-grade or construction-grade measurements.
- Local development uses in-memory shared state for speed, including pending and processing plan records. AWS switches to DynamoDB when `APP_DATA_TABLE_NAME` is set.
- Raw plan storage is optional locally and enabled in AWS. Production would need retention policies tied to agency records management.
- The CloudFront private header blocks casual direct API Gateway access but is not user authentication.
- OpenRouter API keys are stored in Terraform state and Lambda environment variables for the hackathon deployment. A production build should use Secrets Manager or another managed secret path.
- The frontend currently has a small route set: Workspace and Architecture. That keeps the demo focused, but portfolio review history, batch analysis, and comparison views are not yet implemented.

## Challenges

- **Converting visual floor plans into structured geometry.** A 2D plan is not a data table. Room labels, walls, fixtures, door swings, and dimensions are visual evidence. Solution: the backend sends a detailed schema-guided prompt to OpenRouter and requires JSON with space polygons, compatibility room bounds, coordinates, dimensions, furniture, and metrics.
- **Keeping model output renderer-safe.** Model-generated geometry can overlap, omit fields, use inconsistent aliases, or place furniture outside rooms. Solution: OpenRouter is asked for structured output, Python normalizes provider-specific aliases, canonicalizes nested room geometry from `dimensions`, `position`, `coordinates`, `bounds`, or rectangle-style fields, makes linked space polygons authoritative for matching room bounds, infers missing room types, derives safe display defaults when possible, repairs renderer-hostile placement geometry, and validates the final payload with Pydantic.
- **Failing weak extraction clearly.** The app now uses one configured model. Empty room extraction, severe room overlap when rectangle geometry is the only source, missing dimensions, furniture outside rooms, low confidence, incomplete space extraction, missing floor plate polygons, missing openings, or Pydantic validation failure marks the plan failed instead of blending in a second model's interpretation.
- **Avoiding hidden browser-side AI.** The original style of many quick prototypes is to call an AI service directly from the browser. That does not work for institutional software. Solution: the browser only calls the backend API. OpenRouter keys, PDF rendering, storage, and error handling all stay server-side.
- **Avoiding stuck analysis states and API Gateway's 30-second ceiling.** Analysis can exceed a comfortable UI wait and, in AWS, the API Gateway integration timeout even when Lambda has more time available. Solution: the API writes a pending shared record, returns `202`, updates `statusMessage` / `progressPct` through the worker, and the frontend polls the plan record until it is ready or failed. In AWS the upload is first stored in S3, then the Lambda invokes itself asynchronously.
- **Handling source files.** PDFs are rendered to first-page JPEGs before analysis, and image uploads are sent as base64 data URLs through the backend-owned OpenRouter request.
- **Supporting PDFs without building a document system.** Many floor plans arrive as PDFs, but a full plan-set parser would be too large for the hackathon. Solution: render page 1 to a bounded JPEG with PyMuPDF and pass it through the same image-analysis path.
- **Trustworthy demo failure mode.** A hackathon recording needs to survive missing credentials, but pretending to analyze a floor plan would be misleading. Solution: the API returns clear errors such as `OPENROUTER_API_KEY is required for floor-plan analysis`, and the demo notes explain that this is a trust guardrail.
- **Viewer-first design under tight time.** The product should not look like a generic SaaS dashboard. Solution: the interface uses a 48px top nav, a large spatial canvas, compact floating toolbars, a fixed right analysis panel, dense room rows, and restrained colors from the Spatial Stack design system.
- **Making the output useful beyond a visual.** A screenshot alone would be weak for a grading panel. Solution: the export tool downloads both an SVG scene and the full spatial JSON contract, proving that the result can move into downstream workflows.
- **Low-cost AWS story.** Hackathon prototypes can be expensive or hard to explain if they use always-on infrastructure. Solution: static S3/CloudFront frontend, Lambda/API Gateway backend, DynamoDB on-demand, lifecycle-managed raw-plan S3, reserved Lambda concurrency, API throttles, and optional budget alarms.
- **Keeping claims honest.** It would be easy to overclaim code compliance, accessibility validation, or construction accuracy. Solution: docs and demo script explicitly position furniture fit, sightlines, measurements, and sun controls as planning aids requiring human verification.

## Improvements With More Time

- Add authentication, role-based access, organization workspaces, and reviewer audit trails.
- Move `OPENROUTER_API_KEY` from Terraform variables into Secrets Manager or another managed secret store.
- Add batch upload and plan-portfolio queues for agencies reviewing many submissions.
- Add calibrated side-by-side source comparison with wall and space diff highlighting beyond the current top-view overlay.
- Add page selection and multi-page handling for PDF drawing packages.
- Add scale calibration from visible dimensions or scale bars.
- Add a human correction layer for room boundaries, labels, furniture, and coordinates.
- Add confidence-driven review routing for low-confidence or high-impact rooms.
- Add formal accessibility, fire-safety, zoning, and building-code rule engines as separate deterministic modules.
- Add GLB or IFC export after the spatial contract is stable.
- Add Playwright smoke tests for Workspace, sample analysis states, exports, and Architecture route.
- Add CloudFront access logs, WAF, custom domain, and production observability.
- Add signed raw-plan access and records-retention controls for real agency data.
