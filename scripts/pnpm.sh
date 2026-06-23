#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/pnpm.sh <pnpm-command> [args]" >&2
  exit 1
fi

export PATH="$PWD/node_modules/.bin:$PATH"
export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm could not be found after probing workspace/runtime locations." >&2
  exit 1
fi

exec pnpm "$@"
