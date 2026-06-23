#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export CI=true

if [ -d "$REPO_ROOT/node_modules/.bin" ]; then
  export PATH="$REPO_ROOT/node_modules/.bin:$PATH"
fi

if [ -d "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin" ]; then
  export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
fi

if [ -d "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin" ]; then
  export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm could not be found in PATH after probing local runtime locations." >&2
  exit 1
fi

cd "$REPO_ROOT"
exec pnpm -r typecheck "$@"
