#!/bin/bash
# pc-transfer: stream folders between this VM and the user's PC (alice@userpc)
# as a single tar stream over the mux-reused SSH connection. No temp files,
# no per-file handshakes. Usage:
#   pc-transfer.sh pull 'D:\maoxing-shop-wt\docs' /tmp/docs.tar   # PC -> VM (tar file)
#   pc-transfer.sh pullx 'D:\maoxing-shop-wt\docs' /tmp/docsdir   # PC -> VM (extracted)
#   pc-transfer.sh push /tmp/somedir 'C:\Users\alice.DESKTOP-4Q8GMO4\scripts'  # VM -> PC (extracted)
set -euo pipefail
SSH="ssh -F /home/hatch/.ssh/config userpc"
case "${1:-}" in
  pull|pullx)
    winpath="$2"; out="$3"
    parent="${winpath%\\*}"; base="${winpath##*\\}"
    # land in a temp file and verify the tar before it can be mistaken for a result:
    # a stream cut mid-transfer used to leave a truncated tar that looked complete
    tmpf="$(mktemp /tmp/pct-XXXXXX.tar)"
    if ! $SSH "tar -cf - -C \"$parent\" \"$base\"" > "$tmpf"; then rm -f "$tmpf"; echo "pull failed: ssh/tar error" >&2; exit 1; fi
    if ! tar -tf "$tmpf" >/dev/null 2>&1; then rm -f "$tmpf"; echo "pull failed: truncated tar" >&2; exit 1; fi
    if [ "$1" = pull ]; then
      mv "$tmpf" "$out"
      echo "pulled -> $out ($(stat -c%s "$out") bytes)"
    else
      mkdir -p "$out"
      tar -xf "$tmpf" -C "$out"
      rm -f "$tmpf"
      echo "pulled+extracted -> $out"
    fi
    ;;
  push)
    localdir="$2"; windest="$3"
    parent="$(dirname "$localdir")"; base="$(basename "$localdir")"
    tar -cf - -C "$parent" "$base" | $SSH "tar -xf - -C \"$windest\""
    echo "pushed $localdir -> $windest"
    ;;
  *) echo "usage: pc-transfer.sh pull|pullx <winpath> <local-out> | push <localdir> <windest>" >&2; exit 2 ;;
esac
