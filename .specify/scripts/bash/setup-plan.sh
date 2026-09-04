#!/usr/bin/env bash
# Minimal spec-kit shim: resolves current feature dir and emits JSON for plan/tasks steps.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
FEATURE_JSON="$REPO_ROOT/.specify/feature.json"
SPECS_DIR="$REPO_ROOT/specs"

if [[ ! -f "$FEATURE_JSON" ]]; then
  echo '{"error":"no .specify/feature.json — run /speckit-specify first"}' >&2
  exit 1
fi

FEATURE_DIR=$(python3 -c "import json,sys; print(json.load(open('$FEATURE_JSON'))['feature_directory'])")
FEATURE_SPEC="$FEATURE_DIR/spec.md"
IMPL_PLAN="$FEATURE_DIR/plan.md"
BRANCH=$(git branch --show-current)

if [[ "${1:-}" == "--json" ]]; then
  python3 - "$FEATURE_SPEC" "$IMPL_PLAN" "$SPECS_DIR" "$BRANCH" <<'EOF'
import json, sys
spec, plan, specs_dir, branch = sys.argv[1:5]
print(json.dumps({
  "FEATURE_SPEC": spec,
  "IMPL_PLAN": plan,
  "SPECS_DIR": specs_dir,
  "BRANCH": branch,
}))
EOF
else
  echo "FEATURE_SPEC=$FEATURE_SPEC"
  echo "IMPL_PLAN=$IMPL_PLAN"
  echo "SPECS_DIR=$SPECS_DIR"
  echo "BRANCH=$BRANCH"
fi
