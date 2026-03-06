# Install and run LT-IDP on Linux Ubuntu (from GitHub)

Use these steps to deploy the app on an **Ubuntu server** by cloning from GitHub.

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
