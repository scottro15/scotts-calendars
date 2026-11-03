#!/bin/sh
# Turn the reopen picture (speed step C, snapview.js) off or back on: scripts/snapview-switch.sh off|on, then bump the cache tag.
# "off": nothing is drawn on a reopen and nothing is saved; saved pictures are wiped on the next open (the app is as in speed-b).
set -e; cd "$(dirname "$0")/.."
case "$1" in off) v=false;; on) v=true;; *) echo "usage: $0 off|on"; exit 1;; esac
sed -i "s/window.__snapViewOn = \(true\|false\);/window.__snapViewOn = $v;/" index.html
grep -q "window.__snapViewOn = $v;" index.html && echo "snapview $1"
