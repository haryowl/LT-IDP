# IoT SCADA Client (LT IDP)

A cross-platform **desktop (Electron)** or **web** application for industrial IoT: collect data from Modbus and MQTT, map to parameters, store history, monitor in real time, and publish to MQTT/HTTP or the SPARING API.

**Branding:** LT IDP — Integrated Data Parser.

## Tech stack

- **Frontend:** React 18, TypeScript, Vite, MUI 5, Zustand, React Router 6, Recharts
- **Desktop (optional):** Electron 28 (context isolation, no Node in renderer)
- **Web:** Express server (Node), same business logic as Electron main process
- **Backend:** Node, SQLite (`better-sqlite3`), `modbus-serial`, `mqtt`, `serialport`
- **Auth:** Local JWT + bcrypt, users in SQLite

## Prerequisites

- **Node.js 18, 20, or 22 (LTS).** Avoid **Node 24+** for now: native addons such as `better-sqlite3` often have no prebuilt binary for very new Node versions, and compiling from source against Node 24’s V8 fails with the current stack.
- npm or yarn

If you use [nvm](https://github.com/nvm-sh/nvm), run `nvm install` in the repo root (see `.nvmrc`, e.g. Node 22).

## Setup

```bash
npm install
```

For native modules (e.g. `better-sqlite3`, `serialport`) on Windows you may need [windows-build-tools](https://github.com/felixrieseberg/windows-build-tools) or Visual Studio Build Tools.

### Linux (Ubuntu): `better-sqlite3` / `node-gyp` errors

1. Install compilers: `sudo apt install -y build-essential python3`
2. Switch to **Node 20 or 22 LTS** (not 24), e.g. `nvm install 22 && nvm use 22`
3. Clean and reinstall: `rm -rf node_modules && npm install`

### Linux (Ubuntu 24.04+ / Python 3.12): `ModuleNotFoundError: No module named 'distutils'` (e.g. `lzma-native`)

Python 3.12 removed `distutils`; `node-gyp` (used when building native addons such as `lzma-native` from `electron-builder`) needs a compatibility layer.

1. Install: `sudo apt install -y python3-setuptools liblzma-dev`
2. Clean and reinstall: `rm -rf node_modules && npm install`

On **ARM64** (e.g. Raspberry Pi), the same packages apply; ensure you use Node 20 or 22 LTS.

`package.json` includes an `engines.node` range; npm may warn if Node is outside that range.

## Run (development)

**Electron (desktop):**

```bash
npm run dev
```

- Frontend: http://localhost:3000 (hot-reload)
- Electron loads the dev URL and opens DevTools

**Web (browser, no Electron):**

```bash
npm run dev:web
```

- Frontend: http://localhost:3000 (Vite, hot-reload)
- API server: http://localhost:3001 (Express). Vite proxies `/api` and `/api/ws` to the server.
- Open http://localhost:3000 in your browser. Works on headless servers (Linux) and anywhere you can run Node.

## Build

1. Build the React app and the Electron main process:

```bash
npm run build
```

This runs `vite build` (output in `dist/`) and `tsc -p electron/tsconfig.json` (output in `dist-electron/`).

2. Package the application (e.g. Windows installer):

```bash
npm run build:app
```

- Uses **electron-builder** (NSIS on Windows).
- Output: `release/` (installer and unpacked app).

Preload script is built to `dist-electron/preload.js` and loaded at runtime via `path.join(__dirname, 'preload.js')`, so the packaged app uses the correct path automatically.

## Release / distribution

- **Windows:** `npm run build` then `npm run build:app`. Installer and portable files are in `release/`.
- **Config & data:** Stored under the OS user data directory (e.g. `%APPDATA%\<app name>` on Windows). Database: `scada.db`; logs: `logs/` subfolder.
- Default user (create one from Settings or DB if needed): typically **admin** / set at first run.

## Architecture (high level)

```
┌─────────────────────────────────────────────────────────────────┐
│  Renderer (React + Vite)                                        │
│  - Pages: Dashboard, Modbus, MQTT, Mappings, Publishers,         │
│    Monitoring, Historical, SPARING, Log Terminal, Settings     │
│  - Auth: Zustand + persisted session (Electron safeStorage)     │
│  - UI errors: ErrorSnackbarContext (global snackbar)            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ IPC (preload: contextBridge)
┌───────────────────────────▼─────────────────────────────────────┐
│  Main process (Electron)                                        │
│  - Services: Database (SQLite), Auth, Modbus, MQTT Subscriber,   │
│    MQTT Publisher, MQTT Broker, HttpClient, DataMapper,         │
│    SparingService, Logger, SessionStore                          │
│  - Data flow: Modbus/MQTT → DataMapper → DB + realtime →        │
│    Monitoring UI; stored data → Publishers (MQTT/HTTP)          │
│  - SPARING: scheduled send (hourly / 2-min) to external API     │
└─────────────────────────────────────────────────────────────────┘
```

- **Roles:** `admin`, `viewer`, and `guest`. SPARING menu/route are available for `admin` + `guest`; `guest` is restricted to SPARING only.
- **Types:** See `docs/TYPES.md` for where API and entity types are defined.

## Tests

```bash
npm test        # run once
npm run test:watch  # watch mode
```

Uses Vitest and Testing Library. Tests live under `src/**/*.test.{ts,tsx}`. Main-process logic (e.g. DataMapper, SparingService) can be covered by Node tests with mocks for DB/Electron.

## Scripts

| Script           | Description                        |
|------------------|------------------------------------|
| `npm run dev`    | Vite + Electron (desktop dev)      |
| `npm run dev:web`| Vite + Express (web dev, no Electron) |
| `npm run build`  | Vite build + Electron TS build     |
| `npm run build:web` | Vite build + server TS build (for web deploy) |
| `npm run build:server` | Compile server to `dist-server/` |
| `npm run build:app` | electron-builder (installer)   |
| `npm start`      | Run packaged Electron app          |
| `npm run start:web` | Run web server (after `npm run build:web`) |
| `npm run preview`| Vite preview (web only)            |

**Production (Linux, PM2):** After `npm run build:web`, from the project root run `pm2 start` (uses `ecosystem.config.js`) or `pm2 start ecosystem.config.cjs`. Set `DATA_DIR` and `PORT` in the env or edit `ecosystem.config.cjs`. Example: `DATA_DIR=$HOME/lt-idp-data pm2 start`.
| `npm test`       | Run unit tests                     |

## License

Proprietary / as per your project.
