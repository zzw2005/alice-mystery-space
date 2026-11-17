#!/usr/bin/env bash
# Only production deployment entry point. Legacy WinForms script is archived.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
case "${1:-}" in
  --verify-only) shift; exec pwsh.exe -NoProfile -File "$ROOT/tools/deploy-electron.ps1" -VerifyOnly "$@" ;;
  --asset)
    asset="${2:-}"
    case "$asset" in
      idle|idle.webm) asset=idle.webm ;;
      *) echo "Only --asset idle is enabled for this release" >&2; exit 2 ;;
    esac
    exec pwsh.exe -NoProfile -File "$ROOT/tools/deploy-electron.ps1" -Asset "$asset"
    ;;
  --assets) shift ;;
  "") ;;
  *) echo "Usage: deploy-pet.sh [--asset idle|--verify-only]" >&2; exit 2 ;;
esac
exec pwsh.exe -NoProfile -File "$ROOT/tools/deploy-electron.ps1" "$@"
