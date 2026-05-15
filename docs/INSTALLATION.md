# LT IDP — Installation guide (from zero to running)

This document walks through a **new machine** setup for **Ubuntu Linux** and **Windows**, from installing prerequisites until the application is running. The canonical repository URL is:

**https://github.com/haryowl/LT-IDP**

For a quick overview of scripts and architecture, see the [README](../README.md) in the repository root.

---

## What you are installing

| Mode | Use case | Typical command after install |
|------|------------|--------------------------------|
| **Web (browser)** | Server or desktop Linux; remote access over HTTP | `npm run dev:web` (dev) or `npm run build:web` + `npm run start:web` (production) |
| **Desktop (Electron)** | Windows or Linux workstation with a GUI | `npm run dev` (dev) or `npm run build` + `npm run build:app` (installer) |

**Supported Node.js:** **18, 20, or 22 (LTS).** Do **not** use Node **24+** (native modules such as `better-sqlite3` may not build). The repo includes [`.nvmrc`](../.nvmrc) with `22`.

**Default login (change immediately):** username **`admin`**, password **`admin`** (created on first database initialization).

---

## Part A — Ubuntu Linux (step by step)

### A.0 — One-line clone (GitHub)

Open a terminal. This single command downloads the project and enters the folder:

```bash
git clone https://github.com/haryowl/LT-IDP.git && cd LT-IDP
```

If `git` is not installed, run **A.1** first, then run the line above again.

---

### A.1 — Install base packages (Git, compilers, Python)

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 python3-setuptools liblzma-dev
```

- **build-essential** — required to compile native Node addons (`better-sqlite3`, `serialport`, etc.).
- **python3-setuptools** — helps `node-gyp` on **Ubuntu 24.04+** (Python 3.12 removed `distutils`).
- **liblzma-dev** — may be required when native modules pull in `lzma-native`.

---

### A.2 — Install Node.js 22 LTS (recommended: nvm)

Install **nvm** (Node Version Manager):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

Close the terminal, open a new one, then:

```bash
cd ~/LT-IDP   # or the path where you cloned the repo
nvm install
nvm use
node -v       # should show v22.x (or another LTS from .nvmrc)
```

**Alternative:** install Node 20 or 22 from [NodeSource](https://github.com/nodesource/distributions) or the [Node.js downloads](https://nodejs.org/) page, then ensure `node -v` is **18–22**.

---

### A.3 — Install project dependencies

From the repository root (`LT-IDP`):

```bash
npm install
```

If `npm install` fails on native modules:

1. Confirm Node is **not** 24+: `node -v`
2. Reinstall cleanly:

```bash
rm -rf node_modules package-lock.json
npm install
```

On **ARM64** (e.g. Raspberry Pi), use the same build packages and Node 20 or 22 LTS.

---

### A.4 — Run in development (web — browser)

Best for a **headless server** or when you only need a browser:

```bash
npm run dev:web
```

Then:

1. Open a browser: **http://localhost:3000**
2. API/WebSocket are proxied to **http://localhost:3001** by Vite during development.

Stop with **Ctrl+C** in the terminal.

---

### A.5 — Run in development (Electron — desktop GUI)

Requires a **desktop session** (GNOME, KDE, etc.):

```bash
npm run dev
```

- Vite: **http://localhost:3000**
- Electron opens a window and loads the dev URL.

Stop with **Ctrl+C**.

---

### A.6 — Production web server (build + run with Node)

Build the static UI and the compiled server:

```bash
npm run build:web
```

Run the server (serves the built app and API):

```bash
npm run start:web
```

- Default **PORT:** `3001` (set `PORT=3001` or change in environment).
- Default **data directory:** `./data` under the current working directory (set **`DATA_DIR`** to an absolute path for persistent data).

Example with explicit data directory:

```bash
export DATA_DIR="$HOME/lt-idp-data"
export PORT=3001
mkdir -p "$DATA_DIR"
npm run start:web
```

Open **http://\<server-ip\>:3001** in a browser (same port serves UI + API in production).

---

### A.7 — Optional: run under PM2 (Linux production)

1. Install PM2 globally:

   ```bash
   sudo npm install -g pm2
   ```

2. Copy the example config and edit `PORT` / `DATA_DIR` if needed:

   ```bash
   cp ecosystem.config.cjs.example ecosystem.config.cjs
   ```

3. Build (if you have not already):

   ```bash
   npm run build:web
   ```

4. Start:

   ```bash
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup   # follow the printed instructions so PM2 restarts on boot
   ```

The example config runs **`dist-server/server/index.js`** from the project root. Ensure **`cwd`** in `ecosystem.config.cjs` points at the directory that contains **`dist/`**, **`dist-server/`**, and **`node_modules/`**.

---

### A.8 — Firewall (if you access the server from another PC)

Allow the HTTP port (default **3001**):

```bash
sudo ufw allow 3001/tcp
sudo ufw reload
```

Adjust the port if you changed `PORT`.

---

## Part B — Windows (step by step)

### B.1 — Install Git for Windows (to clone from GitHub)

1. Download **Git for Windows**: https://git-scm.com/download/win  
2. Run the installer; keep defaults unless your organization requires changes.  
3. Open **Git Bash** or **PowerShell** after installation.

---

### B.2 — Install Node.js 22 LTS

1. Download the **LTS** Windows installer (**.msi**) for Node **22.x**: https://nodejs.org/  
2. Run the installer. Enable the option **“Automatically install necessary tools”** if offered (installs build tools for native modules).  
3. Open a **new** PowerShell or Command Prompt and verify:

   ```powershell
   node -v
   npm -v
   ```

   `node -v` should show **v22.x** (or v20 / v18). Avoid **v24+**.

**Optional:** use [nvm-windows](https://github.com/coreybutler/nvm-windows) to install and switch Node versions.

---

### B.3 — One-line clone (GitHub)

In **PowerShell** or **Git Bash**, choose a parent folder (example: your user profile), then:

```powershell
cd $HOME
git clone https://github.com/haryowl/LT-IDP.git
cd LT-IDP
```

---

### B.4 — Visual Studio Build Tools (if `npm install` fails on native modules)

If `npm install` errors mention **node-gyp**, **MSBuild**, or **better-sqlite3**:

1. Install **Visual Studio Build Tools**: https://visualstudio.microsoft.com/visual-cpp-build-tools/  
2. In the installer, select **“Desktop development with C++”** (or at least MSVC and Windows SDK).  
3. Open a **new** terminal and run:

   ```powershell
   cd $HOME\LT-IDP
   npm install
   ```

---

### B.5 — Install project dependencies

```powershell
cd $HOME\LT-IDP
npm install
```

---

### B.6 — Run in development (web — browser)

```powershell
npm run dev:web
```

Open **http://localhost:3000** in Chrome or Edge.

Stop with **Ctrl+C**.

---

### B.7 — Run in development (Electron — desktop)

```powershell
npm run dev
```

Electron opens the app window. Stop with **Ctrl+C**.

---

### B.8 — Production build (optional)

**Web-only production (browser, no installer)** — run **in this order**:

```powershell
npm run build:web
npm run start:web
```

`npm run start:web` alone will fail with **Cannot find module … dist-server\server\index.js** until you run **`build:web`** at least once. The project prints a reminder if you skip that step.

Open **http://localhost:3001** (or your `PORT`) after `start:web`.

**Full desktop build (Windows installer):**

```powershell
npm install
npm run build:app
```

`build:app` automatically runs `npm run build` first (Vite + Electron TypeScript). Output is under **`release/`** (NSIS installer).

If **`build:app`** fails while rebuilding **`better-sqlite3`**:

1. **Use the project’s pinned Electron** — pull the latest `main` branch (Electron **29.x** is pinned so prebuilt `better-sqlite3` binaries are used). Then:

   ```powershell
   Remove-Item -Recurse -Force node_modules
   npm install
   npm run build:app
   ```

2. If it still compiles from source and errors on **Python**, install **Python 3.12** from https://www.python.org/downloads/windows/ — check **“Add python.exe to PATH”** — then:

   ```powershell
   npm config set python "C:\Users\YOUR_USER\AppData\Local\Programs\Python\Python312\python.exe"
   npm install
   npm run build:app
   ```

3. If **node-gyp** mentions **MSBuild** or **Visual Studio**, install **Build Tools for Visual Studio** with **“Desktop development with C++”**: https://visualstudio.microsoft.com/visual-cpp-build-tools/

4. `build:app` runs **`npm run rebuild:electron`** before packaging (native modules for Electron, not for Node).

**You do not need `build:app` for web mode** — only `npm install`, `build:web`, and `start:web`.

**If `start:web` fails with NODE_MODULE_VERSION 121 vs 127** — `better-sqlite3` was built for **Electron** but you are running **Node** (web server). Fix:

```powershell
npm run rebuild:native
npm run start:web
```

After building a desktop installer on the same PC, run **`npm run rebuild:native`** again before **`start:web`**.

Set **`DATA_DIR`** to a folder where SQLite and exports should live, for example:

```powershell
$env:DATA_DIR = "C:\ProgramData\LT-IDP\data"
$env:PORT = "3001"
New-Item -ItemType Directory -Force -Path $env:DATA_DIR
npm run start:web
```

---

## Part C — After installation (all platforms)

1. **Log in** with **`admin` / `admin`** (first run).  
2. Open **Settings** (as admin) and **change the admin password** and create other users as needed.  
3. Configure **Modbus**, **MQTT**, **mappings**, and **publishers** from the UI.  
4. For **disk space** and **historical data retention**, use **Historical Data → Storage and cleanup** (see README and in-app help text).

---

## Quick reference — clone URL and main commands

| Item | Value |
|------|--------|
| **Repository (HTTPS)** | `https://github.com/haryowl/LT-IDP.git` |
| **Clone + enter folder** | `git clone https://github.com/haryowl/LT-IDP.git && cd LT-IDP` |
| **Install deps** | `npm install` |
| **Dev (web)** | `npm run dev:web` → http://localhost:3000 |
| **Dev (desktop)** | `npm run dev` |
| **Prod web build** | `npm run build:web` then `npm run start:web` |
| **Prod desktop build** | `npm run build` then `npm run build:app` |

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Node version errors | Use Node **18–22** (see `.nvmrc` and `engines` in `package.json`). |
| `better-sqlite3` / `node-gyp` fails (Linux) | `sudo apt install -y build-essential python3 python3-setuptools liblzma-dev`, then `rm -rf node_modules && npm install`. |
| `better-sqlite3` fails (Windows) | Pull latest repo (Electron 29 pin), `npm install`, then `npm run build:app`. If still failing: Python 3 on PATH + **Visual Studio Build Tools** (C++), then `npx electron-builder install-app-deps`. |
| `prebuild-install` **404** for `electron-v119` | Old lockfile used Electron **28**; delete `node_modules`, `npm install` again on current `main`. |
| `Cannot find module dist-server\server\index.js` | Run **`npm run build:web`** before **`npm run start:web`**. |
| `NODE_MODULE_VERSION 121` vs **127** (or similar) on `start:web` | Run **`npm run rebuild:native`**, then **`npm run start:web`**. Caused by Electron-native rebuild; web mode needs Node-native `better-sqlite3`. |
| Cannot open port 3001 | Another app may use the port; set `PORT` to another value and restart. |
| PM2 cannot find `dist-server` | Run `npm run build:web` from the repo root; check `cwd` in `ecosystem.config.cjs`. |

For more detail on native modules and Ubuntu versions, see the **Prerequisites** and **Linux** sections in the [README](../README.md).
