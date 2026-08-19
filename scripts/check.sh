#!/usr/bin/env bash
# Run the full local check suite: the same steps as CI, on your machine.
#
#   ./scripts/check.sh          everything
#   ./scripts/check.sh python   Python lint + tests only
#   ./scripts/check.sh js       JavaScript lint + tests only
#
# Requires: a Python 3.12 virtualenv in .venv with requirements-dev.txt
# installed, and Node 22 with `npm install` already run.

set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="${1:-all}"
FAILURES=0

info() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok() { printf '\033[0;32m    ok\033[0m\n'; }
fail() {
    printf '\033[0;31m    FAILED: %s\033[0m\n' "$1"
    FAILURES=$((FAILURES + 1))
}

run() {
    local label="$1"
    shift
    info "$label"
    if "$@"; then
        ok
    else
        fail "$label"
    fi
}

if [ ! -d .venv ]; then
    echo "error: .venv not found. Create it with:"
    echo "  /opt/homebrew/bin/python3.12 -m venv .venv"
    echo "  .venv/bin/pip install -r requirements-dev.txt"
    exit 1
fi

PY=.venv/bin/python

if [ "$TARGET" = "all" ] || [ "$TARGET" = "python" ]; then
    run "ruff (lint)" "$PY" -m ruff check .
    # Formatting is enforced on new code only; see the note in pyproject.toml.
    run "ruff (format check)" "$PY" -m ruff format --check tests scripts
    run "pytest" "$PY" -m pytest --cov=backend --cov-report=term-missing
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "js" ]; then
    if [ ! -d node_modules ]; then
        echo "warning: node_modules not found, skipping JavaScript checks."
        echo "         run 'npm install' to enable them."
    else
        run "eslint" npx --no-install eslint .
        run "prettier (format check)" npx --no-install prettier --check "tests/js/**/*.{js,ts,tsx}" "frontend/src/**/*.{ts,tsx,css}"
        run "typecheck" npx --no-install tsc --noEmit -p frontend/tsconfig.json
        run "vitest" npx --no-install vitest run
        run "vite build" npx --no-install vite build --config frontend/vite.config.ts
    fi
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "python" ]; then
    run "smoke (server starts and serves the editor)" "$PY" scripts/smoke_server.py
fi

echo
if [ "$FAILURES" -eq 0 ]; then
    printf '\033[0;32mAll checks passed.\033[0m\n'
else
    printf '\033[0;31m%s check(s) failed.\033[0m\n' "$FAILURES"
    exit 1
fi
