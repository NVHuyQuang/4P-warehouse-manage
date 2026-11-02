#!/usr/bin/env bash
set -euo pipefail

if pwd -W >/dev/null 2>&1; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -W)"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
node "${SCRIPT_DIR}/guard-price-leak.js" "$@"
