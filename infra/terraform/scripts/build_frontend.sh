#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$TF_DIR/../.." && pwd)"

API_BASE_URL="${1:-${VITE_API_BASE_URL:-}}"

if [[ -z "$API_BASE_URL" ]]; then
  echo "Usage: $0 <api_base_url_or_path>"
  echo "Or set VITE_API_BASE_URL in the environment."
  exit 1
fi

cd "$ROOT_DIR/frontend"
VITE_API_BASE_URL="$API_BASE_URL" npm run build

