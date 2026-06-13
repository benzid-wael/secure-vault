#!/usr/bin/env bash
#
# Create and push an annotated release tag.
#
# Pushing the tag triggers the release workflow (.github/workflows/release.yml),
# which aligns the package version to the tag, builds, packages, and publishes
# to npm. The npm dist-tag is chosen by the tag name:
#   vX.Y.Z          -> published under `latest`
#   vX.Y.Z-rc.N etc -> published under `next` (prerelease; never the default
#                      `npm install` version)
# To later promote a `next` prerelease to `latest`, use scripts/npm-dist-tag.sh.
#
# Usage:
#   scripts/release-tag.sh                # tag v<version from package.json>
#   scripts/release-tag.sh 0.1.1-rc.2     # tag v0.1.1-rc.2 (leading v optional)
#   scripts/release-tag.sh -n 0.1.1-rc.2  # dry run — print, don't tag/push
#   scripts/release-tag.sh -y 0.1.1       # skip the confirmation prompt
#
# Flags: -n/--dry-run, -y/--yes, -h/--help
# Env:   RELEASE_REMOTE (default: origin)

set -euo pipefail

REMOTE="${RELEASE_REMOTE:-origin}"
DRY_RUN=0
ASSUME_YES=0
VERSION=""

usage() {
  sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -n | --dry-run) DRY_RUN=1 ;;
    -y | --yes) ASSUME_YES=1 ;;
    -h | --help) usage 0 ;;
    -*)
      echo "✖ Unknown flag: $1" >&2
      usage 1
      ;;
    *)
      if [ -n "$VERSION" ]; then
        echo "✖ Unexpected extra argument: $1" >&2
        usage 1
      fi
      VERSION="$1"
      ;;
  esac
  shift
done

# Resolve the version: positional arg wins, else fall back to package.json.
if [ -z "$VERSION" ]; then
  VERSION="$(node -p "require('./package.json').version")"
fi
VERSION="${VERSION#v}" # strip an optional leading v
TAG="v${VERSION}"

# Validate semver (X.Y.Z with optional -prerelease and +build metadata).
semver_re='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
if ! printf '%s' "$VERSION" | grep -Eq "$semver_re"; then
  echo "✖ '$VERSION' is not a valid semver version (expected e.g. 0.1.1 or 0.1.1-rc.2)." >&2
  exit 1
fi

# Refuse to tag a dirty tree — the tag should point at a known, committed state.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✖ Working tree has uncommitted changes — commit or stash before tagging." >&2
  exit 1
fi

# The tag must not already exist locally or on the remote.
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "✖ Tag $TAG already exists locally. Delete it first: git tag -d $TAG" >&2
  exit 1
fi
if git ls-remote --exit-code --tags "$REMOTE" "$TAG" >/dev/null 2>&1; then
  echo "✖ Tag $TAG already exists on $REMOTE." >&2
  exit 1
fi

# Report which npm dist-tag the release workflow will use for this tag.
case "$VERSION" in
  *-*) CHANNEL="next (prerelease)" ;;
  *) CHANNEL="latest" ;;
esac

echo "Release tag plan:"
echo "  tag:                    $TAG"
echo "  remote:                 $REMOTE"
echo "  commit:                 $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "  npm dist-tag on publish: $CHANNEL"
echo

TAG_CMD=(git tag -a "$TAG" -m "Release version $TAG")
PUSH_CMD=(git push "$REMOTE" "$TAG")

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] ${TAG_CMD[*]}"
  echo "[dry-run] ${PUSH_CMD[*]}"
  exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    echo "✖ Refusing to tag non-interactively without -y/--yes." >&2
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

"${TAG_CMD[@]}"
"${PUSH_CMD[@]}"
echo "✔ Pushed $TAG to $REMOTE — the release workflow will build and publish (dist-tag: $CHANNEL)."
