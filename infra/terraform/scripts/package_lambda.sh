#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$TF_DIR/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
BUILD_DIR="$TF_DIR/build"
PACKAGE_DIR="$BUILD_DIR/lambda"
ZIP_PATH="$BUILD_DIR/lambda_api.zip"

PYTHON_BIN="${PYTHON_BIN:-python3}"
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"
PYTHON_ABI="${PYTHON_ABI:-cp312}"
PLATFORM="${PLATFORM:-manylinux2014_x86_64}"

rm -rf "$PACKAGE_DIR" "$ZIP_PATH"
mkdir -p "$PACKAGE_DIR" "$BUILD_DIR"

"$PYTHON_BIN" -m pip install \
  --upgrade \
  --target "$PACKAGE_DIR" \
  --platform "$PLATFORM" \
  --implementation cp \
  --python-version "$PYTHON_VERSION" \
  --abi "$PYTHON_ABI" \
  --only-binary=:all: \
  -r "$BACKEND_DIR/requirements-lambda.txt"

cp -R "$BACKEND_DIR/app" "$PACKAGE_DIR/app"
if [ -d "$BACKEND_DIR/sample_files" ]; then
  mkdir -p "$PACKAGE_DIR/sample_files"
  shopt -s nullglob
  sample_files=("$BACKEND_DIR"/sample_files/*.json "$BACKEND_DIR"/sample_files/*.png "$BACKEND_DIR"/sample_files/*.jpg "$BACKEND_DIR"/sample_files/*.pdf)
  if [ "${#sample_files[@]}" -gt 0 ]; then
    cp "${sample_files[@]}" "$PACKAGE_DIR/sample_files/"
  fi
  shopt -u nullglob
fi

"$PYTHON_BIN" - "$PACKAGE_DIR" <<'PY'
import shutil
import sys
from pathlib import Path

package_dir = Path(sys.argv[1])

for path in package_dir.rglob("__pycache__"):
    if path.is_dir():
        shutil.rmtree(path)

for path in package_dir.rglob("*.pyc"):
    path.unlink()
PY

if command -v zip >/dev/null 2>&1; then
  (cd "$PACKAGE_DIR" && zip -qr "$ZIP_PATH" .)
else
  "$PYTHON_BIN" - "$PACKAGE_DIR" "$ZIP_PATH" <<'PY'
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

package_dir = Path(sys.argv[1])
zip_path = Path(sys.argv[2])

with ZipFile(zip_path, "w", ZIP_DEFLATED) as archive:
    for path in sorted(package_dir.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(package_dir).as_posix())
PY
fi

echo "Wrote $ZIP_PATH"

