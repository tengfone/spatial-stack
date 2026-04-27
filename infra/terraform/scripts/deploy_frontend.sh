#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$TF_DIR/../.." && pwd)"

BUCKET_NAME="${1:-${FRONTEND_BUCKET_NAME:-}}"
CLOUDFRONT_DISTRIBUTION_ID="${FRONTEND_CLOUDFRONT_DISTRIBUTION_ID:-}"
DIST_DIR="$ROOT_DIR/frontend/dist"

if [[ $# -ge 2 && -n "${2:-}" ]]; then
  if [[ $# -eq 2 && -d "$2" ]]; then
    DIST_DIR="$2"
  else
    CLOUDFRONT_DISTRIBUTION_ID="$2"
  fi
fi

if [[ $# -ge 3 && -n "${3:-}" ]]; then
  DIST_DIR="$3"
fi

if [[ -z "$BUCKET_NAME" ]]; then
  echo "Usage: $0 <frontend_bucket_name> [cloudfront_distribution_id] [dist_dir]"
  echo "Or set FRONTEND_BUCKET_NAME in the environment."
  exit 1
fi

if [[ ! -d "$DIST_DIR" ]]; then
  echo "Frontend dist directory not found: $DIST_DIR"
  echo "Run scripts/build_frontend.sh first."
  exit 1
fi

aws s3 sync "$DIST_DIR/" "s3://$BUCKET_NAME/" --delete
aws s3 cp "$DIST_DIR/index.html" "s3://$BUCKET_NAME/index.html" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html"

echo "Uploaded $DIST_DIR to s3://$BUCKET_NAME"

if [[ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths "/*" >/dev/null
  echo "Requested CloudFront invalidation for $CLOUDFRONT_DISTRIBUTION_ID"
fi

