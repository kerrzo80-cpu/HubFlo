#!/usr/bin/env bash
# Start the HubFlo/NeXa web app dev server on the pinned Node version.
# Uses the default local store (JSON files under apps/web/.hubflo-runtime)
# and demo workspace seed data, so no external services are required.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NODE_VERSION="$(tr -d '[:space:]' < .node-version)"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use "$NODE_VERSION" >/dev/null

export NEXA_WORKSPACE_MODE="${NEXA_WORKSPACE_MODE:-demo}"

exec pnpm --filter @hubflo/web dev --hostname 0.0.0.0 --port "${PORT:-3000}"
