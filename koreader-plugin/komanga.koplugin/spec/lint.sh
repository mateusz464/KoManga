#!/usr/bin/env bash
# KRP-202 — luacheck the plugin (CLAUDE.md §9: luacheck clean before Done).
#
# Usage (from anywhere):
#   koreader-plugin/komanga.koplugin/spec/lint.sh          # lint the whole plugin
#   koreader-plugin/komanga.koplugin/spec/lint.sh main.lua # ...or specific files
#
# Like spec/run.sh, this reuses the emulator build (KRP-102) instead of a separate
# toolchain: luacheck was installed into that build's rocks tree with
#   luarocks --tree=<build>/spec/rocks install luacheck
# Falls back to a `luacheck` on PATH if the emulator isn't built.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EPIC_DIR="$(cd "${PLUGIN_DIR}/.." && pwd)"

# Glob the platform-triple build dir rather than hard-coding it (same as run.sh).
LUACHECK=""
for d in "${EPIC_DIR}"/.emulator/src/base/build/*/spec/rocks; do
    if [[ -x "${d}/bin/luacheck" ]]; then
        LUACHECK="${d}/bin/luacheck"
        break
    fi
done

cd "${PLUGIN_DIR}"

if [[ -n "${LUACHECK}" ]]; then
    exec "${LUACHECK}" "${@:-.}"
fi

if command -v luacheck >/dev/null 2>&1; then
    echo "note: emulator build not found; using luacheck from PATH" >&2
    exec luacheck "${@:-.}"
fi

echo "error: no luacheck found. Install it into the emulator rocks tree:" >&2
echo "  luarocks --tree=<emulator build>/spec/rocks install luacheck" >&2
exit 1
