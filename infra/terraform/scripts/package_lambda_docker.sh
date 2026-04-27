#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$TF_DIR/../.." && pwd)"
DOCKERFILE="${LAMBDA_PACKAGE_DOCKERFILE:-$TF_DIR/lambda-packager.Dockerfile}"
IMAGE_NAME="${LAMBDA_PACKAGE_IMAGE:-spatial-stack-lambda-packager:py312}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
DOCKER_USER="${LAMBDA_PACKAGE_DOCKER_USER:-$(id -u):$(id -g)}"
ZIP_PATH="$TF_DIR/build/lambda_api.zip"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for package_lambda_docker.sh" >&2
  exit 1
fi

docker build \
  --platform "$DOCKER_PLATFORM" \
  -f "$DOCKERFILE" \
  -t "$IMAGE_NAME" \
  "$TF_DIR"

docker run --rm \
  --platform "$DOCKER_PLATFORM" \
  --user "$DOCKER_USER" \
  -e HOME=/tmp \
  -e PIP_DISABLE_PIP_VERSION_CHECK=1 \
  -e PIP_NO_CACHE_DIR=1 \
  -e PYTHON_BIN=python3 \
  -e PYTHON_VERSION=3.12 \
  -e PYTHON_ABI=cp312 \
  -e PLATFORM=manylinux2014_x86_64 \
  -v "$ROOT_DIR:/workspace" \
  -w /workspace \
  "$IMAGE_NAME"

if [ ! -f "$ZIP_PATH" ]; then
  echo "Expected Lambda package was not created: $ZIP_PATH" >&2
  exit 1
fi

ls -lh "$ZIP_PATH"

