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

`OPENROUTER_API_KEY` is required. `OPENROUTER_MODEL` defaults to `google/gemini-3-flash-preview`. The backend does not generate local fallback layouts.

## OpenRouter Analysis Pipeline

The analyzer is intentionally backend-owned:

1. Convert PDFs to a first-page JPEG when needed; images are sent as base64 data URLs.
2. Call OpenRouter Chat Completions with the configured single model and strict JSON Schema structured output.
3. Normalize the response into the backend spatial contract, making linked space polygons authoritative for room bounds, and validate it with Pydantic.
4. Run sanity checks for no rooms, missing dimensions, severe room overlaps when room rectangles are the only geometry, furniture outside rooms, and low confidence.
5. Save worker status messages and progress percentages while analysis runs.
6. Return or persist only the validated `PlanAnalysis` contract as the final ready result.

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
