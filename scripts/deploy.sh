#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Deployment-Script für beavertracer.eu
#
# Dieses Script ist auf die Serverumgebung von beavertracer.eu zugeschnitten
# und nicht als generisches Deploy-Script gedacht.
#
# Voraussetzungen auf dem Server:
#   - Node.js, npm, git installiert
#   - nginx als Webserver
#   - GITLAB_DEPLOY_TOKEN als Umgebungsvariable gesetzt
#     (Deploy Token mit Scope "read_package_registry",
#      erstellen unter: GitLab → Settings → Repository → Deploy tokens)
#
# Wird per Cron alle 5 Minuten ausgeführt.
# =============================================================================
set -euo pipefail

REPO_URL="https://gitlab.lgsit.de/klec/networksim.git"
WORKDIR="/root/networksim"
WEBROOT="/var/www/networksim"

# GitLab Package Registry für Tauri-Releases
GITLAB_PROJECT_ID="546"
GITLAB_API="https://gitlab.lgsit.de/api/v4"
PKG_BASE="${GITLAB_API}/projects/${GITLAB_PROJECT_ID}/packages/generic/beavertracer"

# Datei, in der wir merken, was zuletzt deployt wurde
DEPLOY_STATE_FILE="${WORKDIR}/.last_deploy_state"

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

# 1. Clone if missing
FIRST_CLONE=false
if [ ! -d "$WORKDIR/.git" ]; then
  echo "Cloning repository..."
  git clone "$REPO_URL" "$WORKDIR"
  FIRST_CLONE=true
fi

cd "$WORKDIR"

# 2. Detect default branch (origin/HEAD -> origin/<branch>)
DEFAULT_BRANCH="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
if [ -z "${DEFAULT_BRANCH}" ]; then
  if git show-ref --verify --quiet refs/remotes/origin/main; then
    DEFAULT_BRANCH="main"
  else
    DEFAULT_BRANCH="master"
  fi
fi

REMOTE_REF="origin/${DEFAULT_BRANCH}"
echo "Using branch: ${DEFAULT_BRANCH}"

# 3. Fetch and compare (inkl. tags!)
echo "Fetching updates (including tags)..."
git fetch --prune --tags origin

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "${REMOTE_REF}")"

# Tags, die auf dem REMOTE_HEAD liegen (sortiert, 1 pro Zeile)
REMOTE_HEAD_TAGS="$(git tag --points-at "${REMOTE_HEAD}" | LC_ALL=C sort | tr '\n' ' ' | sed 's/[[:space:]]*$//')"

# Letzten Deploy-State laden (falls vorhanden)
LAST_DEPLOY_HEAD=""
LAST_DEPLOY_TAGS=""
if [[ -f "$DEPLOY_STATE_FILE" ]]; then
  LAST_DEPLOY_HEAD="$(grep -E '^HEAD=' "$DEPLOY_STATE_FILE" | head -n1 | cut -d= -f2- || true)"
  LAST_DEPLOY_TAGS="$(grep -E '^TAGS=' "$DEPLOY_STATE_FILE" | head -n1 | cut -d= -f2- || true)"
fi

# Entscheiden ob deployt wird:
# - --force => immer
# - first clone => immer
# - sonst: deploy wenn (Commit neu) ODER (Tags auf remote-head geändert ggü. letztem Deploy)
DEPLOY=false

if $FORCE; then
  echo "--force specified: deploying regardless of git changes."
  DEPLOY=true
elif $FIRST_CLONE; then
  echo "First clone detected: deploying."
  DEPLOY=true
else
  if [[ "${LOCAL_HEAD}" != "${REMOTE_HEAD}" ]]; then
    echo "New commit version detected:"
    echo "  local : ${LOCAL_HEAD}"
    echo "  remote: ${REMOTE_HEAD}"
    DEPLOY=true
  else
    if [[ "${REMOTE_HEAD_TAGS}" != "${LAST_DEPLOY_TAGS}" ]]; then
      echo "HEAD commit unchanged, but tags on HEAD changed since last deploy:"
      echo "  last tags  : ${LAST_DEPLOY_TAGS}"
      echo "  remote tags: ${REMOTE_HEAD_TAGS}"
      DEPLOY=true
    else
      echo "No new version and no tag change on current HEAD. Skipping deployment."
      exit 0
    fi
  fi
fi

# 4. Update repository
echo "Updating repository..."
git pull --ff-only origin "${DEFAULT_BRANCH}"

# 5. Install deps & build
echo "Installing dependencies..."
npm ci

echo "Building..."
npm run build

# 6. Deploy dist to nginx root
# releases/ wird ausgespart — dort liegen die Tauri-Downloads dauerhaft
echo "Deploying to $WEBROOT..."
mkdir -p "$WEBROOT"
find "$WEBROOT" -mindepth 1 -maxdepth 1 ! -name 'releases' -exec rm -rf {} +
cp -r dist/* "$WEBROOT/"

# 7. Aktuellen Stand für Deploy-State und Artifact-Download merken
DEPLOYED_HEAD="$(git rev-parse HEAD)"
DEPLOYED_TAGS="$(git tag --points-at "${DEPLOYED_HEAD}" | LC_ALL=C sort | tr '\n' ' ' | sed 's/[[:space:]]*$//')"

# 8. Fix permissions
chown -R www-data:www-data "$WEBROOT"
find "$WEBROOT" -type d -exec chmod 755 {} \;
find "$WEBROOT" -type f -exec chmod 644 {} \;

# 9. Reload nginx
nginx -t
systemctl reload nginx

# 10. Deploy-State speichern
cat > "$DEPLOY_STATE_FILE" <<EOF
HEAD=${DEPLOYED_HEAD}
TAGS=${DEPLOYED_TAGS}
EOF

echo "Deployment complete."

# 11. Tauri-Releases herunterladen (läuft bei jedem Cron-Lauf, damit nachgeladene
#     CI-Artifacts auch ankommen wenn der Build beim ersten Versuch noch nicht fertig war)
ALL_TAGS="$(git tag | grep -E '^v[0-9]' | LC_ALL=C sort -V)"
LATEST_TAG="$(echo "$ALL_TAGS" | tail -n1)"
VERSION="${LATEST_TAG#v}"

if [[ -n "$VERSION" ]]; then
  RELEASES_DIR="${WEBROOT}/releases"
  mkdir -p "$RELEASES_DIR"

  for filename in \
    "beavertracer_${VERSION}_amd64.AppImage" \
    "beavertracer_${VERSION}_amd64.deb" \
    "beavertracer_${VERSION}_x64-setup.exe" \
    "beavertracer_${VERSION}_x64_en-US.msi"; do

    dest="${RELEASES_DIR}/${filename}"
    if [[ ! -f "$dest" ]]; then
      url="${PKG_BASE}/${VERSION}/${filename}"
      echo "Downloading ${filename} ..."
      curl --silent --fail \
           --header "DEPLOY-TOKEN: ${GITLAB_DEPLOY_TOKEN}" \
           --output "$dest" \
           "$url" || echo "  (not available yet: ${filename})"
    fi
  done

  chown -R www-data:www-data "$RELEASES_DIR"
  find "$RELEASES_DIR" -type f -exec chmod 644 {} +
fi
