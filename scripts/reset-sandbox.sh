#!/usr/bin/env bash
set -euo pipefail

RUN_ROOT="$HOME/runs/pi-ghosty"
TPL="$RUN_ROOT/sandbox-template"
SANDBOX="$RUN_ROOT/sandboxes/main"

if [[ ! -d "$TPL" ]]; then
  echo "Template not found: $TPL" >&2
  exit 1
fi

echo "Resetting sandbox: $SANDBOX"

# Destructive by design: blow away and recreate.
rm -rf "$SANDBOX"
mkdir -p "$(dirname "$SANDBOX")"
cp -a "$TPL" "$SANDBOX"

# Initialize the nested git repo fresh on every reset.
pushd "$SANDBOX/playground-repo" >/dev/null
rm -rf .git
git init -q
git add .
git commit -q -m "init"

# Create a second commit with a small change.
echo "$(date -Is)" >> hello.txt
git add hello.txt
git commit -q -m "add timestamp"

popd >/dev/null

echo "Done. Sandbox ready at: $SANDBOX"
