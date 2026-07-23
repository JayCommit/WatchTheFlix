#!/usr/bin/env bash
# Install WatchTheFlix as a systemd service on Ubuntu.
# Uses the project folder's .env and runs `npm start` from that directory.
#
# Usage:
#   sudo ./deploy/install-ubuntu.sh
#   sudo ./deploy/install-ubuntu.sh --no-build
#   sudo ./deploy/install-ubuntu.sh --uninstall
#
set -euo pipefail

SERVICE_NAME="watchtheflix"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE="${SCRIPT_DIR}/watchtheflix.service.in"

DO_BUILD=1
DO_UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --uninstall) DO_UNINSTALL=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0 $*" >&2
  exit 1
fi

# Prefer the user who invoked sudo (not root) so nvm/node and file ownership match the checkout
SERVICE_USER="${SUDO_USER:-}"
if [[ -z "$SERVICE_USER" || "$SERVICE_USER" == "root" ]]; then
  # Fall back to directory owner
  SERVICE_USER="$(stat -c '%U' "$APP_DIR" 2>/dev/null || echo root)"
fi
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"

run_as_user() {
  # Login shell so nvm / asdf PATH hooks apply when present
  sudo -u "$SERVICE_USER" -H bash -lc "$*"
}

uninstall() {
  echo "==> Stopping and removing ${SERVICE_NAME}"
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "$UNIT_PATH"
  systemctl daemon-reload
  echo "Removed ${SERVICE_NAME}. App files in ${APP_DIR} were left untouched."
}

if [[ "$DO_UNINSTALL" -eq 1 ]]; then
  uninstall
  exit 0
fi

if [[ ! -f "$TEMPLATE" ]]; then
  echo "Missing template: $TEMPLATE" >&2
  exit 1
fi

echo "==> App directory:  $APP_DIR"
echo "==> Service user:   $SERVICE_USER ($SERVICE_GROUP)"

# Resolve node/npm as the service user (supports system Node and nvm)
NODE_BIN="$(run_as_user 'command -v node' || true)"
NPM_BIN="$(run_as_user 'command -v npm' || true)"
if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  echo "Node.js / npm not found for user '${SERVICE_USER}'." >&2
  echo "Install Node 22+ (e.g. https://nodejs.org or nvm), then re-run." >&2
  exit 1
fi

NODE_VER="$(run_as_user "\"$NODE_BIN\" -v")"
echo "==> Node:           $NODE_BIN ($NODE_VER)"
echo "==> npm:            $NPM_BIN"

# PATH for the unit (directory containing node + npm, plus a sane default)
NODE_DIR="$(dirname "$NODE_BIN")"
NPM_DIR="$(dirname "$NPM_BIN")"
SERVICE_PATH="${NODE_DIR}:${NPM_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# .env
if [[ ! -f "${APP_DIR}/.env" ]]; then
  if [[ -f "${APP_DIR}/.env.example" ]]; then
    echo "==> Creating .env from .env.example (edit secrets before relying on this in production)"
    cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
    chown "${SERVICE_USER}:${SERVICE_GROUP}" "${APP_DIR}/.env"
    chmod 600 "${APP_DIR}/.env"
  else
    echo "No .env found in ${APP_DIR}. Copy .env.example → .env and fill it in, then re-run." >&2
    exit 1
  fi
else
  echo "==> Using existing .env"
  chmod 600 "${APP_DIR}/.env" 2>/dev/null || true
fi

# data dir for SQLite
mkdir -p "${APP_DIR}/data"
chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${APP_DIR}/data"

echo "==> npm install"
run_as_user "cd \"${APP_DIR}\" && \"${NPM_BIN}\" install"

if [[ "$DO_BUILD" -eq 1 ]]; then
  echo "==> npm run build"
  run_as_user "cd \"${APP_DIR}\" && \"${NPM_BIN}\" run build"
else
  echo "==> Skipping build (--no-build)"
fi

echo "==> Writing ${UNIT_PATH}"
# Escape sed replacement specials in paths
esc() { printf '%s' "$1" | sed -e 's/[\\/&]/\\&/g'; }

sed \
  -e "s/__SERVICE_USER__/$(esc "$SERVICE_USER")/g" \
  -e "s/__SERVICE_GROUP__/$(esc "$SERVICE_GROUP")/g" \
  -e "s/__APP_DIR__/$(esc "$APP_DIR")/g" \
  -e "s/__NPM_BIN__/$(esc "$NPM_BIN")/g" \
  -e "s/__PATH__/$(esc "$SERVICE_PATH")/g" \
  "$TEMPLATE" >"$UNIT_PATH"

chmod 644 "$UNIT_PATH"

echo "==> Enabling and starting ${SERVICE_NAME}"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

sleep 1
systemctl --no-pager --full status "$SERVICE_NAME" || true

PORT="$(grep -E '^[[:space:]]*PORT=' "${APP_DIR}/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\"' | tr -d "'" || true)"
PORT="${PORT:-8787}"

cat <<EOF

WatchTheFlix is installed as a systemd service.

  Status:   sudo systemctl status ${SERVICE_NAME}
  Logs:     sudo journalctl -u ${SERVICE_NAME} -f
  Restart:  sudo systemctl restart ${SERVICE_NAME}
  Stop:     sudo systemctl stop ${SERVICE_NAME}
  Uninstall: sudo ./deploy/install-ubuntu.sh --uninstall

  App dir:  ${APP_DIR}
  Env file: ${APP_DIR}/.env
  URL:      http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT}
            (or http://127.0.0.1:${PORT})

Edit .env then: sudo systemctl restart ${SERVICE_NAME}
EOF
