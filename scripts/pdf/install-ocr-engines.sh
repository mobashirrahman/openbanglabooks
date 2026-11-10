#!/usr/bin/env bash
# Install the pinned OCR engines used by docs/pdf-to-epub.md:
#   Tesseract 5.5.3 (conda-forge) + tessdata_best ben (pinned commit).
#
# Usage:
#   scripts/pdf/install-ocr-engines.sh
#   OCR_ENGINES_ROOT=/path scripts/pdf/install-ocr-engines.sh
#
# No root, conda, or Java is required. Micromamba is downloaded as a single
# static binary and the Python standard library handles the .tar.bz2.
set -euo pipefail

ROOT="${OCR_ENGINES_ROOT:-$HOME/.local/share/ocr-engines}"
TESSERACT_VERSION="5.5.3"
TESSDATA_COMMIT="9ddc24e750eec0994223a9edc3fcb434a2244f3b"
TESSDATA_MD5="6e997a9bc0f9dffc3431a0b16ca856ea"
TESSDATA_URL="https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/${TESSDATA_COMMIT}/ben.traineddata"
ENV_DIR="$ROOT/tesseract-${TESSERACT_VERSION}"
TESSDATA_DIR="$ROOT/tessdata"
MICROMAMBA="$ROOT/micromamba"

mkdir -p "$ROOT"

if [ ! -x "$MICROMAMBA" ]; then
  archive="$(mktemp)"
  echo "Downloading micromamba..."
  curl -Ls -o "$archive" https://micro.mamba.pm/api/micromamba/linux-64/latest
  python3 - "$archive" "$ROOT" <<'PY'
import bz2
import sys
import tarfile

archive, dest = sys.argv[1], sys.argv[2]
with bz2.open(archive, "rb") as source, tarfile.open(fileobj=source, mode="r|") as tar:
    for member in tar:
        if member.name.endswith("bin/micromamba"):
            member.name = "micromamba"
            tar.extract(member, dest, filter="data")
            break
PY
  rm -f "$archive"
  chmod +x "$MICROMAMBA"
fi

if [ ! -x "$ENV_DIR/bin/tesseract" ]; then
  echo "Creating Tesseract ${TESSERACT_VERSION} environment..."
  MAMBA_ROOT_PREFIX="$ROOT/mamba" "$MICROMAMBA" create -y -p "$ENV_DIR" \
    -c conda-forge "tesseract=${TESSERACT_VERSION}"
fi

mkdir -p "$TESSDATA_DIR"
if [ ! -f "$TESSDATA_DIR/ben.traineddata" ]; then
  echo "Downloading pinned tessdata_best ben..."
  curl -L -o "$TESSDATA_DIR/ben.traineddata" "$TESSDATA_URL"
fi
echo "${TESSDATA_MD5}  ${TESSDATA_DIR}/ben.traineddata" | md5sum -c -

"$ENV_DIR/bin/tesseract" --version | head -1
cat <<EOF

Installed:
  TESSERACT=$ENV_DIR/bin/tesseract
  TESSDATA=$TESSDATA_DIR

Verify:
  pnpm pdf:check-ocr --check-engine tesseract \\
    --tesseract "$ENV_DIR/bin/tesseract" --tessdata "$TESSDATA_DIR"
EOF
