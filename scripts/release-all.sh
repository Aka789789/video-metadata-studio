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
  8) Wait for GitHub Actions to finish and print artifacts
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

TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
API_BASE="https://api.github.com/repos/${REPO_SLUG}"
CHECK_URL="${API_BASE}/releases/tags/${TAG}"
CREATE_URL="${API_BASE}/releases"
RELEASE_HTML_URL=""

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
  RELEASE_HTML_URL="$(gh release view "$TAG" --json url --jq '.url' 2>/dev/null || true)"
else
  if [ -z "$TOKEN" ]; then
    echo "No gh auth and no GH_TOKEN/GITHUB_TOKEN found."
    echo "To make release fully automatic, set one of these env vars with a GitHub token."
    echo "Required scopes for PAT: repo"
    exit 1
  fi

  echo "Creating GitHub release ${TAG} via API..."
  STATUS_CODE="$(curl -sS -o /tmp/release_check.json -w "%{http_code}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "$CHECK_URL")"

  if [ "$STATUS_CODE" = "200" ]; then
    echo "Release ${TAG} already exists. Skipping create."
    RELEASE_HTML_URL="$(node -e "const fs=require('fs');const p='/tmp/release_check.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log(j.html_url||'');")"
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
    RELEASE_HTML_URL="$(node -e "const fs=require('fs');const p='/tmp/release_create.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log(j.html_url||'');")"
  fi
fi

if [ -z "$TOKEN" ]; then
  echo "GH_TOKEN/GITHUB_TOKEN not found, skipping Actions wait and assets listing."
  echo "Release URL: ${RELEASE_HTML_URL:-"(open Releases page manually)"}"
  echo "Done. Version ${NEW_VERSION} released."
  exit 0
fi

echo "Waiting for GitHub Actions workflow to finish..."
TAG_SHA="$(git rev-list -n 1 "$TAG")"
MAX_POLLS=120
SLEEP_SECONDS=15
RUN_URL=""
RUN_STATUS=""
RUN_CONCLUSION=""

for ((i=1; i<=MAX_POLLS; i++)); do
  CODE="$(curl -sS -o /tmp/actions_runs.json -w "%{http_code}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "${API_BASE}/actions/runs?event=release&head_sha=${TAG_SHA}&per_page=20")"
  if [ "$CODE" != "200" ]; then
    echo "Warning: cannot query Actions runs now (HTTP ${CODE}), retrying..."
    sleep "$SLEEP_SECONDS"
    continue
  fi

  LINE="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('/tmp/actions_runs.json','utf8'));const runs=(j.workflow_runs||[]).filter(r=>r.name==='Build And Release');if(!runs.length){console.log('');process.exit(0);}const r=runs[0];console.log([r.html_url||'',r.status||'',r.conclusion||''].join('|'));" || true)"
  if [ -z "$LINE" ]; then
    echo "No workflow run found yet (${i}/${MAX_POLLS}), waiting..."
    sleep "$SLEEP_SECONDS"
    continue
  fi

  RUN_URL="$(printf '%s' "$LINE" | cut -d'|' -f1)"
  RUN_STATUS="$(printf '%s' "$LINE" | cut -d'|' -f2)"
  RUN_CONCLUSION="$(printf '%s' "$LINE" | cut -d'|' -f3)"
  echo "Workflow status: ${RUN_STATUS} (${i}/${MAX_POLLS})"

  if [ "$RUN_STATUS" = "completed" ]; then
    break
  fi
  sleep "$SLEEP_SECONDS"
done

if [ "${RUN_STATUS}" != "completed" ]; then
  echo "Actions did not complete in time."
  echo "Run URL: ${RUN_URL:-"(not available)"}"
  echo "Release URL: ${RELEASE_HTML_URL:-"(not available)"}"
  exit 1
fi

if [ "${RUN_CONCLUSION}" != "success" ]; then
  echo "Actions workflow failed: ${RUN_CONCLUSION}"
  echo "Run URL: ${RUN_URL}"
  echo "Release URL: ${RELEASE_HTML_URL:-"(not available)"}"
  exit 1
fi

curl -sS -o /tmp/release_final.json \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "$CHECK_URL" >/dev/null

echo "Actions succeeded."
echo "Release URL: ${RELEASE_HTML_URL:-$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('/tmp/release_final.json','utf8'));console.log(j.html_url||'');")}"
echo "Artifacts:"
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('/tmp/release_final.json','utf8'));const assets=j.assets||[];if(!assets.length){console.log('- (no assets yet, refresh release page in a moment)');process.exit(0);}for(const a of assets){console.log('- '+a.name+' -> '+a.browser_download_url);}"

if ! node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('/tmp/release_final.json','utf8'));const assets=(j.assets||[]).map(a=>a.name);process.exit(assets.includes('latest-mac.yml')?0:1);" ; then
  echo "ERROR: latest-mac.yml is missing in release assets."
  echo "This version will fail update checks on macOS."
  echo "Please re-run the Build And Release workflow and verify the mac publish step."
  exit 1
fi

echo "Done. Version ${NEW_VERSION} released."
