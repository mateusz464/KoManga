#!/usr/bin/env bash
# KRP-103 — run the plugin's busted specs (pure-Lua logic only).
#
# Usage (from anywhere):
#   koreader-plugin/komanga.koplugin/spec/run.sh            # run all specs
#   koreader-plugin/komanga.koplugin/spec/run.sh -o utfTerminal --verbose
#   ...any extra args are passed straight through to busted.
#
# There is no separate test toolchain to install: this reuses the busted that
# KOReader's emulator build already produced (KRP-102), so the test runtime is
# the same LuaJIT the plugin ships on. If the emulator isn't built, it falls
# back to a `busted` on PATH.
set -euo pipefail

# komanga.koplugin/ — busted is run from here so .busted's lpath resolves the
# plugin's own modules (state/, api/, spec/support/).
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EPIC_DIR="$(cd "${PLUGIN_DIR}/.." && pwd)"

# The emulator build (KRP-102) ships busted + its rocks under a platform-triple
# build dir; glob it rather than hard-coding the triple.
ROCKS=""
for d in "${EPIC_DIR}"/.emulator/src/base/build/*/spec/rocks; do
    if [[ -x "${d}/bin/busted" ]]; then
        ROCKS="${d}"
        break
    fi
done

cd "${PLUGIN_DIR}"

if [[ -n "${ROCKS}" ]]; then
    # busted's own deps (penlight, luassert, say, …) live in the rocks tree but
    # aren't on the launcher's path; expose them via LUA_PATH/LUA_CPATH.
    export LUA_PATH="${ROCKS}/share/lua/5.1/?.lua;${ROCKS}/share/lua/5.1/?/init.lua;;"
    export LUA_CPATH="${ROCKS}/lib/lua/5.1/?.so;;"
    exec "${ROCKS}/bin/busted" "$@"
fi

if command -v busted >/dev/null 2>&1; then
    echo "note: emulator build not found; using busted from PATH" >&2
    exec busted "$@"
fi

echo "error: no busted found. Build the emulator (KRP-102) or install busted." >&2
exit 1
