# Install and run LT-IDP on Linux Ubuntu (from GitHub)

Use these steps to deploy the app on an **Ubuntu server** by cloning from GitHub.

You can run LT-IDP as a **web application** (recommended on headless servers) or as an **Electron desktop app** (requires a display or Xvfb).

## 1. Install prerequisites

```bash
sudo apt update
sudo apt install -y git build-essential python3 make g++ pkg-config
```

Install **Node.js 18+** (LTS). Example with NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node -v   # v18.x or v20.x
npm -v
```

## 2. Clone the repository

```bash
cd /opt
sudo git clone https://github.com/haryowl/LT-IDP.git
sudo chown -R $USER:$USER LT-IDP
cd LT-IDP
```

Or clone to your home directory:

```bash
cd ~
git clone https://github.com/haryowl/LT-IDP.git
cd LT-IDP
```

## 3. Install dependencies

```bash
npm install
```

If you get errors about native modules (`better-sqlite3`, `serialport`), ensure build tools are installed (step 1) and try again.

## 4. Build the app

```bash
npm run build
```

## 5. Run the app

### Option A: Web application (recommended on servers)

No display needed. The app runs as a web server; you open it in a browser (on the same machine or from another PC).

**Development:**

```bash
npm run dev:web
```

Then open http://localhost:3000 (or http://YOUR_SERVER_IP:3000) in a browser.

**Production:**

```bash
npm run build:web
npm run start:web
```

- Server listens on port **3001** by default. Set `PORT=80` to use port 80.
- Data directory: set `DATA_DIR=/var/lib/lt-idp` (or any path) if you want data outside the project folder.
- Open http://YOUR_SERVER_IP:3001 in a browser (the server serves the built React app and the API).

### Option B: Electron desktop app

**Development (with Vite dev server):**

```bash
npm run dev
```

**Production (run built app):**

```bash
npm start
```

**Production (packaged .deb or AppImage):**

```bash
npm run build:app
# Then install: sudo dpkg -i release/*.deb
# Or run: chmod +x release/*.AppImage && ./release/*.AppImage
```

If you see "Missing X server or $DISPLAY", use `xvfb-run npm start` (see section 6).

## 6. Run as a service (optional)

To run LT-IDP in the background and auto-start on reboot, create a systemd unit:

```bash
sudo nano /etc/systemd/system/lt-idp.service
```

Paste (adjust `User`, `WorkingDirectory`, and path to `electron`/`node` if needed):

```ini
[Unit]
Description=LT-IDP IoT SCADA Client
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/opt/LT-IDP
Environment=DISPLAY=:0
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable lt-idp
sudo systemctl start lt-idp
sudo systemctl status lt-idp
```

For a **headless server without display**, Electron may need a virtual display (e.g. `xvfb`) or you may need to run the app in a different mode; the steps above assume a desktop or X session.

---

**Repository:** [https://github.com/haryowl/LT-IDP](https://github.com/haryowl/LT-IDP.git)
