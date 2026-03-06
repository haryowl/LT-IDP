# Type definitions

## Security

IPC is exposed only via explicit methods on `electronAPI` (see `electron/preload.ts`). There is no generic `invoke(channel, ...args)` or raw `ipcRenderer` exposure. When adding new features, add dedicated methods to preload and to `ElectronAPI` in `src/types/index.ts` rather than a generic channel.

## Overview

- **`src/types/index.ts`** – Defines the **Electron IPC API** shape (`ElectronAPI`) and `Window.electronAPI`. Use this for renderer code that calls `window.electronAPI.*`.
- **`electron/types.ts`** – **Canonical entity types** used by the main process: `User`, `ModbusDevice`, `ModbusRegister`, `MqttDevice`, `ParameterMapping`, `Publisher`, `RealtimeData`, `HistoricalData`, `MqttBrokerConfig`, and SPARING-related types.

## Keeping types in sync

- When adding or changing IPC channels, update:
  1. `electron/main.ts` (ipcMain handlers)
  2. `electron/preload.ts` (exposed API)
  3. `src/types/index.ts` (`ElectronAPI` interface)
- When adding or changing entities (e.g. new fields on `ParameterMapping`), update `electron/types.ts`. Frontend pages can mirror interfaces locally or import from a shared location if one is introduced later.
