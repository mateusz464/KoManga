#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EPIC_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
EMULATOR_DIR="${EPIC_DIR}/.emulator"
KOREADER_DIR="${EMULATOR_DIR}/src"
STAGE_DIR="${KOREADER_DIR}/spec/unit"
MANIFEST="${STAGE_DIR}/.komanga-tracked-specs"

usage() {
    cat <<'EOF'
Usage: koreader-plugin/spec/emulator/run.sh [--live] [--lint] [SPEC...]

With no SPEC arguments, runs the deterministic KoManga emulator integration
suite. Pass --live to also run the local-API check, or --lint to luacheck the
tracked suite instead of running it. SPEC may be a tracked filename or path.
EOF
}

include_live=false
lint_only=false
selected=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --live)
            include_live=true
            ;;
        --lint)
            lint_only=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --)
            shift
            while [[ $# -gt 0 ]]; do
                selected+=("$(basename "$1")")
                shift
            done
            break
            ;;
        -*)
            echo "error: unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
        *)
            selected+=("$(basename "$1")")
            ;;
    esac
    shift
done

if [[ ! -x "${KOREADER_DIR}/kodev" || ! -f "${EMULATOR_DIR}/buildenv.sh" ]]; then
    echo "error: KOReader emulator not found at ${EMULATOR_DIR}" >&2
    echo "Build the KRP-102 emulator environment first; see docs/koreader.md." >&2
    exit 1
fi

mkdir -p "${STAGE_DIR}"
if [[ -f "${MANIFEST}" ]]; then
    while IFS= read -r name; do
        if [[ -n "${name}" ]]; then
            rm -f "${STAGE_DIR}/${name}"
        fi
    done < "${MANIFEST}"
fi

tracked=()
for source in "${SCRIPT_DIR}"/komanga*_spec.lua; do
    name="$(basename "${source}")"
    install -m 0644 "${source}" "${STAGE_DIR}/${name}"
    tracked+=("${name}")
done
printf '%s\n' "${tracked[@]}" > "${MANIFEST}"

if [[ ${#selected[@]} -eq 0 ]]; then
    if [[ "${lint_only}" == true ]]; then
        selected=("${tracked[@]}")
    else
        selected=(
            komanga_stale_windows_kom161_spec.lua
            komanga_dialog_content_spec.lua
            komanga_next_chapter_kom160_spec.lua
            komanga_return_to_browse_kom172_spec.lua
            komanga_source_modes_kom165_spec.lua
            komanga_swipe_kom159_spec.lua
        )
        if [[ "${include_live}" == true ]]; then
            selected+=(komanga_next_chapter_kom160_live_spec.lua)
        fi
    fi
fi

staged=()
runtime=()
for name in "${selected[@]}"; do
    if [[ "${name}" != *.lua ]]; then
        name="${name}.lua"
    fi
    if [[ ! -f "${SCRIPT_DIR}/${name}" ]]; then
        echo "error: no tracked emulator spec named ${name}" >&2
        exit 2
    fi
    staged+=("spec/unit/${name}")
    runtime+=("spec/front/unit/${name}")
done

cd "${KOREADER_DIR}"

if [[ "${lint_only}" == true ]]; then
    for candidate in base/build/*/spec/rocks/bin/luacheck; do
        if [[ -x "${candidate}" ]]; then
            exec "${candidate}" "${staged[@]}"
        fi
    done
    echo "error: emulator luacheck not found; see docs/koreader.md." >&2
    exit 1
fi

source "${EMULATOR_DIR}/buildenv.sh"
export KOMANGA_PLUGIN_ROOT="${EPIC_DIR}/komanga.koplugin"
exec ./kodev test -b --busted front "${runtime[@]}"
