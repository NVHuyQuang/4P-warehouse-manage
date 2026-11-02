#!/usr/bin/env bash
set -euo pipefail

# scripts/db-reset.sh — Local Supabase database reset
# Runs migrations from supabase/migrations against the local Postgres instance.

echo "==> Running Supabase DB reset..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

if command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD="supabase"
else
  SUPABASE_CMD="npx supabase"
fi

$SUPABASE_CMD db reset "$@"

echo "==> Supabase DB reset completed successfully."
