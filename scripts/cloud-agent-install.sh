#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export CI=true

if command -v corepack >/dev/null 2>&1; then
  corepack enable
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm not found after corepack enable." >&2
  exit 1
fi

echo "[cloud-agent-install] pnpm $(pnpm -v)"
echo "[cloud-agent-install] Installing workspace dependencies..."
pnpm install --frozen-lockfile
echo "[cloud-agent-install] Done."
