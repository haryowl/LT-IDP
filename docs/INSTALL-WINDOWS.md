# Install and run LT-IDP on Windows (from GitHub)

Use these steps to install **LT-IDP** on a **Windows** PC or server by cloning from GitHub.

You can run LT-IDP as:

| Mode | Best for | Result |
|------|----------|--------|
| **Desktop (Electron)** | Workstation with a GUI | Windows installer under `release/` (NSIS), or `npm run dev` |
| **Web (browser)** | Always-on PC/server; remote access over HTTP | `npm run build:web` + `npm run start:web` on port **3001** |

**Repository:** [https://github.com/haryowl/LT-IDP](https://github.com/haryowl/LT-IDP.git)

**Supported Node.js:** **18, 20, or 22 (LTS).** Do **not** use Node **24+** (native modules such as `better-sqlite3` may not build). The repo includes [`.nvmrc`](../.nvmrc) with `22`.

**Default login (change immediately):** username **`admin`**, password **`admin`** (created on first database initialization).

---

## Quick start (checklist)

1. Install **Git for Windows** and **Node.js 22 LTS**.
2. Clone the repo and run `npm install`.
3. Choose a mode:
   - **Desktop:** `npm run build:app` → install the NSIS setup from `release\`.
   - **Web:** `npm run build:web` → `npm run start:web` → open http://localhost:3001.
4. Log in as **admin** / **admin**, then change the password in **Settings**.
5. **(Optional)** Auto-start web mode after reboot — see [section 6](#6-run-in-the-background-and-auto-start-on-reboot).

For a scripted web deploy, see [scripts/deploy-windows.ps1](../scripts/deploy-windows.ps1) below.

> **Default behavior:** LT-IDP does **not** run in the background or start after reboot until you install auto-start (Task Scheduler or NSSM).

---

## 1. Install prerequisites

### 1.1 — Git for Windows

1. Download: https://git-scm.com/download/win  
2. Run the installer (defaults are fine for most setups).  
3. Open a **new** **PowerShell** or **Git Bash** window after install.

Verify:

```powershell
git --version
```

### 1.2 — Node.js 22 LTS

1. Download the **LTS** Windows installer (**.msi**) for Node **22.x**: https://nodejs.org/  
2. Run the installer. If offered, enable **“Automatically install necessary tools”** (helps with native modules).  
3. Open a **new** PowerShell window and verify:

```powershell
node -v   # should show v22.x (or v20 / v18) — avoid v24+
npm -v
```

**Optional:** use [nvm-windows](https://github.com/coreybutler/nvm-windows) / **nvm4w** to install and switch Node versions. Prefer **22** to match `.nvmrc`.

#### PowerShell: “running scripts is disabled” / cannot load `npm.ps1`

Windows may block `npm.ps1` (common with nvm4w). Fix for the **current** PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

Then retry `npm install`, `npm run build:web`, etc.

Alternatives:

- Use the `.cmd` shim: `npm.cmd install`
- Use **Command Prompt** (`cmd.exe`) instead of PowerShell
- Or relax policy for your user (one-time):  
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 1.3 — Visual Studio Build Tools (for native modules)

Required if `npm install` or `npm run build:app` fails on **node-gyp**, **MSBuild**, **better-sqlite3**, or **serialport**.

1. Download **Build Tools for Visual Studio**: https://visualstudio.microsoft.com/visual-cpp-build-tools/  
2. In the installer, select **“Desktop development with C++”** (MSVC + Windows SDK).  
3. Open a **new** terminal after install.

**Optional (Python):** If builds still ask for Python, install **Python 3.12** from https://www.python.org/downloads/windows/ — check **“Add python.exe to PATH”** — then:

```powershell
npm config set python "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
```

Adjust the path if your Python install location differs.

---

## 2. Clone the repository

In **PowerShell**, choose a parent folder (example: your user profile), then:

```powershell
cd $HOME
git clone https://github.com/haryowl/LT-IDP.git
cd LT-IDP
```

Or use **Git Bash**:

```bash
cd ~
git clone https://github.com/haryowl/LT-IDP.git
cd LT-IDP
```

---

## 3. Install dependencies

From the repository root (`LT-IDP`):

```powershell
npm install
```

If native modules fail:

1. Confirm Node is **not** 24+: `node -v`  
2. Install **Visual Studio Build Tools** (section 1.3) if not already installed.  
3. Clean and retry:

```powershell
Remove-Item -Recurse -Force node_modules
# Optional: Remove-Item package-lock.json
npm install
```

---

## 4. Run the app

### Option A — Desktop (Electron) — recommended on Windows workstations

**Development (hot reload):**

```powershell
npm run dev
```

Electron opens a window. Vite serves the UI at http://localhost:3000. Stop with **Ctrl+C**.

**Production installer (NSIS):**

```powershell
npm install
npm run build:app
```

`build:app` runs `npm run build` first, then rebuilds native modules for Electron and packages with **electron-builder**.

- Output folder: **`release\`**  
- Install the generated **`.exe`** (NSIS setup) on this PC or copy it to other Windows machines.  
- App data (SQLite DB, logs) lives under the OS user data directory, e.g. `%APPDATA%\IoT SCADA Client\` (product name from `package.json`).

If `build:app` fails while compiling **better-sqlite3**, see [Troubleshooting](#troubleshooting).

### Option B — Web application (browser)

No Electron window. The Express server serves the UI and API.

**Development:**

```powershell
npm run dev:web
```

Open **http://localhost:3000** in Chrome or Edge. API/WebSocket are proxied to port **3001** by Vite.

**Production:**

```powershell
npm run build:web
npm run start:web
```

Run **`build:web` before `start:web`**. Skipping the build causes:  
`Cannot find module … dist-server\server\index.js`.

- Default **PORT:** `3001`  
- Default data directory: `.\data` under the current working directory  

Example with an explicit data folder:

```powershell
$env:DATA_DIR = "C:\ProgramData\LT-IDP\data"
$env:PORT = "3001"
New-Item -ItemType Directory -Force -Path $env:DATA_DIR
npm run start:web
```

Open **http://localhost:3001** (or `http://<this-pc-ip>:3001` from another machine).

**NODE_MODULE_VERSION mismatch** after a desktop build: native addons were rebuilt for Electron. Fix for web mode:

```powershell
npm run rebuild:native
npm run start:web
```

You do **not** need `build:app` for web mode — only `npm install`, `build:web`, and `start:web`.

---

## 5. Quick deploy script (web mode)

From an elevated or normal PowerShell session in a folder of your choice:

```powershell
# Clone first if needed, then:
cd $HOME\LT-IDP
.\scripts\deploy-windows.ps1
```

Or with custom paths/port:

```powershell
.\scripts\deploy-windows.ps1 `
  -InstallDir "C:\LT-IDP" `
  -DataDir "C:\ProgramData\LT-IDP\data" `
  -Port 3001
```

The script clones/updates the repo (if needed), runs `npm install`, `npm run build:web`, creates the data directory, and starts the web server. Prerequisites (Git, Node) must already be installed.

---

## 6. Run in the background and auto-start on reboot

By default, closing the PowerShell window or restarting the PC **stops** LT-IDP. Use one of the scripts below so the **web** server stays up and starts again after reboot.

Prerequisites: you already ran `npm run build:web` (or `.\scripts\deploy-windows.ps1 -SkipStart`).

### Option A — Task Scheduler (recommended, no extra software)

**At PC startup** (runs even before login — needs **Administrator** PowerShell):

```powershell
cd $HOME\LT-IDP
# Build once if you have not yet:
# npm run build:web

Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows-autostart.ps1 -Trigger Startup -StartNow
```

**At user logon** (no admin required for the current user):

```powershell
.\scripts\install-windows-autostart.ps1 -Trigger Logon -StartNow
```

Custom paths/port:

```powershell
.\scripts\install-windows-autostart.ps1 `
  -InstallDir "C:\Users\sparing\LT-IDP" `
  -DataDir "C:\ProgramData\LT-IDP\data" `
  -Port 3001 `
  -Trigger Startup `
  -StartNow
```

Useful commands:

```powershell
Get-ScheduledTask -TaskName "LT-IDP Web"
Start-ScheduledTask -TaskName "LT-IDP Web"
Stop-ScheduledTask -TaskName "LT-IDP Web"
.\scripts\install-windows-autostart.ps1 -Uninstall
```

The task runs [`scripts/start-lt-idp-web.ps1`](../scripts/start-lt-idp-web.ps1), which sets `DATA_DIR` / `PORT` and starts `node dist-server\server\index.js`.

### Option B — NSSM Windows service (optional)

1. Download [NSSM](https://nssm.cc/download) and note the path to `win64\nssm.exe`.  
2. Open **Administrator** PowerShell:

```powershell
cd $HOME\LT-IDP
.\scripts\install-windows-service-nssm.ps1 `
  -NssmPath "C:\Tools\nssm\win64\nssm.exe" `
  -Port 3001
```

Remove the service:

```powershell
.\scripts\install-windows-service-nssm.ps1 -NssmPath "C:\Tools\nssm\win64\nssm.exe" -Uninstall
```

Service logs (default): `C:\ProgramData\LT-IDP\data\service-stdout.log` and `service-stderr.log`.

### Option C — PM2 on Windows (optional)

PM2 works on Windows but process management is less mature than on Linux. If you use it:

```powershell
npm install -g pm2
npm run build:web
# Edit ecosystem.config.cjs for PORT / DATA_DIR / cwd
pm2 start ecosystem.config.cjs
pm2 save
```

---

## 7. Windows Firewall (remote browser access)

If other PCs should open the web UI, allow inbound TCP on your port (default **3001**):

```powershell
New-NetFirewallRule -DisplayName "LT-IDP Web" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

Adjust `-LocalPort` if you changed `PORT`. For desktop-only Electron use on the same machine, this is usually unnecessary.

---

## 8. After installation

1. Log in with **`admin` / `admin`** (first run).  
2. Open **Settings** (as admin) and **change the admin password**; create other users as needed.  
3. Configure **Modbus**, **MQTT**, **mappings**, and **publishers** from the UI.  
4. For Modbus RTU on Windows, use the correct **COM** port (Device Manager → Ports). Close other apps (PuTTY, other Modbus tools) that may lock the port.  
5. For disk space and historical retention, use **Historical Data → Storage and cleanup**.

---

## Quick reference

| Item | Value |
|------|--------|
| **Repository (HTTPS)** | `https://github.com/haryowl/LT-IDP.git` |
| **Clone** | `git clone https://github.com/haryowl/LT-IDP.git` then `cd LT-IDP` |
| **Install deps** | `npm install` |
| **Dev (desktop)** | `npm run dev` |
| **Dev (web)** | `npm run dev:web` → http://localhost:3000 |
| **Prod web** | `npm run build:web` then `npm run start:web` → http://localhost:3001 |
| **Prod desktop installer** | `npm run build:app` → install from `release\` |
| **Data dir (web)** | `$env:DATA_DIR = "C:\ProgramData\LT-IDP\data"` |
| **Auto-start (Task Scheduler)** | `.\scripts\install-windows-autostart.ps1 -Trigger Startup -StartNow` |
| **Auto-start (NSSM service)** | `.\scripts\install-windows-service-nssm.ps1 -NssmPath "...\nssm.exe"` |
| **Remove auto-start task** | `.\scripts\install-windows-autostart.ps1 -Uninstall` |
| **Full cross-platform guide** | [INSTALLATION.md](INSTALLATION.md) |
| **Linux guide** | [INSTALL-LINUX.md](INSTALL-LINUX.md) |

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Node version errors | Use Node **18–22**. Uninstall Node 24+ or switch with nvm-windows. |
| `better-sqlite3` / `node-gyp` / MSBuild fails | Install **Visual Studio Build Tools** with **Desktop development with C++**. Open a new terminal, then `Remove-Item -Recurse -Force node_modules; npm install`. |
| Python / distutils errors during native build | Install Python 3.12 with PATH, then `npm config set python "<path-to-python.exe>"`. |
| `prebuild-install` **404** for `electron-v119` | Old lockfile / Electron 28 era. Delete `node_modules`, pull latest `main`, `npm install` again. |
| `build:app` fails on `better-sqlite3` | Pull latest `main` (Electron **29.x** pinned), clean `node_modules`, `npm install`, `npm run build:app`. Or run `npx electron-builder install-app-deps`. |
| `Cannot find module dist-server\server\index.js` | Run **`npm run build:web`** before **`npm run start:web`**. |
| `NODE_MODULE_VERSION` mismatch on `start:web` | Run **`npm run rebuild:native`**, then **`start:web`**. Caused by Electron rebuild; web needs Node-native addons. |
| COM port / Modbus “access denied” | Close GNSS/Settings if it uses the same port; quit PuTTY/Modbus tools; stop duplicate LT-IDP/Node processes; reconnect. |
| Port 3001 already in use | `$env:PORT = "3002"` then restart, or stop the other process. |
| Cannot reach UI from another PC | Check Windows Firewall (section 7) and that the server binds / you use the correct host IP. |
| `npm.ps1` / “running scripts is disabled” | `Set-ExecutionPolicy -Scope Process Bypass`, or use `npm.cmd`, or run from **cmd.exe**. See [section 1.2](#12--nodejs-22-lts). |

For Ubuntu/Linux steps, see [INSTALL-LINUX.md](INSTALL-LINUX.md). For a combined zero-to-running guide, see [INSTALLATION.md](INSTALLATION.md).
