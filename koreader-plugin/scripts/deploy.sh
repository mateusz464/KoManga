#!/usr/bin/env bash
# KRP-203 — deploy/reload the plugin into the emulator or onto the Kobo, so the
# dev loop is one command instead of manual file shuffling.
#
# Usage (from anywhere):
#   scripts/deploy.sh emulator        # link komanga.koplugin into the emulator
#   scripts/deploy.sh device          # copy it onto the Kobo over USB
#   scripts/deploy.sh run [args...]   # link + launch the emulator (args -> kodev run)
#
# KOReader has no hot-reload: it reads plugins once at start. "Reload" therefore
# means a KOReader restart — the emulator/device targets place the files and the
# `run` target restarts the emulator for you.
#
# Emulator deploy is a *symlink* (KRP-102's chosen mechanism): source edits are
# picked up on the next restart with no copy step. Device deploy is a copy over
# USB (the Kobo mounts as KOBOeReader; install dir per docs/koreader.md KRP-101).
set -euo pipefail

EPIC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="${EPIC_DIR}/komanga.koplugin"
PLUGIN_NAME="komanga.koplugin"

# The Kobo's USB mount + plugin dir (docs/koreader.md, KRP-101). Override the
# mount point with KOBO_MOUNT if the volume is named differently.
KOBO_MOUNT="${KOBO_MOUNT:-/Volumes/KOBOeReader}"
KOBO_PLUGINS="${KOBO_MOUNT}/.adds/koreader/plugins"

# Files that are dev-only (or macOS junk) and should not ship to the device.
DEVICE_EXCLUDES=(--exclude 'spec/' --exclude '.busted' --exclude '.luacheckrc'
                 --exclude '*.log' --exclude '.DS_Store' --exclude '._*')

die() { echo "error: $*" >&2; exit 1; }

# Locate the emulator's plugins dir; glob the platform-triple build (KRP-102)
# rather than hard-coding it. Empty if the emulator isn't built.
emulator_plugins_dir() {
    local d
    for d in "${EPIC_DIR}"/.emulator/src/koreader-emulator-*/koreader/plugins; do
        [[ -d "${d}" ]] && { echo "${d}"; return 0; }
    done
    return 1
}

deploy_emulator() {
    local plugins
    plugins="$(emulator_plugins_dir)" \
        || die "emulator not built — build it first (docs/koreader.md, KRP-102)."
    ln -sfn "${PLUGIN_DIR}" "${plugins}/${PLUGIN_NAME}"
    echo "linked ${PLUGIN_NAME} -> ${plugins}/${PLUGIN_NAME}"
    echo "restart KOReader (or use 'scripts/deploy.sh run') to reload."
}

deploy_device() {
    [[ -d "${KOBO_MOUNT}" ]] \
        || die "Kobo not mounted at ${KOBO_MOUNT} — connect it over USB (or set KOBO_MOUNT)."
    mkdir -p "${KOBO_PLUGINS}/${PLUGIN_NAME}"
    # The Kobo is exFAT/FAT: it can't hold the extended attributes macOS files
    # carry, so the VFS spills them into AppleDouble `._*` sidecars on write.
    # COPYFILE_DISABLE=1 suppresses that, and dot_clean sweeps any that slip
    # through (plus pre-existing ones) so the device install stays clean.
    COPYFILE_DISABLE=1 rsync -a --delete "${DEVICE_EXCLUDES[@]}" \
        "${PLUGIN_DIR}/" "${KOBO_PLUGINS}/${PLUGIN_NAME}/"
    command -v dot_clean >/dev/null 2>&1 && dot_clean -m "${KOBO_PLUGINS}/${PLUGIN_NAME}"
    echo "copied ${PLUGIN_NAME} -> ${KOBO_PLUGINS}/${PLUGIN_NAME}"
    echo "eject the Kobo and restart KOReader to reload."
}

run_emulator() {
    deploy_emulator
    # shellcheck source=/dev/null
    source "${EPIC_DIR}/.emulator/buildenv.sh"
    cd "${EPIC_DIR}/.emulator/src"
    exec ./kodev run "$@"
}

case "${1:-}" in
    emulator) deploy_emulator ;;
    device)   deploy_device ;;
    run)      shift; run_emulator "$@" ;;
    *) die "usage: $(basename "$0") {emulator|device|run [kodev args...]}" ;;
esac
