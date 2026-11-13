#!/usr/bin/env bash
# Vendor the game-dev skills from https://github.com/andeplane/gamevibing into
# .claude/skills/ so Claude Code loads them in every checkout (local, cloud,
# worktrees) with no submodule or install step.
#
#   scripts/sync-gamevibing.sh            # latest main
#   scripts/sync-gamevibing.sh <ref>      # a branch, tag or commit
#
# Each upstream skills/<name>/ replaces .claude/skills/<name>/ wholesale; the
# pinned commit is written to .claude/skills/GAMEVIBING_VERSION. Repo-owned
# skills (e.g. .claude/skills/ship) are never touched. Edit skills upstream,
# not here: the next sync overwrites local changes.
set -euo pipefail

repo_url="https://github.com/andeplane/gamevibing.git"
ref="${1:-main}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/.claude/skills"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git clone --quiet "$repo_url" "$tmp/gamevibing"
git -C "$tmp/gamevibing" checkout --quiet "$ref"
commit="$(git -C "$tmp/gamevibing" rev-parse HEAD)"

# Drop previously vendored skills that upstream has removed.
if [[ -f "$dest/GAMEVIBING_VERSION" ]]; then
  while read -r name; do
    [[ -n "$name" && ! -d "$tmp/gamevibing/skills/$name" ]] && rm -rf "${dest:?}/$name"
  done < <(sed -n 's/^skill: //p' "$dest/GAMEVIBING_VERSION")
fi

mkdir -p "$dest"
names=()
for dir in "$tmp/gamevibing/skills"/*/; do
  name="$(basename "$dir")"
  rm -rf "${dest:?}/$name"
  cp -R "$dir" "$dest/$name"
  names+=("$name")
done

{
  echo "# Vendored by scripts/sync-gamevibing.sh; do not edit by hand."
  echo "source: $repo_url"
  echo "commit: $commit"
  for name in "${names[@]}"; do echo "skill: $name"; done
} >"$dest/GAMEVIBING_VERSION"

echo "Synced ${#names[@]} gamevibing skills at ${commit:0:7} into .claude/skills/"
