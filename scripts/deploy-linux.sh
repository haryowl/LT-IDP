#!/bin/bash
# LT-IDP Linux deployment script (Ubuntu/Debian)
# Deploys the web application on a fresh Linux server.
# Usage: curl -sSL <url> | bash   OR   ./deploy-linux.sh

set -e

INSTALL_DIR="${INSTALL_DIR:-/opt/lt-idp}"
DATA_DIR="${DATA_DIR:-$HOME/lt-idp-data}"
PORT="${PORT:-3001}"
REPO_URL="https://github.com/haryowl/LT-IDP.git"

echo "=== LT-IDP Deployment ==="
echo "  Install dir: $INSTALL_DIR"
echo "  Data dir:    $DATA_DIR"
echo "  Port:        $PORT"
echo ""

# --- 1. Prerequisites ---
echo "[1/7] Installing prerequisites..."
sudo apt-get update -qq
sudo apt-get install -y -qq git build-essential python3 make g++ pkg-config curl

# Node.js 20 LTS
if ! command -v node &>/dev/null || [[ $(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v') -lt 18 ]]; then
  echo "  Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
echo "  Node $(node -v), npm $(npm -v)"

# Mosquitto (for MQTT broker - snap works if apt conflicts)
if ! command -v mosquitto &>/dev/null; then
  echo "  Installing Mosquitto..."
  if command -v snap &>/dev/null; then
    sudo snap install mosquitto
  else
    sudo apt-get install -y -qq mosquitto mosquitto-clients
  fi
else
  echo "  Mosquitto already installed"
fi

# PM2 (process manager)
if ! command -v pm2 &>/dev/null; then
  echo "  Installing PM2..."
  sudo npm install -g pm2
fi

# --- 2. Clone or update ---
echo ""
echo "[2/7] Cloning repository..."
if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  git fetch origin
  git reset --hard origin/main
  git pull origin main || true
else
  sudo mkdir -p "$(dirname "$INSTALL_DIR")"
  sudo git clone "$REPO_URL" "$INSTALL_DIR"
  sudo chown -R "$USER:$USER" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# --- 3. Install dependencies ---
echo ""
echo "[3/7] Installing npm dependencies..."
npm install

# --- 4. Build ---
echo ""
echo "[4/7] Building application..."
npm run build:web

# --- 5. Data directory ---
echo ""
echo "[5/7] Setting up data directory..."
if [ ! -d "$DATA_DIR" ]; then
  if mkdir -p "$DATA_DIR" 2>/dev/null; then
    chmod 755 "$DATA_DIR"
  else
    sudo mkdir -p "$DATA_DIR"
    sudo chown "$USER:$USER" "$DATA_DIR"
  fi
fi

# --- 6. PM2 ecosystem ---
echo ""
echo "[6/7] Configuring PM2..."
cat > ecosystem.config.cjs << EOF
/** @type {import('pm2').StartOptions} */
module.exports = {
  apps: [{
    name: 'lt-idp',
    script: 'dist-server/server/index.js',
    cwd: '$INSTALL_DIR',
    env: {
      PORT: $PORT,
      DATA_DIR: '$DATA_DIR',
      NODE_ENV: 'production',
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
  }],
};
EOF

# --- 7. Start with PM2 ---
echo ""
echo "[7/7] Starting LT-IDP..."
cd "$INSTALL_DIR"
pm2 delete lt-idp 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
sudo env PATH=\$PATH:\"/usr/local/bin\" pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || echo "  (run 'pm2 startup' manually if needed)"

echo ""
echo "=== Deployment complete ==="
echo ""
echo "  Application URL: http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"
echo "  Data directory:  $DATA_DIR"
echo ""
echo "  Useful commands:"
echo "    pm2 status        - Check status"
echo "    pm2 logs lt-idp   - View logs"
echo "    pm2 restart lt-idp - Restart app"
echo ""
