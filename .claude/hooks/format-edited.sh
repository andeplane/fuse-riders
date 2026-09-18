#!/bin/sh
# PostToolUse hook: format the file Claude just edited with the repo's Prettier.
# Silent no-op when Prettier is not installed or the file is ignored/unsupported.
file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] && [ -f "$file" ] || exit 0
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
[ -x node_modules/.bin/prettier ] || exit 0
node_modules/.bin/prettier --write --ignore-unknown --log-level warn "$file" >/dev/null 2>&1 || true
exit 0
