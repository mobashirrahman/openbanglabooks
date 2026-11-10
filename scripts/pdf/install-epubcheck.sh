#!/usr/bin/env bash
# Install a local Temurin JRE and EPUBCheck for `pnpm pdf:build --epubcheck`.
#
# Usage:
#   scripts/pdf/install-epubcheck.sh
#   OCR_ENGINES_ROOT=/path scripts/pdf/install-epubcheck.sh
#
# No root or system Java is required.
set -euo pipefail

ROOT="${OCR_ENGINES_ROOT:-$HOME/.local/share/ocr-engines}"
JAVA_DIR="$ROOT/java"
EPUBCHECK_VERSION="5.4.0"
EPUBCHECK_DIR="$ROOT/epubcheck-${EPUBCHECK_VERSION}"

mkdir -p "$ROOT" "$JAVA_DIR"

if ! find "$JAVA_DIR" -maxdepth 3 -name java -type f -print -quit | grep -q .; then
  echo "Downloading Temurin JRE 21..."
  archive="$(mktemp)"
  curl -L -o "$archive" \
    "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse"
  python3 - "$archive" "$JAVA_DIR" <<'PY'
import sys
import tarfile

archive, dest = sys.argv[1], sys.argv[2]
with tarfile.open(archive, "r:gz") as tar:
    tar.extractall(dest, filter="data")
PY
  rm -f "$archive"
fi

if [ ! -f "$EPUBCHECK_DIR/epubcheck.jar" ]; then
  echo "Downloading EPUBCheck ${EPUBCHECK_VERSION}..."
  archive="$(mktemp)"
  curl -L -o "$archive" \
    "https://github.com/w3c/epubcheck/releases/download/v${EPUBCHECK_VERSION}/epubcheck-${EPUBCHECK_VERSION}.zip"
  python3 - "$archive" "$ROOT" <<'PY'
import sys
import zipfile

archive, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(archive) as bundle:
    bundle.extractall(dest)
PY
  rm -f "$archive"
fi

JAVA="$(find "$JAVA_DIR" -maxdepth 3 -name java -type f -print -quit)"
JAR="$EPUBCHECK_DIR/epubcheck.jar"
"$JAVA" -version 2>&1 | head -1
"$JAVA" -jar "$JAR" --version | head -1

cat <<EOF

Installed:
  JAVA=$JAVA
  EPUBCHECK=$JAR

Run:
  PATH="$(dirname "$JAVA"):\$PATH" pnpm pdf:build \\
    --work .work/pdf/book --out dist/book.epub --epubcheck "$JAR"
EOF
