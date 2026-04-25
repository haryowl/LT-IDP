/**
 * Frontend type definitions for the Electron IPC API (preload exposure).
 * Canonical entity types (User, ModbusDevice, ParameterMapping, etc.) live in
 * electron/types.ts. Keep API signatures here in sync with electron/preload.ts
 * and electron/main.ts IPC handlers.
 */
export interface ElectronAPI {
  auth: {
    login: (credentials: { username: string; password: string }) => Promise<any>;
    logout: (token: string) => Promise<any>;
    verify: (token: string) => Promise<any>;
    changePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<any>;
    getStoredSession: () => Promise<{ token: string; username: string; role: string } | null>;
  };
  users: {
    list: () => Promise<any[]>;
    create: (user: any) => Promise<any>;
  };
  modbus: {
    devices: {
      list: () => Promise<any[]>;
      create: (device: any) => Promise<any>;
      update: (id: string, device: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
    };
    registers: {
      list: (deviceId: string) => Promise<any[]>;
      create: (register: any) => Promise<any>;
      update: (id: string, register: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
    };
    connect: (deviceId: string) => Promise<any>;
    disconnect: (deviceId: string) => Promise<any>;
    getStatus: () => Promise<any>;
    write: (payload: { deviceId: string; registerId: string; value: unknown }) => Promise<{ ok: boolean }>;
    listSerialPorts: () => Promise<{ path: string; manufacturer?: string; serialNumber?: string }[]>;
  };
  mqtt: {
    devices: {
      list: () => Promise<any[]>;
      create: (device: any) => Promise<any>;
      update: (id: string, device: any) => Promise<any>;
      delete: (id: string) => Promise<any>;
    };
    broker: {
      get: () => Promise<any>;
      save: (config: any) => Promise<any>;
      start: () => Promise<any>;
      stop: () => Promise<any>;
      getStatus: () => Promise<any>;
      checkInstalled: () => Promise<any>;
    };
    connect: (deviceId: string) => Promise<any>;
    disconnect: (deviceId: string) => Promise<any>;
    getStatus: () => Promise<any>;
  };
  mappings: {
    list: () => Promise<any[]>;
    create: (mapping: any) => Promise<any>;
    update: (id: string, mapping: any) => Promise<any>;
    delete: (id: string) => Promise<any>;
  };
  data: {
    query: (params: any) => Promise<any>;
    export: (params: any) => Promise<any>;
    subscribeRealtime: (mappingIds: string[]) => Promise<any>;
    onRealtimeData: (callback: (data: any) => void) => void;
  };
  publishers: {
    list: () => Promise<any[]>;
    create: (publisher: any) => Promise<any>;
    update: (id: string, publisher: any) => Promise<any>;
    delete: (id: string) => Promise<any>;
    toggle: (id: string, enabled: boolean) => Promise<any>;
  };
  system: {
    getClientId: () => Promise<string>;
    setClientId: (clientId: string) => Promise<any>;
    getLocalIp: () => Promise<string>;
    getReadOnlyToken: () => Promise<string>;
    regenerateReadOnlyToken: () => Promise<string>;
  };
  sparing: {
    getConfig: () => Promise<any>;
    updateConfig: (config: any) => Promise<any>;
    fetchApiSecret: () => Promise<any>;
    getMappings: () => Promise<any[]>;
    upsertMapping: (sparingParam: string, mappingId: string) => Promise<any>;
    deleteMapping: (id: string) => Promise<any>;
    getLogs: (limit?: number) => Promise<any[]>;
    processQueue: () => Promise<any>;
    sendNow: (hourTimestamp?: number) => Promise<any>;
  };
  emailNotifications: {
    get: () => Promise<any>;
    save: (body: any) => Promise<any>;
    test: () => Promise<{ ok: boolean; error?: string }>;
  };
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}