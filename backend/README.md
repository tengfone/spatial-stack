# Spatial Stack Backend

FastAPI API for local development and a Lambda-compatible handler for AWS deployment.

## Local Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
${EDITOR:-vi} .env
python -m uvicorn app.main:app --reload --port 8000
```

`OPENROUTER_API_KEY` is required. `OPENROUTER_MODEL` defaults to `google/gemini-3-flash-preview` when unset. `OPENROUTER_MODEL_ID` is accepted as a compatibility alias only when `OPENROUTER_MODEL` is unset. The backend does not generate local fallback layouts and does not switch to a second model.

`PDF_RENDER_MAX_DIMENSION` optionally caps first-page PDF rasterization before the image is sent to OpenRouter. The default is `2200`.

## OpenRouter Analysis Pipeline

The analyzer is intentionally backend-owned:

1. Convert PDFs to a first-page JPEG when needed; images are sent as base64 data URLs.
2. Call OpenRouter Chat Completions with the configured single model and a structured output request. The primary request uses `response_format.type = "json_schema"`; Gemini-family models use the compact schema path and can retry the same model with `json_object` when the provider rejects JSON Schema arguments.
3. Normalize the response into the backend spatial contract. The normalizer accepts nested room geometry from `dimensions`, `position`, `coordinates`, `bounds`, or rectangle-style fields, and accepts space polygons from `polygon`, `points`, `boundary`, `vertices`, `outline`, `coordinates`, or nested `geometry`.
4. Make linked space polygons authoritative for room bounds, derive renderer-safe walls/openings/labels when needed, and validate the final contract with Pydantic.
5. Run sanity checks for no rooms, missing dimensions, severe room overlaps when room rectangles are the only geometry, furniture outside rooms, low confidence, and incomplete extracted geometry.
6. Save worker status messages and progress percentages while analysis runs.
7. Return or persist only the validated `PlanAnalysis` contract as the final ready result.

If the configured model fails or the API key is missing, callers receive an explicit error.

## Endpoints

- `GET /health`
- `GET /plans`
- `GET /plans/{planId}`
- `GET /sample-files`
- `GET /sample-files/{filename}`
- `GET /sample-files/{filename}/preview`
- `POST /sample-files/{filename}/analyze`
- `POST /plans/analyze`
- `POST /reset`

`POST /plans/analyze` accepts multipart form upload locally. The Lambda handler also accepts multipart bodies from API Gateway and a raw binary body with `x-filename`.

Local FastAPI and the Lambda handler use the same job shape: create a shared plan record, return `202`, and let the frontend poll `GET /plans/{planId}` until it becomes `ready` or `failed`. Pending and processing records include `statusMessage`, `progressPct`, `createdAt`, and `updatedAt`, so the UI can show useful progress instead of a spinner-only state. The deployed Lambda path stores raw uploads in S3 before invoking the async worker, so API Gateway's 30-second integration timeout does not cap model runtime.

`GET /plans` returns the shared queue, including pending, processing, ready, and failed records. Locally this queue is process memory and resets when the backend restarts; in AWS it is DynamoDB-backed shared state.
