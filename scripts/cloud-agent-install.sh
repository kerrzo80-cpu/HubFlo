#!/usr/bin/env bash
# Idempotent Cloud Agent install: pin the Node version from .node-version,
# activate the repo-pinned pnpm, and install workspace dependencies.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NODE_VERSION="$(tr -d '[:space:]' < .node-version)"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

if ! nvm which "$NODE_VERSION" >/dev/null 2>&1; then
  nvm install "$NODE_VERSION"
fi
nvm alias default "$NODE_VERSION" >/dev/null
nvm use "$NODE_VERSION" >/dev/null

corepack enable
corepack prepare "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" --activate

node --version
pnpm --version

pnpm install --frozen-lockfile
