import { contextBridge, ipcRenderer } from 'electron';

// Expose only explicit IPC methods (no generic invoke/send). Keep contextIsolation
// and nodeIntegration: false in main window for security.
contextBridge.exposeInMainWorld('electronAPI', {
  // Authentication
  auth: {
    login: (credentials: { username: string; password: string }) =>
      ipcRenderer.invoke('auth:login', credentials),
    logout: (token: string) =>
      ipcRenderer.invoke('auth:logout', { token }),
    verify: (token: string) =>
      ipcRenderer.invoke('auth:verify', { token }),
    getStoredSession: () =>
      ipcRenderer.invoke('auth:getStoredSession'),
  },
  // User Management
  users: {
    list: () => ipcRenderer.invoke('users:list'),
    create: (user: any) => ipcRenderer.invoke('users:create', user),
  },
  // Modbus Device Management
  modbus: {
    devices: {
      list: () => ipcRenderer.invoke('modbus:devices:list'),
      create: (device: any) => ipcRenderer.invoke('modbus:devices:create', device),
      update: (id: string, device: any) =>
        ipcRenderer.invoke('modbus:devices:update', { id, device }),
      delete: (id: string) => ipcRenderer.invoke('modbus:devices:delete', id),
    },
    registers: {
      list: (deviceId: string) => ipcRenderer.invoke('modbus:registers:list', deviceId),
      create: (register: any) => ipcRenderer.invoke('modbus:registers:create', register),
      update: (id: string, register: any) =>
        ipcRenderer.invoke('modbus:registers:update', { id, register }),
      delete: (id: string) => ipcRenderer.invoke('modbus:registers:delete', id),
    },
    connect: (deviceId: string) => ipcRenderer.invoke('modbus:connect', deviceId),
    disconnect: (deviceId: string) => ipcRenderer.invoke('modbus:disconnect', deviceId),
    getStatus: () => ipcRenderer.invoke('modbus:status'),
    listSerialPorts: () => ipcRenderer.invoke('modbus:listSerialPorts'),
  },
  // MQTT Device Management
  mqtt: {
    devices: {
      list: () => ipcRenderer.invoke('mqtt:devices:list'),
      create: (device: any) => ipcRenderer.invoke('mqtt:devices:create', device),
      update: (id: string, device: any) =>
        ipcRenderer.invoke('mqtt:devices:update', { id, device }),
      delete: (id: string) => ipcRenderer.invoke('mqtt:devices:delete', id),
    },
    broker: {
      get: () => ipcRenderer.invoke('mqtt:broker:get'),
      save: (config: any) => ipcRenderer.invoke('mqtt:broker:save', config),
      start: () => ipcRenderer.invoke('mqtt:broker:start'),
      stop: () => ipcRenderer.invoke('mqtt:broker:stop'),
      getStatus: () => ipcRenderer.invoke('mqtt:broker:status'),
      checkInstalled: () => ipcRenderer.invoke('mqtt:broker:check-installed'),
    },
    connect: (deviceId: string) => ipcRenderer.invoke('mqtt:connect', deviceId),
    disconnect: (deviceId: string) => ipcRenderer.invoke('mqtt:disconnect', deviceId),
    getStatus: () => ipcRenderer.invoke('mqtt:status'),
    getDiscoveredTopics: () => ipcRenderer.invoke('mqtt:discovered'),
  },
  // Parameter Mapping
  mappings: {
    list: () => ipcRenderer.invoke('mappings:list'),
    create: (mapping: any) => ipcRenderer.invoke('mappings:create', mapping),
    update: (id: string, mapping: any) =>
      ipcRenderer.invoke('mappings:update', { id, mapping }),
    delete: (id: string) => ipcRenderer.invoke('mappings:delete', id),
  },
  // Data Query & Export
  data: {
    query: (params: any) => ipcRenderer.invoke('data:query', params),
    export: (params: any) => ipcRenderer.invoke('data:export', params),
    subscribeRealtime: (mappingIds: string[]) =>
      ipcRenderer.invoke('data:realtime:subscribe', mappingIds),
    onRealtimeData: (callback: (data: any) => void) => {
      ipcRenderer.on('data:realtime', (_event, data) => callback(data));
    },
  },
  // Publisher Configuration
  publishers: {
    list: () => ipcRenderer.invoke('publishers:list'),
    create: (publisher: any) => ipcRenderer.invoke('publishers:create', publisher),
    update: (id: string, publisher: any) =>
      ipcRenderer.invoke('publishers:update', { id, publisher }),
    delete: (id: string) => ipcRenderer.invoke('publishers:delete', id),
    toggle: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('publishers:toggle', { id, enabled }),
  },
  thresholdRules: {
    list: () => ipcRenderer.invoke('thresholdRules:list'),
    create: (rule: any) => ipcRenderer.invoke('thresholdRules:create', rule),
    update: (id: string, rule: any) =>
      ipcRenderer.invoke('thresholdRules:update', { id, rule }),
    delete: (id: string) => ipcRenderer.invoke('thresholdRules:delete', id),
    test: (id: string) => ipcRenderer.invoke('thresholdRules:test', id),
  },
  // System Configuration
  system: {
    getClientId: () => ipcRenderer.invoke('system:getClientId'),
    setClientId: (clientId: string) => ipcRenderer.invoke('system:setClientId', clientId),
    getTimestampInterval: () => ipcRenderer.invoke('system:getTimestampInterval'),
    setTimestampInterval: (seconds: number) => ipcRenderer.invoke('system:setTimestampInterval', seconds),
    getLocalIp: () => ipcRenderer.invoke('system:getLocalIp'),
    getLogDirectory: () => ipcRenderer.invoke('system:getLogDirectory'),
    getCurrentLogFile: () => ipcRenderer.invoke('system:getCurrentLogFile'),
  },
  // SPARING Configuration
  sparing: {
    getConfig: () => ipcRenderer.invoke('sparing:getConfig'),
    updateConfig: (config: any) => ipcRenderer.invoke('sparing:updateConfig', config),
    fetchApiSecret: () => ipcRenderer.invoke('sparing:fetchApiSecret'),
    getMappings: () => ipcRenderer.invoke('sparing:getMappings'),
    upsertMapping: (sparingParam: string, mappingId: string) =>
      ipcRenderer.invoke('sparing:upsertMapping', sparingParam, mappingId),
    deleteMapping: (id: string) => ipcRenderer.invoke('sparing:deleteMapping', id),
    getLogs: (limit?: number) => ipcRenderer.invoke('sparing:getLogs', limit),
    processQueue: () => ipcRenderer.invoke('sparing:processQueue'),
    getQueueItems: (limit?: number) => ipcRenderer.invoke('sparing:getQueueItems', limit),
    sendNow: (hourTimestamp?: number) =>
      ipcRenderer.invoke('sparing:sendNow', hourTimestamp),
    getStatus: () => ipcRenderer.invoke('sparing:getStatus'),
  },
  // Event listeners for real-time data
  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
});

