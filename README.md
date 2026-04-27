# Spatial Stack

Spatial Stack is an automated 2D-to-3D spatial visualization prototype for institutional floor-plan review. It uses a Vite frontend, a Python FastAPI backend that also runs as Lambda, and Terraform for the AWS serverless deployment.

## What This Scaffold Does

- Accepts PNG, JPG, and PDF floor-plan uploads from the browser.
- Calls OpenRouter only through the backend, so model credentials and source-file handling never move into frontend code.
- Uses one configured OpenRouter analysis model. `OPENROUTER_MODEL` controls local runs, Terraform's `openrouter_model` controls deployed runs, and the current backend/Terraform default is `google/gemini-3-flash-preview`.
- Returns a typed spatial contract whose spaces, room bounds, walls, openings, fixtures, labels, and furniture drive the interactive 3D-style model.
- Persists shared plan records in memory locally, or DynamoDB when deployed, including pending, processing, ready, and failed states.
- Shows analysis progress while the backend works, then lets users reopen saved plans from the shared Recent Plans list.
- Stores raw uploaded plans in S3 when `RAW_PLAN_BUCKET_NAME` is configured.
- Deploys through CloudFront, private S3 frontend hosting, API Gateway, Lambda, DynamoDB, and a private raw-plan S3 bucket.

OpenRouter is required for analysis. If `OPENROUTER_API_KEY` is missing or the configured model cannot produce a valid spatial contract, the API returns an explicit error instead of fabricating a fallback layout. There is no second-model fallback path.

## Analysis Flow

1. The backend sends the floor-plan image, or the first rendered PDF page, to OpenRouter Chat Completions with `response_format: { type: "json_schema" }`.
2. The configured OpenRouter model produces one spatial payload. Gemini-family models use a compact provider-compatible schema, and the backend can retry the same model with `response_format: { type: "json_object" }` if the provider rejects the schema arguments.
3. Python normalizes provider aliases and safe display defaults, including nested room geometry (`dimensions`, `position`, `bounds`) and space polygon aliases (`polygon`, `points`, `boundary`, `vertices`, `outline`, `coordinates`).
4. Linked space polygons become authoritative for room bounds, renderer-safe walls/openings/labels are derived where needed, then Pydantic validates the payload against the `PlanAnalysis` contract.
5. The analyzer applies sanity checks that catch empty room extraction, missing dimensions, severe room overlap when room rectangles are the only geometry, furniture outside parent rooms, low confidence, and incomplete extracted geometry.
6. Status updates are saved on the shared plan record while the worker runs, and only a validated spatial contract becomes a ready result.

Local FastAPI and AWS both return a saved plan record immediately, then the frontend polls `GET /plans/{planId}` until the plan becomes `ready` or `failed`. In AWS, the upload request also writes the raw floor plan to S3 and invokes the Lambda worker asynchronously.

## Quick Start

For a first local run, create the backend virtualenv and configure the OpenRouter key:

```bash
cd backend
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
${EDITOR:-vi} .env
cd ..
```

Then run both backend and frontend locally from the repo root:

```bash
make dev
```

This starts FastAPI on `http://localhost:8000` and Vite on `http://localhost:5173`. The Makefile installs frontend dependencies if `frontend/node_modules` is missing, but it expects `backend/.venv` to already exist.

## Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Default environment:

```dotenv
VITE_API_BASE_URL=http://localhost:8000
```

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
${EDITOR:-vi} .env
python -m uvicorn app.main:app --reload --port 8000
```

Smoke test:

```bash
cd backend
.venv/bin/python smoke_test.py
```

## AWS Deployment

Create Terraform variables:

```bash
make tfvars
```

Review `infra/terraform/terraform.tfvars`, then deploy:

```bash
make infradeploy
make fedeploy
make health
make outputs
```

The deployed frontend uses same-origin `/api` through CloudFront. Direct API Gateway access is rejected when the private origin header is configured.

## Architecture Notes

- Architecture overview: `docs/architecture.md`
- Build approach and tradeoffs: `docs/build-approach.md`
- Executive walkthrough script: `docs/demo-script.md`
- Editable AWS Draw.io diagram: `docs/aws-architecture.drawio`
- AWS architecture PNG export: `docs/aws-architecture.png`

- Frontend: Vite, React, TypeScript, Tailwind CSS.
- Backend: Python, FastAPI, Pydantic, Lambda-compatible handler, optional boto3 integrations.
- AI: OpenRouter Chat Completions is the required backend model path. It uses one configured model, JSON structured output, provider-aware schema handling, Pydantic contract validation, polygon-first geometry normalization, and sanity checks. Analysis is queued behind a saved plan record and the frontend polls `/plans/{id}` so slow model calls do not leave the UI stuck, and API Gateway's 30-second integration timeout does not cap deployed model runtime.
- Infrastructure: Terraform, S3 static hosting behind CloudFront OAC, API Gateway HTTP API, Lambda, DynamoDB, private raw-plan S3 bucket, optional cost guardrails.

## Architecture Diagram

![Spatial Stack AWS architecture](docs/aws-architecture.png)
