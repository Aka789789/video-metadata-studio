#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
One-command release script.

Usage:
  bash scripts/release-all.sh [patch|minor|major] [--yes]

Examples:
  bash scripts/release-all.sh patch
  bash scripts/release-all.sh minor --yes

What it does:
  1) Ensure git working tree is clean
  2) Pull latest main
  3) Bump version (no git tag from npm)
  4) Commit package.json + package-lock.json
  5) Create git tag vX.Y.Z
  6) Push main and tag
  7) Create GitHub Release automatically
EOF
}

RELEASE_TYPE="patch"
ASSUME_YES="false"

for arg in "$@"; do
  case "$arg" in
    patch|minor|major)
      RELEASE_TYPE="$arg"
      ;;
    --yes|-y)
      ASSUME_YES="true"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      usage
      exit 1
      ;;
  esac
done

if ! command -v git >/dev/null 2>&1; then
  echo "git is required."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required."
  exit 1
fi

if [ ! -f "package.json" ]; then
  echo "package.json not found. Please run in project root."
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Please switch to main branch first. Current: $CURRENT_BRANCH"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit/stash changes first."
  git status --short
  exit 1
fi

if [ "$ASSUME_YES" != "true" ]; then
  echo "Release type: $RELEASE_TYPE"
  read -r -p "Continue release now? [y/N] " answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

echo "Pulling latest main..."
git pull --rebase origin main

echo "Bumping version..."
npm version "$RELEASE_TYPE" --no-git-tag-version
NEW_VERSION="$(node -p "require('./package.json').version")"
TAG="v${NEW_VERSION}"

echo "Committing version files..."
git add package.json package-lock.json
git commit -m "chore: release ${TAG}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag ${TAG} already exists locally."
  exit 1
fi

echo "Creating tag ${TAG}..."
git tag -a "$TAG" -m "release ${TAG}"

echo "Pushing main..."
git push origin main

echo "Pushing tag ${TAG}..."
git push origin "$TAG"

ORIGIN_URL="$(git remote get-url origin)"
REPO_SLUG="$(
  printf '%s' "$ORIGIN_URL" \
    | sed -E 's#^git@github.com:##; s#^https://github.com/##; s#\.git$##'
)"

if [[ ! "$REPO_SLUG" =~ ^[^/]+/[^/]+$ ]]; then
  echo "Cannot parse owner/repo from origin: $ORIGIN_URL"
  exit 1
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "Creating GitHub release ${TAG} with gh..."
  if gh release view "$TAG" >/dev/null 2>&1; then
    echo "Release ${TAG} already exists. Skipping create."
  else
    gh release create "$TAG" \
      --title "$TAG" \
      --notes "Automated release ${TAG}"
    echo "Release created successfully."
  fi
else
  TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  if [ -z "$TOKEN" ]; then
    echo "No gh auth and no GH_TOKEN/GITHUB_TOKEN found."
    echo "To make release fully automatic, set one of these env vars with a GitHub token."
    echo "Required scopes for PAT: repo"
    exit 1
  fi

  API_BASE="https://api.github.com/repos/${REPO_SLUG}"
  CHECK_URL="${API_BASE}/releases/tags/${TAG}"
  CREATE_URL="${API_BASE}/releases"

  echo "Creating GitHub release ${TAG} via API..."
  STATUS_CODE="$(curl -sS -o /tmp/release_check.json -w "%{http_code}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "$CHECK_URL")"

  if [ "$STATUS_CODE" = "200" ]; then
    echo "Release ${TAG} already exists. Skipping create."
  else
    PAYLOAD="$(node -e "console.log(JSON.stringify({tag_name: process.argv[1], name: process.argv[1], body: 'Automated release ' + process.argv[1], draft: false, prerelease: false}))" "$TAG")"
    CREATE_CODE="$(curl -sS -o /tmp/release_create.json -w "%{http_code}" \
      -X POST \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      "$CREATE_URL" \
      -d "$PAYLOAD")"
    if [ "$CREATE_CODE" != "201" ]; then
      echo "Failed to create release. HTTP ${CREATE_CODE}"
      cat /tmp/release_create.json
      exit 1
    fi
    echo "Release created successfully."
  fi
fi

echo "Done. Version ${NEW_VERSION} released."
