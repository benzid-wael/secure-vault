#!/usr/bin/env bash
#
# Move an npm dist-tag (default: `latest`) onto an already-published version.
#
# Typical use: a prerelease was published under `next` (see release-tag.sh);
# once it is verified, promote it so that `npm install <pkg>` resolves to it:
#
#   scripts/npm-dist-tag.sh 0.1.1            # latest -> 0.1.1
#   scripts/npm-dist-tag.sh 0.1.1-rc.2 next  # next   -> 0.1.1-rc.2
#   scripts/npm-dist-tag.sh --list           # show current dist-tags
#   scripts/npm-dist-tag.sh -n 0.1.1         # dry run — print, don't change
#   scripts/npm-dist-tag.sh -y 0.1.1         # skip the confirmation prompt
#
# Requires npm auth (`npm login`, or NPM_TOKEN in the environment) with publish
# rights on the package. Flags: -n/--dry-run, -y/--yes, -l/--list, -h/--help.

set -euo pipefail

PKG="$(node -p "require('./package.json').name")"
DRY_RUN=0
ASSUME_YES=0
LIST_ONLY=0
VERSION=""
DIST_TAG=""

usage() {
  sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -n | --dry-run) DRY_RUN=1 ;;
    -y | --yes) ASSUME_YES=1 ;;
    -l | --list) LIST_ONLY=1 ;;
    -h | --help) usage 0 ;;
    -*)
      echo "✖ Unknown flag: $1" >&2
      usage 1
      ;;
    *)
      if [ -z "$VERSION" ]; then
        VERSION="$1"
      elif [ -z "$DIST_TAG" ]; then
        DIST_TAG="$1"
      else
        echo "✖ Unexpected extra argument: $1" >&2
        usage 1
      fi
      ;;
  esac
  shift
done

if [ "$LIST_ONLY" -eq 1 ]; then
  npm dist-tag ls "$PKG"
  exit 0
fi

if [ -z "$VERSION" ]; then
  echo "✖ Missing <version>." >&2
  usage 1
fi
VERSION="${VERSION#v}"            # strip an optional leading v
DIST_TAG="${DIST_TAG:-latest}"    # default to the `latest` channel

# The version must already be published before a dist-tag can point at it.
if ! npm view "$PKG@$VERSION" version >/dev/null 2>&1; then
  echo "✖ $PKG@$VERSION is not published on the registry — publish it first." >&2
  exit 1
fi

echo "Current dist-tags for $PKG:"
npm dist-tag ls "$PKG" 2>/dev/null || echo "  (none / not readable)"
echo
echo "Plan: set dist-tag '$DIST_TAG' -> $VERSION"
echo

DIST_CMD=(npm dist-tag add "$PKG@$VERSION" "$DIST_TAG")

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] ${DIST_CMD[*]}"
  exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    echo "✖ Refusing to change dist-tags non-interactively without -y/--yes." >&2
    exit 1
  fi
  read -r -p "Proceed? [y/N] " reply
  case "$reply" in
    [yY] | [yY][eE][sS]) ;;
    *)
      echo "Aborted."
      exit 1
      ;;
  esac
fi

"${DIST_CMD[@]}"
echo "✔ dist-tag '$DIST_TAG' now points to $VERSION"
npm dist-tag ls "$PKG"
