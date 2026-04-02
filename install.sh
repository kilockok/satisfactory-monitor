#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────
#  Satisfactory Dedicated Server Monitor
#  One-click install / update script
# ─────────────────────────────────────────────────

REPO="https://github.com/kilockok/satisfactory-monitor.git"
DEFAULT_DIR="/opt/satisfactory-monitor"
SERVICE_NAME="satisfactory-monitor"

# colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── check deps ──

command -v git  >/dev/null || err "git is not installed. Run: apt install git"
command -v node >/dev/null || err "node is not installed. Install Node.js 20+ first."
command -v npm  >/dev/null && PM="npm" || PM=""
command -v pnpm >/dev/null && PM="pnpm"
[ -z "$PM" ] && err "Neither npm nor pnpm found."

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_VER" -lt 20 ] && err "Node.js 20+ required (found v$NODE_VER)"

# ── install dir ──

echo ""
read -rp "$(echo -e "${CYAN}Install directory${NC} [$DEFAULT_DIR]: ")" INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_DIR}"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Existing installation found, pulling updates..."
  cd "$INSTALL_DIR"
  git pull --ff-only
else
  info "Cloning repository..."
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── install deps ──

info "Installing dependencies with $PM..."
$PM install

# ── configure .env ──

if [ ! -f .env ]; then
  echo ""
  echo -e "${YELLOW}── Server Configuration ──${NC}"
  echo ""

  read -rp "$(echo -e "${CYAN}Satisfactory API URL${NC} [https://localhost:7777/api/v1]: ")" API_URL
  API_URL="${API_URL:-https://localhost:7777/api/v1}"

  read -rsp "$(echo -e "${CYAN}Server Admin Password${NC}: ")" PASSWORD
  echo ""

  read -rp "$(echo -e "${CYAN}Monitor Port${NC} [3000]: ")" PORT
  PORT="${PORT:-3000}"

  read -rp "$(echo -e "${CYAN}Poll Interval (ms)${NC} [30000]: ")" POLL
  POLL="${POLL:-30000}"

  cat > .env <<EOF
SATISFACTORY_API=$API_URL
SATISFACTORY_PASSWORD=$PASSWORD
PORT=$PORT
POLL_INTERVAL=$POLL
EOF

  ok ".env created"
else
  ok ".env already exists, skipping configuration"
fi

# ── systemd service ──

echo ""
read -rp "$(echo -e "${CYAN}Install systemd service?${NC} [Y/n]: ")" INSTALL_SERVICE
INSTALL_SERVICE="${INSTALL_SERVICE:-Y}"

if [[ "$INSTALL_SERVICE" =~ ^[Yy] ]]; then
  cat > /tmp/$SERVICE_NAME.service <<EOF
[Unit]
Description=Satisfactory Server Monitor
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) --env-file=.env server.js
Restart=always
RestartSec=5
Environment=NODE_TLS_REJECT_UNAUTHORIZED=0

[Install]
WantedBy=multi-user.target
EOF

  if [ "$(id -u)" -eq 0 ]; then
    mv /tmp/$SERVICE_NAME.service /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable $SERVICE_NAME
    systemctl restart $SERVICE_NAME
    ok "Service installed and started"
  else
    warn "Need root to install service. Run:"
    echo "  sudo mv /tmp/$SERVICE_NAME.service /etc/systemd/system/"
    echo "  sudo systemctl daemon-reload && sudo systemctl enable --now $SERVICE_NAME"
  fi
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Installation complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  Dashboard:  ${CYAN}http://$(hostname -I | awk '{print $1}'):${PORT:-3000}${NC}"
echo -e "  Directory:  $INSTALL_DIR"
echo ""
echo -e "  Commands:"
echo -e "    Start:    ${CYAN}systemctl start $SERVICE_NAME${NC}"
echo -e "    Stop:     ${CYAN}systemctl stop $SERVICE_NAME${NC}"
echo -e "    Logs:     ${CYAN}journalctl -u $SERVICE_NAME -f${NC}"
echo -e "    Update:   ${CYAN}cd $INSTALL_DIR && git pull && $PM install${NC}"
echo ""
