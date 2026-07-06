#!/usr/bin/env bash
# KRP-703 — build the release artifact end users download: a clean zip of the
# runtime plugin (komanga.koplugin) with dev-only files stripped. Installing is
# then "unzip into .adds/koreader/plugins/ and restart KOReader" on any OS — no
# script, no toolchain (see INSTALL.md). This runs on the maintainer's machine to
# cut a GitHub release; it is not part of the plugin.
set -euo pipefail

EPIC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_NAME="komanga.koplugin"
PLUGIN_DIR="${EPIC_DIR}/${PLUGIN_NAME}"
OUT_DIR="${1:-${EPIC_DIR}/dist}"

# Dev-only / editor / OS junk that must not ship (same set as the device deploy).
EXCLUDES=('spec/*' '.busted' '.luacheckrc' '*.log' '.DS_Store' '._*' '*/.gitkeep')

die() { echo "error: $*" >&2; exit 1; }

command -v zip >/dev/null 2>&1 || die "'zip' not found — install it and retry."
[[ -f "${PLUGIN_DIR}/main.lua" ]] || die "plugin not found at ${PLUGIN_DIR}"

VERSION="$(git -C "${EPIC_DIR}" rev-parse --short HEAD 2>/dev/null || echo "dev")"
ZIP_PATH="${OUT_DIR}/${PLUGIN_NAME}-${VERSION}.zip"

mkdir -p "${OUT_DIR}"
rm -f "${ZIP_PATH}"

# Zip the folder itself (not its contents) so the archive extracts to
# `komanga.koplugin/…`, ready to drop straight into `plugins/`.
zip_excludes=()
for pat in "${EXCLUDES[@]}"; do zip_excludes+=(-x "${PLUGIN_NAME}/${pat}"); done
( cd "${EPIC_DIR}" && zip -rq "${ZIP_PATH}" "${PLUGIN_NAME}" "${zip_excludes[@]}" )

echo "built ${ZIP_PATH}"
echo "contents:"
unzip -l "${ZIP_PATH}" | awk 'NR>3 && $4 {print "  " $4}' | grep -v '^  ----' || true
