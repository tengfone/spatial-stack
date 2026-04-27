SHELL := /bin/bash

ROOT_DIR := $(CURDIR)
TF_DIR := $(ROOT_DIR)/infra/terraform
BACKEND_DIR := $(ROOT_DIR)/backend
FRONTEND_DIR := $(ROOT_DIR)/frontend

AWS_REGION ?= ap-southeast-1
OPENROUTER_MODEL ?= qwen/qwen3.5-flash-02-23
OPENROUTER_FALLBACK_MODEL ?= qwen/qwen3.6-flash
TF_PLAN ?= tfplan
LOG_SINCE ?= 30m
LAMBDA_PACKAGER ?= local

ifneq ($(filter $(LAMBDA_PACKAGER),local docker),$(LAMBDA_PACKAGER))
$(error LAMBDA_PACKAGER must be local or docker)
endif

PACKAGE_LAMBDA_SCRIPT := ./scripts/package_lambda.sh
ifeq ($(LAMBDA_PACKAGER),docker)
PACKAGE_LAMBDA_SCRIPT := ./scripts/package_lambda_docker.sh
endif

API_BASE_URL ?= $(shell cd "$(TF_DIR)" && terraform output -raw api_base_url 2>/dev/null)
FRONTEND_API_BASE_URL ?= $(shell cd "$(TF_DIR)" && terraform output -raw frontend_api_base_path 2>/dev/null)
FRONTEND_BUCKET ?= $(shell cd "$(TF_DIR)" && terraform output -raw frontend_bucket_name 2>/dev/null)
FRONTEND_URL ?= $(shell cd "$(TF_DIR)" && terraform output -raw frontend_url 2>/dev/null)
FRONTEND_CLOUDFRONT_DISTRIBUTION_ID ?= $(shell cd "$(TF_DIR)" && terraform output -raw frontend_cloudfront_distribution_id 2>/dev/null)

.DEFAULT_GOAL := help

.PHONY: help dev tfvars sts openrouter-check package-lambda package-lambda-docker tf-plan infradeploy fedeploy health logs health-local outputs backend-smoke frontend-build clean-plan

help:
	@echo "Spatial Stack commands"
	@echo ""
	@echo "Local:"
	@echo "  make dev              Start backend (:8000) and frontend (:5173)"
	@echo "  make health-local     Check local backend health"
	@echo "  make backend-smoke    Run backend smoke test"
	@echo "  make frontend-build   Run frontend production build"
	@echo ""
	@echo "AWS/Terraform:"
	@echo "  make tfvars           Create infra/terraform/terraform.tfvars if missing"
	@echo "  make sts              Show current AWS caller identity"
	@echo "  make openrouter-check Check the configured OpenRouter model supports image + structured output"
	@echo "  make package-lambda   Build infra/terraform/build/lambda_api.zip"
	@echo "  make package-lambda-docker"
	@echo "                        Build Lambda zip in a linux/amd64 Docker builder"
	@echo "  make tf-plan          Package Lambda, init, validate, and write Terraform plan"
	@echo "  make infradeploy      Plan, prompt, then apply Terraform infrastructure"
	@echo "  make fedeploy         Build frontend, upload to S3, and invalidate CloudFront"
	@echo "  make health           Check deployed API health"
	@echo "  make logs             Tail deployed Lambda logs"
	@echo "  make outputs          Print Terraform outputs"

dev:
	@set -e; \
	backend_pid=""; \
	frontend_pid=""; \
	cleanup() { \
		trap - INT TERM EXIT; \
		echo ""; \
		echo "Shutting down..."; \
		if [ -n "$$backend_pid" ]; then kill "$$backend_pid" 2>/dev/null || true; fi; \
		if [ -n "$$frontend_pid" ]; then kill "$$frontend_pid" 2>/dev/null || true; fi; \
		wait "$$backend_pid" "$$frontend_pid" 2>/dev/null || true; \
	}; \
	trap cleanup INT TERM EXIT; \
	if [ ! -x "$(BACKEND_DIR)/.venv/bin/python" ]; then \
		echo "Missing backend virtualenv at $(BACKEND_DIR)/.venv"; \
		echo "Run: cd backend && python -m venv .venv && .venv/bin/python -m pip install -r requirements.txt"; \
		exit 1; \
	fi; \
	if [ ! -d "$(FRONTEND_DIR)/node_modules" ]; then \
		echo "Installing frontend dependencies..."; \
		cd "$(FRONTEND_DIR)" && npm install; \
	fi; \
	echo "Starting backend on http://localhost:8000"; \
	cd "$(BACKEND_DIR)" && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload & backend_pid=$$!; \
	echo "Starting frontend on http://localhost:5173"; \
	cd "$(FRONTEND_DIR)" && npm run dev & frontend_pid=$$!; \
	wait "$$backend_pid" "$$frontend_pid"

tfvars:
	@if [ -f "$(TF_DIR)/terraform.tfvars" ]; then \
		echo "terraform.tfvars already exists: $(TF_DIR)/terraform.tfvars"; \
	else \
		cp "$(TF_DIR)/terraform.tfvars.example" "$(TF_DIR)/terraform.tfvars"; \
		echo "Created $(TF_DIR)/terraform.tfvars"; \
		echo "Review it before running make infradeploy."; \
	fi

sts:
	aws sts get-caller-identity

openrouter-check:
	@set -e; \
	models_json=$$(mktemp); \
	curl -fsS "https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs" > "$$models_json"; \
	for model in "$(OPENROUTER_MODEL)" "$(OPENROUTER_FALLBACK_MODEL)"; do \
		if [ -z "$$model" ]; then continue; fi; \
		python3 -c "import json,sys; model=sys.argv[1]; data=json.load(sys.stdin).get('data', []); found=next((item for item in data if item.get('id') == model), None); assert found, f'OpenRouter structured-output model not found: {model}'; arch=found.get('architecture') or {}; inputs=set(arch.get('input_modalities') or []); params=set(found.get('supported_parameters') or []); assert 'image' in inputs, f'OpenRouter model does not support image input: {model}'; assert 'structured_outputs' in params and 'response_format' in params, f'OpenRouter model does not support structured JSON output: {model}'; print(model)" "$$model" < "$$models_json"; \
	done; \
	rm -f "$$models_json"

package-lambda:
	cd "$(TF_DIR)" && $(PACKAGE_LAMBDA_SCRIPT)
	@ls -lh "$(TF_DIR)/build/lambda_api.zip"

package-lambda-docker:
	cd "$(TF_DIR)" && ./scripts/package_lambda_docker.sh

tf-plan: package-lambda
	cd "$(TF_DIR)" && terraform init
	cd "$(TF_DIR)" && terraform validate
	cd "$(TF_DIR)" && terraform plan -out="$(TF_PLAN)"

infradeploy: tf-plan
	@printf "\nApply Terraform plan $(TF_PLAN)? [y/N] "; \
	read answer; \
	case "$$answer" in \
		[yY]|[yY][eE][sS]) cd "$(TF_DIR)" && terraform apply "$(TF_PLAN)" ;; \
		*) echo "Cancelled. No infrastructure changes applied." ;; \
	esac

fedeploy:
	@if [ -z "$(FRONTEND_API_BASE_URL)" ]; then \
		echo "Missing FRONTEND_API_BASE_URL. Run make infradeploy first or pass FRONTEND_API_BASE_URL=/api"; \
		exit 1; \
	fi
	@if [ -z "$(FRONTEND_BUCKET)" ]; then \
		echo "Missing FRONTEND_BUCKET. Run make infradeploy first or pass FRONTEND_BUCKET=..."; \
		exit 1; \
	fi
	cd "$(TF_DIR)" && ./scripts/build_frontend.sh "$(FRONTEND_API_BASE_URL)"
	cd "$(TF_DIR)" && ./scripts/deploy_frontend.sh "$(FRONTEND_BUCKET)" "$(FRONTEND_CLOUDFRONT_DISTRIBUTION_ID)"
	@if [ -n "$(FRONTEND_URL)" ]; then \
		echo "Frontend URL: $(FRONTEND_URL)"; \
	fi

health:
	@if [ -z "$(API_BASE_URL)" ]; then \
		echo "Missing API_BASE_URL. Run make infradeploy first or pass API_BASE_URL=http://localhost:8000"; \
		exit 1; \
	fi
	curl -fsS "$(API_BASE_URL)/health"
	@printf "\n"

logs:
	@cd "$(TF_DIR)" && \
	region=$$(terraform output -raw aws_region 2>/dev/null || echo "$(AWS_REGION)"); \
	function_name=$$(terraform state show aws_lambda_function.api 2>/dev/null | awk -F'= ' '/function_name/ { gsub(/"/, "", $$2); print $$2; exit }'); \
	if [ -z "$$function_name" ]; then \
		echo "Could not find aws_lambda_function.api in Terraform state. Run make infradeploy first."; \
		exit 1; \
	fi; \
	echo "Tailing /aws/lambda/$$function_name in $$region since $(LOG_SINCE)"; \
	aws logs tail "/aws/lambda/$$function_name" --region "$$region" --follow --since "$(LOG_SINCE)"

health-local:
	$(MAKE) health API_BASE_URL=http://localhost:8000

outputs:
	cd "$(TF_DIR)" && terraform output

backend-smoke:
	cd "$(BACKEND_DIR)" && .venv/bin/python smoke_test.py

frontend-build:
	cd "$(FRONTEND_DIR)" && npm run build

clean-plan:
	rm -f "$(TF_DIR)/$(TF_PLAN)"
