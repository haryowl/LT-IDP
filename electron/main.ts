import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseService } from './services/database';
import { ModbusService } from './services/modbus';
import { MqttSubscriberService } from './services/mqttSubscriber';
import { MqttPublisherService } from './services/mqttPublisher';
import { MqttBrokerService } from './services/mqttBroker';
import { HttpClientService } from './services/httpClient';
import { DataMapperService } from './services/dataMapper';
import { AuthService } from './services/auth';
import { SparingService } from './services/sparingService';
import { setupConsoleLogging, getLogger } from './services/logger';
import { getStoredSession, setStoredSession, clearStoredSession } from './services/sessionStore';

// Initialize logger early to capture all logs
setupConsoleLogging();
const logger = getLogger();

// Log startup
logger.info('═══════════════════════════════════════════════════════════');
logger.info('Application starting...');
logger.info(`Log directory: ${logger.getLogDirectory()}`);
logger.info(`Current log file: ${logger.getCurrentLogFile()}`);
logger.info('═══════════════════════════════════════════════════════════');

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtExceptionMonitor', (error) => {
  logger.error('Uncaught Exception Monitor:', error);
});

let mainWindow: BrowserWindow | null = null;

// Services
let dbService: DatabaseService;
let authService: AuthService;
let modbusService: ModbusService;
let mqttSubscriberService: MqttSubscriberService;
let mqttPublisherService: MqttPublisherService;
let mqttBrokerService: MqttBrokerService;
let httpClientService: HttpClientService;
let dataMapperService: DataMapperService;
let sparingService: SparingService;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, loadFile should work correctly with relative paths
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function initializeServices() {
  const dbPath = path.join(app.getPath('userData'), 'scada.db');
  
  dbService = new DatabaseService(dbPath);
  await dbService.initialize();

  authService = new AuthService(dbService);
  modbusService = new ModbusService(dbService);
  mqttSubscriberService = new MqttSubscriberService(dbService);
  mqttPublisherService = new MqttPublisherService(dbService);
  mqttBrokerService = new MqttBrokerService();
  httpClientService = new HttpClientService(dbService);
  dataMapperService = new DataMapperService(dbService);
  sparingService = new SparingService(dbService);

  // Start SPARING scheduler if enabled
  const sparingConfig = sparingService.getSparingConfig();
  if (sparingConfig && sparingConfig.enabled) {
    sparingService.startHourlyScheduler();
    logger.info('SPARING scheduler started');
  }

  // Start MQTT Publisher health check (every 5 minutes)
  setInterval(async () => {
    try {
      const publishers = await dbService.getPublishers();
      for (const publisher of publishers) {
        if (publisher.enabled && publisher.type === 'mqtt') {
          await mqttPublisherService.ensureConnectionHealth(publisher.id);
        }
      }
    } catch (error: any) {
      logger.error('MQTT Publisher health check failed:', error?.message ?? error);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Wire up data flow
  modbusService.on('data', (data: any) => {
    dataMapperService.mapModbusData(data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('modbus:data', data);
    }
  });

  mqttSubscriberService.on('data', (data: any) => {
    logger.info('MQTT Subscriber received data:', { deviceId: data.deviceId, topic: data.topic, data: data.data });
    dataMapperService.mapMqttData(data);
    // Forward to renderer for log terminal
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mqtt:data', data);
    }
  });

  mqttBrokerService.on('data', (data: any) => {
    logger.info('Broker data received, forwarding to mapper:', data);
    dataMapperService.mapMqttData(data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mqtt:data', data);
    }
  });

  mqttPublisherService.on('log', (logData: any) => {
    logger.info('MQTT Publisher log:', logData);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('publisher:log', logData);
    }
  });

  httpClientService.on('log', (logData: any) => {
    logger.info('HTTP Publisher log:', logData);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('publisher:log', logData);
    }
  });

  dataMapperService.on('dataStored', (data: any) => {
    logger.info('[PUBLISHER EVENT] Data stored:', data.mappingId, data.mappingName, data.value, new Date(data.timestamp).toISOString());

    const mqttPublishers = dbService.getPublishers().filter((p: any) => p.enabled && p.type === 'mqtt');
    logger.info('[PUBLISHER] MQTT publishers:', mqttPublishers.length);
    mqttPublishers.forEach((pub: any) => {
      if (pub) {
        mqttPublisherService.publish(pub.id, data).catch((err: any) => {
          logger.error('[PUBLISHER] Failed MQTT publish:', pub.name, err?.message);
        });
      }
    });

    const httpPublishers = dbService.getPublishers().filter((p: any) => p.enabled && p.type === 'http');
    logger.info('[PUBLISHER] HTTP publishers:', httpPublishers.length);
    httpPublishers.forEach((pub: any) => {
      if (pub) {
        httpClientService.publish(pub.id, data).catch((err: any) => {
          logger.error('[PUBLISHER] Failed HTTP publish:', pub.name, err?.message);
        });
      }
    });
  });

  const autoStartPublishers = dbService
    .getPublishers()
    .filter((p: any) => p.enabled && p.autoStart);
  logger.info('Auto-starting publishers:', autoStartPublishers.length);
  for (const pub of autoStartPublishers) {
    try {
      if (pub.type === 'mqtt') {
        await mqttPublisherService.start(pub.id);
        logger.info('Auto-started MQTT publisher:', pub.name);
      } else {
        await httpClientService.start(pub.id);
        logger.info('Auto-started HTTP publisher:', pub.name);
      }
    } catch (error: any) {
      logger.error('Failed to auto-start publisher', pub.name, error?.message);
    }
  }

  const autoModbusDevices = dbService.getModbusDevices().filter((device) => device.enabled && device.autoStart);
  if (autoModbusDevices.length > 0) {
    logger.info('Auto-starting Modbus devices:', autoModbusDevices.length);
    for (const device of autoModbusDevices) {
      try {
        await modbusService.connect(device.id);
        logger.info('Auto-started Modbus device:', device.name);
      } catch (error: any) {
        logger.error('Failed to auto-start Modbus device', device.name, error?.message);
      }
    }
  }

  const autoMqttDevices = dbService.getMqttDevices().filter((device) => device.enabled && device.autoStart);
  if (autoMqttDevices.length > 0) {
    logger.info('Auto-starting MQTT subscriber devices:', autoMqttDevices.length);
    for (const device of autoMqttDevices) {
      try {
        await mqttSubscriberService.connect(device.id);
        logger.info('Auto-started MQTT device:', device.name);
      } catch (error: any) {
        logger.error('Failed to auto-start MQTT device', device.name, error?.message);
      }
    }
  }

  const brokerConfig = dbService.getMqttBrokerConfig();
  if (brokerConfig?.autoStart) {
    try {
      logger.info('Auto-starting MQTT broker...');
      await mqttBrokerService.start(brokerConfig);
      logger.info('MQTT broker auto-started successfully');
    } catch (error: any) {
      logger.error('Failed to auto-start MQTT broker:', error?.message);
    }
  }

  setupIpcHandlers();
}

function setupIpcHandlers() {
  // Authentication
  ipcMain.handle('auth:login', async (_, { username, password }) => {
    const result = await authService.login(username, password);
    if (result?.token && result?.user) {
      setStoredSession({
        token: result.token,
        username: result.user.username,
        role: result.user.role as 'admin' | 'viewer',
      });
    }
    return result;
  });

  ipcMain.handle('auth:logout', async (_, { token }) => {
    authService.logout(token);
    clearStoredSession();
  });

  ipcMain.handle('auth:verify', async (_, { token }) => {
    return authService.verifyToken(token);
  });

  ipcMain.handle('auth:getStoredSession', async () => {
    return getStoredSession();
  });

  ipcMain.handle('users:list', async () => {
    return dbService.getUsers();
  });

  ipcMain.handle('users:create', async (_, user) => {
    return dbService.createUser(user);
  });

  // Modbus Device Management
  ipcMain.handle('modbus:devices:list', async () => {
    return dbService.getModbusDevices();
  });

  ipcMain.handle('modbus:devices:create', async (_, device) => {
    return dbService.createModbusDevice(device);
  });

  ipcMain.handle('modbus:devices:update', async (_, { id, device }) => {
    return dbService.updateModbusDevice(id, device);
  });

  ipcMain.handle('modbus:devices:delete', async (_, id) => {
    return dbService.deleteModbusDevice(id);
  });

  // Modbus Register Management
  ipcMain.handle('modbus:registers:list', async (_, deviceId) => {
    return dbService.getModbusRegisters(deviceId);
  });

  ipcMain.handle('modbus:registers:create', async (_, register) => {
    const created = dbService.createModbusRegister(register);
    const updatedRegisters = dbService.getModbusRegisters(register.deviceId!);
    modbusService.updateDeviceRegisters(register.deviceId!, updatedRegisters);
    return created;
  });

  ipcMain.handle('modbus:registers:update', async (_, { id, register }) => {
    const existing = dbService.getModbusRegisterById(id);
    dbService.updateModbusRegister(id, register);
    const deviceId = register.deviceId || (register as any)?.device_id || existing?.deviceId;
    if (deviceId) {
      const updatedRegisters = dbService.getModbusRegisters(deviceId);
      modbusService.updateDeviceRegisters(deviceId, updatedRegisters);
    }
  });

  ipcMain.handle('modbus:registers:delete', async (_, id) => {
    const existing = dbService.getModbusRegisterById(id);
    dbService.deleteModbusRegister(id);
    if (existing?.deviceId) {
      const updatedRegisters = dbService.getModbusRegisters(existing.deviceId);
      modbusService.updateDeviceRegisters(existing.deviceId, updatedRegisters);
    }
  });

  ipcMain.handle('modbus:connect', async (_, deviceId) => {
    return modbusService.connect(deviceId);
  });

  ipcMain.handle('modbus:disconnect', async (_, deviceId) => {
    return modbusService.disconnect(deviceId);
  });

  ipcMain.handle('modbus:status', async () => {
    return modbusService.getConnectionStatus();
  });

  ipcMain.handle('modbus:listSerialPorts', async () => {
    const { SerialPort } = await import('serialport');
    const ports = await SerialPort.list();
    return ports.map((p: any) => ({ path: p.path, manufacturer: p.manufacturer, serialNumber: p.serialNumber }));
  });

  // MQTT Device Management
  ipcMain.handle('mqtt:devices:list', async () => {
    return dbService.getMqttDevices();
  });

  ipcMain.handle('mqtt:devices:create', async (_, device) => {
    return dbService.createMqttDevice(device);
  });

  ipcMain.handle('mqtt:devices:update', async (_, { id, device }) => {
    return dbService.updateMqttDevice(id, device);
  });

  ipcMain.handle('mqtt:devices:delete', async (_, id) => {
    return dbService.deleteMqttDevice(id);
  });

  ipcMain.handle('mqtt:connect', async (_, deviceId) => {
    return mqttSubscriberService.connect(deviceId);
  });

  ipcMain.handle('mqtt:disconnect', async (_, deviceId) => {
    return mqttSubscriberService.disconnect(deviceId);
  });

  ipcMain.handle('mqtt:status', async () => {
    return mqttSubscriberService.getConnectionStatus();
  });

  // MQTT Broker Management
  ipcMain.handle('mqtt:broker:get', async () => {
    return dbService.getMqttBrokerConfig();
  });

  ipcMain.handle('mqtt:broker:save', async (_, config) => {
    const existing = dbService.getMqttBrokerConfig();
    if (existing) {
      dbService.updateMqttBrokerConfig(existing.id, config);
      return { ...existing, ...config };
    } else {
      return dbService.createMqttBrokerConfig(config);
    }
  });

  ipcMain.handle('mqtt:broker:start', async () => {
    try {
      let config = dbService.getMqttBrokerConfig();
      if (!config) {
        // Create default configuration if none exists
        config = dbService.createMqttBrokerConfig({
          name: 'Local MQTT Broker',
          enabled: true,
          port: 11883, // Using 11883 instead of 1883 to avoid Windows port reservation issues
          wsPort: 19001, // Using 19001 instead of 9001 to avoid conflicts
          allowAnonymous: true,
          useTls: false,
          maxConnections: 100,
          retainedMessages: true,
          persistenceEnabled: true,
          logLevel: 'warning',
        });
      } else if (config.port === 1883 || config.port === 9001) {
        // Migrate old port to new port to avoid Windows port reservation issues
        logger.info('Migrating MQTT broker port from 1883 to 11883...');
        dbService.updateMqttBrokerConfig(config.id, {
          port: 11883,
          wsPort: 19001,
        });
        config = dbService.getMqttBrokerConfig()!;
      }
      dbService.getOrCreateLocalBrokerDevice();
      logger.info('Starting MQTT broker...');
      await mqttBrokerService.start(config);
      logger.info('MQTT broker started successfully');
      return { success: true };
    } catch (error: any) {
      logger.error('Error starting MQTT broker:', error?.message ?? error);
      // Forward detailed error to renderer
      throw new Error(error.message || 'Failed to start MQTT broker');
    }
  });

  ipcMain.handle('mqtt:broker:stop', async () => {
    await mqttBrokerService.stop();
    return { success: true };
  });

  ipcMain.handle('mqtt:broker:status', async () => {
    return mqttBrokerService.getStatus();
  });

  ipcMain.handle('mqtt:broker:check-installed', async () => {
    return mqttBrokerService.isMosquittoInstalled();
  });

  // Parameter Mapping
  ipcMain.handle('mappings:list', async () => {
    return dbService.getParameterMappings();
  });

  ipcMain.handle('mappings:create', async (_, mapping) => {
    const result = dbService.createParameterMapping(mapping);
    // Reload mappings in the data mapper service
    dataMapperService.reloadMappings();
    return result;
  });

  ipcMain.handle('mappings:update', async (_, { id, mapping }) => {
    dbService.updateParameterMapping(id, mapping);
    // Reload mappings in the data mapper service
    dataMapperService.reloadMappings();
  });

  ipcMain.handle('mappings:delete', async (_, id) => {
    dbService.deleteParameterMapping(id);
    // Reload mappings in the data mapper service
    dataMapperService.reloadMappings();
  });

  // Historical Data
  ipcMain.handle('data:query', async (_, { startTime, endTime, mappingIds }) => {
    return dbService.queryHistoricalData(startTime, endTime, mappingIds);
  });

  ipcMain.handle('data:export', async (_, { startTime, endTime, mappingIds, format }) => {
    return dbService.exportData(startTime, endTime, mappingIds, format);
  });

  ipcMain.handle('data:realtime:subscribe', async (_, mappingIds: string[]) => {
    // Setup real-time data streaming
    dataMapperService.onDataMapped((data: any) => {
      if (mappingIds.length === 0 || mappingIds.includes(data.mappingId)) {
        mainWindow?.webContents.send('data:realtime', data);
      }
    });
  });

  // Publisher Configuration
  ipcMain.handle('publishers:list', async () => {
    return dbService.getPublishers();
  });

  ipcMain.handle('publishers:create', async (_, publisher) => {
    return dbService.createPublisher(publisher);
  });

  ipcMain.handle('publishers:update', async (_, { id, publisher }) => {
    dbService.updatePublisher(id, publisher);
    const updated = dbService.getPublisherById(id);
    if (updated) {
      if (updated.type === 'mqtt') {
        mqttPublisherService.refreshPublisher(updated.id);
      } else if (updated.type === 'http') {
        httpClientService.refreshPublisher(updated.id);
      }
    }
    return updated;
  });

  ipcMain.handle('publishers:delete', async (_, id) => {
    return dbService.deletePublisher(id);
  });

  ipcMain.handle('publishers:toggle', async (_, { id, enabled }) => {
    const publisher = dbService.getPublisherById(id);
    if (!publisher) {
      throw new Error('Publisher not found');
    }

    // Update database first
    dbService.togglePublisher(id, enabled);

    // Then start/stop the service
    if (enabled) {
      if (publisher.type === 'mqtt') {
        await mqttPublisherService.start(id);
      } else {
        await httpClientService.start(id);
      }
    } else {
      if (publisher.type === 'mqtt') {
        await mqttPublisherService.stop(id);
      } else {
        await httpClientService.stop(id);
      }
    }
    
    return dbService.getPublisherById(id);
  });

  // System Configuration
  ipcMain.handle('system:getClientId', async () => {
    return dbService.getClientId();
  });

  ipcMain.handle('system:setClientId', async (_, clientId) => {
    dbService.setClientId(clientId);
    return { success: true };
  });

  ipcMain.handle('system:getTimestampInterval', async () => {
    return dbService.getSystemTimestampInterval();
  });

  ipcMain.handle('system:setTimestampInterval', async (_, seconds: number) => {
    dbService.setSystemTimestampInterval(seconds);
    dataMapperService.setSystemTimestampInterval(seconds);
    return { success: true };
  });

  ipcMain.handle('system:getLocalIp', async () => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        // Skip internal (loopback) and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }
    
    return addresses.length > 0 ? addresses[0] : 'localhost';
  });

  ipcMain.handle('system:getLogDirectory', async () => {
    return logger.getLogDirectory();
  });

  ipcMain.handle('system:getCurrentLogFile', async () => {
    return logger.getCurrentLogFile();
  });

  // ============================================================================
  // SPARING IPC Handlers
  // ============================================================================

  // Configuration
  ipcMain.handle('sparing:getConfig', async () => {
    return sparingService.getSparingConfig();
  });

  ipcMain.handle('sparing:updateConfig', async (_, config) => {
    const updated = sparingService.upsertSparingConfig(config);
    
    // Restart schedulers based on enabled, send_mode, or retry settings changes
    const needsRestart = 
      config.enabled !== undefined || 
      config.sendMode !== undefined || 
      config.retryIntervalMinutes !== undefined;
    
    if (needsRestart) {
      sparingService.stopHourlyScheduler();
      if (updated.enabled) {
        if (updated.sendMode === 'hourly' || updated.sendMode === 'both') {
          sparingService.startHourlyScheduler();
        }
        if (updated.sendMode === '2min' || updated.sendMode === 'both') {
          sparingService.startTwoMinScheduler();
        }
      }
    }
    
    return updated;
  });

  ipcMain.handle('sparing:fetchApiSecret', async () => {
    return await sparingService.fetchApiSecret();
  });

  // Parameter Mappings
  ipcMain.handle('sparing:getMappings', async () => {
    return sparingService.getSparingMappings();
  });

  ipcMain.handle('sparing:upsertMapping', async (_, sparingParam, mappingId) => {
    return sparingService.upsertSparingMapping(sparingParam, mappingId);
  });

  ipcMain.handle('sparing:deleteMapping', async (_, id) => {
    sparingService.deleteSparingMapping(id);
    return { success: true };
  });

  // Logs
  ipcMain.handle('sparing:getLogs', async (_, limit) => {
    return sparingService.getSparingLogs(limit || 50);
  });

  // Queue Management
  ipcMain.handle('sparing:processQueue', async () => {
    await sparingService.processQueue();
    return { success: true };
  });

  ipcMain.handle('sparing:getQueueItems', async (_, limit) => {
    return sparingService.getQueueItems(limit || 100);
  });

  // Manual Send (for testing)
  ipcMain.handle('sparing:sendNow', async (_, hourTimestamp) => {
    await sparingService.sendNow(hourTimestamp);
    return { success: true };
  });

  // Status
  ipcMain.handle('sparing:getStatus', async () => {
    const cfg = sparingService.getSparingConfig();
    const queueDepth = sparingService.getQueueDepth?.() ?? 0;
    const nextRuns = sparingService.getNextRunTimes?.() ?? {};
    return {
      enabled: cfg?.enabled ?? false,
      sendMode: cfg?.sendMode ?? 'hourly',
      lastHourlySend: cfg?.lastHourlySend ?? null,
      last2MinSend: (cfg as any)?.last2MinSend ?? null,
      queueDepth,
      nextRuns,
    };
  });
}

app.whenReady().then(async () => {
  await initializeServices();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Cleanup services
  modbusService?.cleanup();
  mqttSubscriberService?.cleanup();
  mqttPublisherService?.cleanup();
  httpClientService?.cleanup();
  sparingService?.stopHourlyScheduler();
  dbService?.close();
  logger.cleanup();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Ensure all services are properly closed
  modbusService?.cleanup();
  mqttSubscriberService?.cleanup();
  mqttPublisherService?.cleanup();
  httpClientService?.cleanup();
  dbService?.close();
  logger.cleanup();
});

