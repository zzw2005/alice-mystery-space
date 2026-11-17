#!/usr/bin/env bash
# Only production deployment entry point. Legacy WinForms script is archived.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
case "${1:-}" in
  --verify-only) shift; exec pwsh.exe -NoProfile -File "$ROOT/tools/deploy-electron.ps1" -VerifyOnly "$@" ;;
  --assets) shift ;;
  "") ;;
  *) echo "Usage: deploy-pet.sh [--assets|--verify-only]" >&2; exit 2 ;;
esac
exec pwsh.exe -NoProfile -File "$ROOT/tools/deploy-electron.ps1" "$@"
