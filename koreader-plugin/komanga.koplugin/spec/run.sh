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

# The api/ client decodes JSON with rapidjson, the same C module the plugin uses
# on-device (CLAUDE.md §2). KOReader builds it as common/rapidjson.so under the
# same build dir; expose it on LUA_CPATH so the api-client spec (KRP-301) — which
# drops to the HTTP boundary, not the api/ boundary — runs against the real codec.
COMMON=""
for d in "${EPIC_DIR}"/.emulator/src/base/build/*/common; do
    if [[ -f "${d}/rapidjson.so" ]]; then
        COMMON="${d}"
        break
    fi
done

# rapidjson.so is linked against @rpath/libluajit.dylib; the busted luajit's
# first rpath is staging/bin/libs, which the KOReader build leaves empty (the
# real dylib sits in <build>/libs). DYLD_LIBRARY_PATH can't help — busted's
# /bin/sh shebang is SIP-protected, so macOS strips DYLD_* on exec. Symlink the
# dylib into that rpath dir instead (idempotent; .emulator is regenerable).
if [[ -n "${COMMON}" ]]; then
    BUILD_DIR="$(dirname "${COMMON}")"
    LJ_DYLIB="${BUILD_DIR}/libs/libluajit.dylib"
    RPATH_DIR="${BUILD_DIR}/staging/bin/libs"
    if [[ -f "${LJ_DYLIB}" && ! -e "${RPATH_DIR}/libluajit.dylib" ]]; then
        mkdir -p "${RPATH_DIR}"
        ln -sf "${LJ_DYLIB}" "${RPATH_DIR}/libluajit.dylib"
    fi
fi

cd "${PLUGIN_DIR}"

if [[ -n "${ROCKS}" ]]; then
    # busted's own deps (penlight, luassert, say, …) live in the rocks tree but
    # aren't on the launcher's path; expose them via LUA_PATH/LUA_CPATH.
    export LUA_PATH="${ROCKS}/share/lua/5.1/?.lua;${ROCKS}/share/lua/5.1/?/init.lua;;"
    export LUA_CPATH="${COMMON:+${COMMON}/?.so;}${ROCKS}/lib/lua/5.1/?.so;;"
    exec "${ROCKS}/bin/busted" "$@"
fi

if command -v busted >/dev/null 2>&1; then
    echo "note: emulator build not found; using busted from PATH" >&2
    exec busted "$@"
fi

echo "error: no busted found. Build the emulator (KRP-102) or install busted." >&2
exit 1
