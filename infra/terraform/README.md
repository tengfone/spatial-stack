# Spatial Stack Terraform

Serverless AWS scaffold for Scenario C:

- CloudFront HTTPS distribution for the Vite frontend and `/api/*` backend path
- Private S3 bucket for static frontend assets
- Private S3 bucket for raw floor-plan uploads
- DynamoDB table for shared plan analysis records, worker status, and results
- Python Lambda API
- API Gateway HTTP API behind same-origin CloudFront `/api/*` routing
- Lambda IAM permissions for DynamoDB, raw-plan S3, and CloudWatch logs
- Lambda self-invoke permission for async deployed floor-plan analysis
- Optional AWS Budget and CloudWatch billing/usage alarms

## Deploy

From the repo root:

```bash
make tfvars
${EDITOR:-vi} infra/terraform/terraform.tfvars
make sts
make openrouter-check
make infradeploy
make fedeploy
make health
```

Use Docker packaging on macOS or Apple Silicon if Lambda dependency wheels are a problem:

```bash
make infradeploy LAMBDA_PACKAGER=docker
```

The deployed frontend calls `/api` on the same CloudFront domain. CloudFront forwards API requests to API Gateway with a Terraform-generated private header. The Lambda rejects direct origin-bypass requests when `API_ORIGIN_HEADER_VALUE` is configured.

Set `openrouter_api_key` before deploying. It is written to Terraform state and the Lambda environment, so prefer a hackathon/demo key with a spending limit.

Set `openrouter_model` to override the deployed Lambda model. The Terraform default currently matches the backend default:

```hcl
openrouter_model = "google/gemini-3-flash-preview"
```

`make openrouter-check` checks this configured model for image input, `response_format`, and structured-output support. There is no fallback-model Terraform variable.

In AWS, `POST /plans/analyze` and sample analysis requests return a pending plan record instead of waiting for OpenRouter. The Lambda writes uploaded raw plans to S3, records `pending` in DynamoDB, invokes itself asynchronously, then the worker updates `statusMessage` / `progressPct` while it runs OpenRouter structured output analysis, Pydantic validation, and spatial sanity checks. The frontend polls `GET /plans/{planId}` until DynamoDB reports `ready` or `failed`, and `GET /plans` exposes the shared queue for reopening ready plans or tracking in-flight jobs. This avoids API Gateway's 30-second integration timeout.
