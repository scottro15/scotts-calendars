#!/usr/bin/env bash
# Bump the cache-busting build tag across index.html and version.json.
# Run before every deploy/push so installed clients see "New update available".
# Usage: scripts/bump-cache-tag.sh 20261026-update
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:?usage: $0 <tag>  (e.g. 20261026-update)}"
if ! [[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "error: tag must be alphanumeric / ._- only" >&2
  exit 1
fi
printf '%s\n' "{\"v\":\"$TAG\"}" > version.json
# Rewrite every ?v=… query on local assets in index.html
perl -i -pe "s/(\\?v=)[\\w.-]+/\${1}$TAG/g" index.html
echo "bumped cache tag → $TAG  (index.html + version.json)"
