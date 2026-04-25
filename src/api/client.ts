/**
 * API client: uses Electron IPC when available, otherwise HTTP + WebSocket to the web server.
 */
const BASE = typeof import.meta.env !== 'undefined' && import.meta.env.VITE_API_URL
  ? (import.meta.env as any).VITE_API_URL
  : '';

export const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

const tokenStore = { token: null as string | null };

function getToken(): string | null {
  if (isElectron) return null; // Electron uses IPC, no header
  return tokenStore.token || (typeof localStorage !== 'undefined' ? localStorage.getItem('lt-idp-token') : null);
}

function setToken(t: string | null) {
  tokenStore.token = t;
  if (typeof localStorage !== 'undefined') {
    if (t) localStorage.setItem('lt-idp-token', t);
    else localStorage.removeItem('lt-idp-token');
  }
}

async function request<T = any>(method: string, path: string, body?: any): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE}/api${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    credentials: 'include',
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = text ? JSON.parse(text) : null;
      if (body && typeof body.error === 'string') msg = body.error;
      else if (text) msg = text;
    } catch (_) {
      if (text) msg = text;
    }
    const err = new Error(msg);
    (err as any).status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : undefined;
}

// WebSocket endpoint on server
export function getWebSocketUrl(): string {
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3001';
  const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${host}`;
}

/** Normalize modbus/mqtt getStatus() response to an array of { deviceId, connected, lastError?, ... } */
export function normalizeConnectionStatus(status: any): { deviceId: string; connected: boolean; lastError?: string }[] {
  if (Array.isArray(status)) return status;
  if (status && Array.isArray(status.data)) return status.data;
  const conn = status?.connections || {};
  return Object.keys(conn).map((id) => ({
    deviceId: id,
    connected: !!conn[id]?.connected,
    lastError: conn[id]?.lastError,
  }));
}

// Shared WebSocket for log/event channels (modbus:data, mqtt:data, publisher:log) in web mode
const LOG_CHANNELS = ['modbus:data', 'mqtt:data', 'publisher:log'] as const;
type LogChannel = (typeof LOG_CHANNELS)[number];
const wsEventListeners: { channel: string; callback: (...args: any[]) => void }[] = [];
let wsForEvents: WebSocket | null = null;

function ensureWsForEvents(): void {
  if (typeof window === 'undefined') return;
  if (wsForEvents?.readyState === WebSocket.OPEN) return;
  if (wsForEvents != null) return; // connecting or closed, will reconnect on next use
  const url = getWebSocketUrl();
  const t = getToken();
  const ws = new WebSocket(`${url}/api/ws${t ? `?token=${encodeURIComponent(t)}` : ''}`);
  wsForEvents = ws;
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data as string);
      if (!m || typeof m.type !== 'string') return;
      const data = m.data !== undefined ? m.data : m;
      wsEventListeners.forEach(({ channel, callback }) => {
        if (m.type === channel) callback(data);
      });
    } catch (_) {}
  };
  ws.onclose = () => {
    wsForEvents = null;
    if (wsEventListeners.length > 0) setTimeout(ensureWsForEvents, 2000);
  };
  ws.onerror = () => {
    wsForEvents = null;
  };
}

function subscribeLogChannel(channel: string, callback: (...args: any[]) => void): () => void {
  if (!LOG_CHANNELS.includes(channel as LogChannel)) return () => {};
  wsEventListeners.push({ channel, callback });
  ensureWsForEvents();
  return () => {
    const i = wsEventListeners.findIndex((e) => e.channel === channel && e.callback === callback);
    if (i !== -1) wsEventListeners.splice(i, 1);
    if (wsEventListeners.length === 0 && wsForEvents) {
      wsForEvents.close();
      wsForEvents = null;
    }
  };
}

export const api = {
  auth: {
    login: async (credentials: { username: string; password: string }) => {
      if (isElectron) {
        const r = await (window as any).electronAPI.auth.login(credentials);
        if (r?.token) setToken(r.token);
        return r;
      }
      const r = await request<{ token: string; user: any }>('POST', '/auth/login', credentials);
      if (r?.token) setToken(r.token);
      return r;
    },
    logout: async (token?: string) => {
      if (isElectron) return (window as any).electronAPI.auth.logout(token || getToken() || '');
      await request('POST', '/auth/logout', token ? { token } : {});
      setToken(null);
    },
    verify: async (token: string) => {
      if (isElectron) return (window as any).electronAPI.auth.verify(token);
      return request<{ valid: boolean; user?: any }>('GET', '/auth/verify', undefined as any);
    },
    changePassword: async (currentPassword: string, newPassword: string) => {
      if (isElectron) return (window as any).electronAPI.auth.changePassword({ currentPassword, newPassword });
      return request('POST', '/auth/change-password', { currentPassword, newPassword });
    },
    getStoredSession: async () => {
      if (isElectron) return (window as any).electronAPI.auth.getStoredSession();
      const r = await request<{ token: string; username: string; role: string } | null>('GET', '/auth/session');
      if (r?.token) setToken(r.token);
      return r;
    },
  },
  users: {
    list: () => (isElectron ? (window as any).electronAPI.users.list() : request('GET', '/users/list')),
    create: (user: any) => (isElectron ? (window as any).electronAPI.users.create(user) : request('POST', '/users/create', user)),
  },
  modbus: {
    devices: { list: () => (isElectron ? (window as any).electronAPI.modbus.devices.list() : request('GET', '/modbus/devices')), create: (d: any) => (isElectron ? (window as any).electronAPI.modbus.devices.create(d) : request('POST', '/modbus/devices', d)), update: (id: string, d: any) => (isElectron ? (window as any).electronAPI.modbus.devices.update(id, d) : request('PUT', `/modbus/devices/${id}`, d)), delete: (id: string) => (isElectron ? (window as any).electronAPI.modbus.devices.delete(id) : request('DELETE', `/modbus/devices/${id}`)) },
    registers: { list: (deviceId: string) => (isElectron ? (window as any).electronAPI.modbus.registers.list(deviceId) : request('GET', `/modbus/registers?deviceId=${encodeURIComponent(deviceId)}`)), create: (r: any) => (isElectron ? (window as any).electronAPI.modbus.registers.create(r) : request('POST', '/modbus/registers', r)), update: (id: string, r: any) => (isElectron ? (window as any).electronAPI.modbus.registers.update(id, r) : request('PUT', `/modbus/registers/${id}`, r)), delete: (id: string) => (isElectron ? (window as any).electronAPI.modbus.registers.delete(id) : request('DELETE', `/modbus/registers/${id}`)) },
    connect: (deviceId: string) => (isElectron ? (window as any).electronAPI.modbus.connect(deviceId) : request('POST', '/modbus/connect', { deviceId })),
    disconnect: (deviceId: string) => (isElectron ? (window as any).electronAPI.modbus.disconnect(deviceId) : request('POST', '/modbus/disconnect', { deviceId })),
    getStatus: () => (isElectron ? (window as any).electronAPI.modbus.getStatus() : request('GET', '/modbus/status')),
    write: (payload: { deviceId: string; registerId: string; value: unknown }) =>
      isElectron
        ? (window as any).electronAPI.modbus.write(payload)
        : request<{ ok: boolean }>('POST', '/modbus/write', payload),
    listSerialPorts: () => (isElectron ? (window as any).electronAPI.modbus.listSerialPorts() : request<{ path: string; manufacturer?: string }[]>('GET', '/serial-ports')),
  },
  mqtt: {
    devices: { list: () => (isElectron ? (window as any).electronAPI.mqtt.devices.list() : request('GET', '/mqtt/devices')), create: (d: any) => (isElectron ? (window as any).electronAPI.mqtt.devices.create(d) : request('POST', '/mqtt/devices', d)), update: (id: string, d: any) => (isElectron ? (window as any).electronAPI.mqtt.devices.update(id, d) : request('PUT', `/mqtt/devices/${id}`, d)), delete: (id: string) => (isElectron ? (window as any).electronAPI.mqtt.devices.delete(id) : request('DELETE', `/mqtt/devices/${id}`)) },
    broker: { get: () => (isElectron ? (window as any).electronAPI.mqtt.broker.get() : request('GET', '/mqtt/broker')), save: (c: any) => (isElectron ? (window as any).electronAPI.mqtt.broker.save(c) : request('POST', '/mqtt/broker', c)), start: () => (isElectron ? (window as any).electronAPI.mqtt.broker.start() : request('POST', '/mqtt/broker/start')), stop: () => (isElectron ? (window as any).electronAPI.mqtt.broker.stop() : request('POST', '/mqtt/broker/stop')), getStatus: () => (isElectron ? (window as any).electronAPI.mqtt.broker.getStatus() : request('GET', '/mqtt/broker/status')), checkInstalled: () => (isElectron ? (window as any).electronAPI.mqtt.broker.checkInstalled() : request('GET', '/mqtt/broker/check-installed')) },
    connect: (deviceId: string) => (isElectron ? (window as any).electronAPI.mqtt.connect(deviceId) : request('POST', '/mqtt/connect', { deviceId })),
    disconnect: (deviceId: string) => (isElectron ? (window as any).electronAPI.mqtt.disconnect(deviceId) : request('POST', '/mqtt/disconnect', { deviceId })),
    getStatus: () => (isElectron ? (window as any).electronAPI.mqtt.getStatus() : request('GET', '/mqtt/status')),
    getDiscoveredTopics: () => (isElectron ? (window as any).electronAPI.mqtt.getDiscoveredTopics() : request<{ topic: string; lastSeen: number; lastValue?: unknown }[]>('GET', '/mqtt/discovered')),
  },
  mappings: { list: () => (isElectron ? (window as any).electronAPI.mappings.list() : request('GET', '/mappings')), create: (m: any) => (isElectron ? (window as any).electronAPI.mappings.create(m) : request('POST', '/mappings', m)), update: (id: string, m: any) => (isElectron ? (window as any).electronAPI.mappings.update(id, m) : request('PUT', `/mappings/${id}`, m)), delete: (id: string) => (isElectron ? (window as any).electronAPI.mappings.delete(id) : request('DELETE', `/mappings/${id}`)) },
  data: {
    query: (params: any) => (isElectron ? (window as any).electronAPI.data.query(params) : request('POST', '/data/query', params)),
    export: (params: any) => (isElectron ? (window as any).electronAPI.data.export(params) : request('POST', '/data/export', params)),
    subscribeRealtime: (mappingIds: string[]) => (isElectron ? (window as any).electronAPI.data.subscribeRealtime(mappingIds) : request('POST', '/data/realtime/subscribe', { mappingIds })),
    onRealtimeData: (callback: (data: any) => void) => {
      if (isElectron) return (window as any).electronAPI.on('data:realtime', (_: any, data: any) => callback(data));
      const url = getWebSocketUrl();
      const t = getToken();
      const ws = new WebSocket(`${url}/api/ws${t ? `?token=${encodeURIComponent(t)}` : ''}`);
      ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.type === 'data:realtime') callback(m.data); } catch (_) {} };
      return () => ws.close();
    },
  },
  publishers: { list: () => (isElectron ? (window as any).electronAPI.publishers.list() : request('GET', '/publishers')), create: (p: any) => (isElectron ? (window as any).electronAPI.publishers.create(p) : request('POST', '/publishers', p)), update: (id: string, p: any) => (isElectron ? (window as any).electronAPI.publishers.update(id, p) : request('PUT', `/publishers/${id}`, p)), delete: (id: string) => (isElectron ? (window as any).electronAPI.publishers.delete(id) : request('DELETE', `/publishers/${id}`)), toggle: (id: string, enabled: boolean) => (isElectron ? (window as any).electronAPI.publishers.toggle(id, enabled) : request('POST', '/publishers/toggle', { id, enabled })) },
  thresholdRules: { list: () => (isElectron ? (window as any).electronAPI.thresholdRules.list() : request('GET', '/threshold-rules')), create: (r: any) => (isElectron ? (window as any).electronAPI.thresholdRules.create(r) : request('POST', '/threshold-rules', r)), update: (id: string, r: any) => (isElectron ? (window as any).electronAPI.thresholdRules.update(id, r) : request('PUT', `/threshold-rules/${id}`, r)), delete: (id: string) => (isElectron ? (window as any).electronAPI.thresholdRules.delete(id) : request('DELETE', `/threshold-rules/${id}`)), test: (id: string) => (isElectron ? (window as any).electronAPI.thresholdRules.test(id) : request('POST', `/threshold-rules/${id}/test`)) },
  advancedRules: {
    list: () => (isElectron ? Promise.reject(new Error('Advanced rules are only available in web mode')) : request('GET', '/advanced-rules')),
    create: (r: any) => (isElectron ? Promise.reject(new Error('Advanced rules are only available in web mode')) : request('POST', '/advanced-rules', r)),
    update: (id: string, r: any) => (isElectron ? Promise.reject(new Error('Advanced rules are only available in web mode')) : request('PUT', `/advanced-rules/${id}`, r)),
    delete: (id: string) => (isElectron ? Promise.reject(new Error('Advanced rules are only available in web mode')) : request('DELETE', `/advanced-rules/${id}`)),
    test: (id: string) => (isElectron ? Promise.reject(new Error('Advanced rules are only available in web mode')) : request('POST', `/advanced-rules/${id}/test`)),
    events: (limit?: number) =>
      isElectron
        ? Promise.reject(new Error('Advanced rules are only available in web mode'))
        : request('GET', `/advanced-rules/events?limit=${encodeURIComponent(String(limit ?? 200))}`),
  },
  gnss: {
    getConfig: () => (isElectron ? Promise.reject(new Error('GNSS config is only available in web mode')) : request('GET', '/gnss/config')),
    saveConfig: (c: any) => (isElectron ? Promise.reject(new Error('GNSS config is only available in web mode')) : request('POST', '/gnss/config', c)),
    getStatus: () => (isElectron ? Promise.reject(new Error('GNSS status is only available in web mode')) : request('GET', '/gnss/status')),
    resetTripDistance: () =>
      isElectron ? Promise.reject(new Error('GNSS control is only available in web mode')) : request('POST', '/gnss/reset-trip-distance', {}),
  },
  system: { getClientId: () => (isElectron ? (window as any).electronAPI.system.getClientId() : request('GET', '/system/client-id')), setClientId: (id: string) => (isElectron ? (window as any).electronAPI.system.setClientId(id) : request('POST', '/system/client-id', { clientId: id })), getLocalIp: () => (isElectron ? (window as any).electronAPI.system.getLocalIp() : request('GET', '/system/local-ip')), getTimestampInterval: () => (isElectron ? (window as any).electronAPI.system.getTimestampInterval?.() : request('GET', '/system/timestamp-interval')), setTimestampInterval: (s: number) => (isElectron ? (window as any).electronAPI.system.setTimestampInterval?.(s) : request('POST', '/system/timestamp-interval', { seconds: s })), getLogDirectory: () => (isElectron ? (window as any).electronAPI.system.getLogDirectory?.() : request('GET', '/system/log-directory')), getCurrentLogFile: () => (isElectron ? (window as any).electronAPI.system.getCurrentLogFile?.() : request('GET', '/system/current-log-file')), getSystemInfo: () => (isElectron ? (window as any).electronAPI.system.getSystemInfo?.() : request('GET', '/system/info')) },
  wifi: {
    status: () => (isElectron ? Promise.reject(new Error('Wi‑Fi control is only available in web mode')) : request('GET', '/wifi/status')),
    scan: (ifname?: string) =>
      isElectron ? Promise.reject(new Error('Wi‑Fi control is only available in web mode')) : request('GET', `/wifi/scan${ifname ? `?ifname=${encodeURIComponent(ifname)}` : ''}`),
    connect: (payload: { ssid: string; password?: string; ifname?: string }) =>
      isElectron ? Promise.reject(new Error('Wi‑Fi control is only available in web mode')) : request('POST', '/wifi/connect', payload),
    disconnect: (payload: { ifname: string }) =>
      isElectron ? Promise.reject(new Error('Wi‑Fi control is only available in web mode')) : request('POST', '/wifi/disconnect', payload),
  },
  netIp: {
    status: () => (isElectron ? Promise.reject(new Error('IP settings are only available in web mode')) : request('GET', '/net/ip/status')),
    set: (payload: { device: string; method: 'auto' | 'manual'; address?: string; gateway?: string; dns?: string[] }) =>
      isElectron ? Promise.reject(new Error('IP settings are only available in web mode')) : request('POST', '/net/ip/set', payload),
  },
  systemSecurity: {
    getReadOnlyToken: () =>
      isElectron
        ? (window as any).electronAPI.system.getReadOnlyToken()
        : request('GET', '/system/read-only-token'),
    regenerateReadOnlyToken: () =>
      isElectron
        ? (window as any).electronAPI.system.regenerateReadOnlyToken()
        : request('POST', '/system/read-only-token/regenerate'),
  },
  sparing: { getConfig: () => (isElectron ? (window as any).electronAPI.sparing.getConfig() : request('GET', '/sparing/config')), updateConfig: (c: any) => (isElectron ? (window as any).electronAPI.sparing.updateConfig(c) : request('POST', '/sparing/config', c)), fetchApiSecret: () => (isElectron ? (window as any).electronAPI.sparing.fetchApiSecret() : request('POST', '/sparing/fetch-api-secret')), getMappings: () => (isElectron ? (window as any).electronAPI.sparing.getMappings() : request('GET', '/sparing/mappings')), upsertMapping: (sparingParam: string, mappingId: string) => (isElectron ? (window as any).electronAPI.sparing.upsertMapping(sparingParam, mappingId) : request('POST', '/sparing/mappings', { sparingParam, mappingId })), deleteMapping: (id: string) => (isElectron ? (window as any).electronAPI.sparing.deleteMapping(id) : request('DELETE', `/sparing/mappings/${id}`)), getLogs: (limit?: number) => (isElectron ? (window as any).electronAPI.sparing.getLogs(limit) : request('GET', `/sparing/logs?limit=${limit ?? 50}`)), exportLog: (date?: string) => (isElectron ? (window as any).electronAPI.sparing.exportLog(date) : request('GET', `/sparing/export-log${date ? `?date=${encodeURIComponent(date)}` : ''}`)), processQueue: () => (isElectron ? (window as any).electronAPI.sparing.processQueue() : request('POST', '/sparing/process-queue')), getQueueItems: (limit?: number) => (isElectron ? (window as any).electronAPI.sparing.getQueueItems(limit) : request('GET', `/sparing/queue?limit=${limit ?? 100}`)), sendNow: (hourTimestamp?: number) => (isElectron ? (window as any).electronAPI.sparing.sendNow(hourTimestamp) : request('POST', '/sparing/send-now', { hourTimestamp })), getStatus: () => (isElectron ? (window as any).electronAPI.sparing.getStatus() : request('GET', '/sparing/status')) },
  emailNotifications: {
    get: () =>
      isElectron
        ? (window as any).electronAPI.emailNotifications.get()
        : request('GET', '/email-notifications'),
    save: (body: any) =>
      isElectron
        ? (window as any).electronAPI.emailNotifications.save(body)
        : request('POST', '/email-notifications', body),
    test: () =>
      isElectron
        ? (window as any).electronAPI.emailNotifications.test()
        : request('POST', '/email-notifications/test'),
  },
  on: (channel: string, callback: (...args: any[]) => void) => {
    if (isElectron) return (window as any).electronAPI.on(channel, callback);
    if (channel === 'data:realtime') return api.data.onRealtimeData(callback);
    if (LOG_CHANNELS.includes(channel as LogChannel)) return subscribeLogChannel(channel, callback);
    return () => {};
  },
};

export default api;
