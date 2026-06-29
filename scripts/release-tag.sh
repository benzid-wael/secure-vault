#!/usr/bin/env bash
#
# Bump package.json to the release version, commit it, then create and push an
# annotated release tag.
#
# When the requested version differs from package.json, the script bumps
# package.json (and package-lock.json), commits the bump to the current branch,
# and tags that commit — so the repo's version always matches the latest tag.
#
# Pushing the tag triggers the release workflow (.github/workflows/release.yml),
# which (re)aligns the package version to the tag, builds, packages, and
# publishes to npm. The npm dist-tag is chosen by the tag name:
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
  sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'
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

# Current version recorded in package.json. When it differs from the requested
# version we bump + commit it below; capture it to show the old -> new transition.
PKG_VERSION="$(node -p "require('./package.json').version")"

# Resolve the version: positional arg wins, else fall back to package.json.
if [ -z "$VERSION" ]; then
  VERSION="$PKG_VERSION"
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

# Highlight the package.json version transition. Bold the new version when it
# changes; note "(unchanged)" when the tag already matches package.json.
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  BOLD="$(tput bold)"
  YELLOW="$(tput setaf 3)"
  RESET="$(tput sgr0)"
else
  BOLD=""
  YELLOW=""
  RESET=""
fi
if [ "$PKG_VERSION" = "$VERSION" ]; then
  VERSION_LINE="${PKG_VERSION} (unchanged)"
else
  VERSION_LINE="${PKG_VERSION} -> ${BOLD}${YELLOW}${VERSION}${RESET}"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Bump + commit package.json only when the version actually changes. When the
# tag already matches package.json there is nothing to commit, so we tag HEAD.
BUMP_NEEDED=0
if [ "$PKG_VERSION" != "$VERSION" ]; then
  BUMP_NEEDED=1
fi

echo "Release tag plan:"
echo "  package.json version:   $VERSION_LINE"
if [ "$BUMP_NEEDED" -eq 1 ]; then
  echo "  bump commit:            chore(release): $TAG -> $BRANCH"
fi
echo "  tag:                    $TAG"
echo "  remote:                 $REMOTE"
echo "  commit:                 $(git rev-parse --short HEAD) ($BRANCH)"
echo "  npm dist-tag on publish: $CHANNEL"
echo

if [ "$DRY_RUN" -eq 1 ]; then
  if [ "$BUMP_NEEDED" -eq 1 ]; then
    echo "[dry-run] npm version $VERSION --no-git-tag-version --allow-same-version"
    echo "[dry-run] git commit -am \"chore(release): $TAG\""
    echo "[dry-run] git push $REMOTE $BRANCH"
  fi
  echo "[dry-run] git tag -a $TAG -m \"Release version $TAG\""
  echo "[dry-run] git push $REMOTE $TAG"
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

# Bump package.json (+ package-lock.json) and commit the bump to the branch so
# the repo's version tracks the tag. npm version updates both files without
# creating its own commit/tag; we commit and tag them ourselves.
if [ "$BUMP_NEEDED" -eq 1 ]; then
  npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
  git commit -am "chore(release): $TAG"
fi

git tag -a "$TAG" -m "Release version $TAG"

# Push the bump commit before the tag so the tagged commit exists on the branch.
if [ "$BUMP_NEEDED" -eq 1 ]; then
  git push "$REMOTE" "$BRANCH"
fi
git push "$REMOTE" "$TAG"
echo "✔ Pushed $TAG to $REMOTE — the release workflow will build and publish (dist-tag: $CHANNEL)."
