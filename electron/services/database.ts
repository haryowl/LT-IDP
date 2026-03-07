import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import type {
  User,
  ModbusDevice,
  ModbusRegister,
  MqttDevice,
  ParameterMapping,
  Publisher,
  MqttBrokerConfig,
  HistoricalData,
  BufferItem,
  RealtimeData,
} from '../types';

export class DatabaseService {
  private db: Database.Database;
  private dbPath: string;
  private exportDir: string;
  private parameterMappingsSchemaChecked = false;

  constructor(dbPath: string, exportDir?: string) {
    this.dbPath = dbPath;
    this.exportDir = exportDir ?? path.join(path.dirname(dbPath), 'exports');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = OFF'); // Disable foreign keys to avoid migration issues
  }

  // Expose database for direct queries (used by SparingService)
  getDb(): Database.Database {
    return this.db;
  }

  async initialize(): Promise<void> {
    try {
      this.createTables();
      await this.createDefaultUser();
    } catch (error: any) {
      if (error.message?.includes('parameter_mappings_old') || error.message?.includes('no such table')) {
        console.log('🔧 Database corruption detected, recreating database...');
        this.recreateDatabase();
        this.createTables();
        await this.createDefaultUser();
        console.log('✅ Database recreated successfully');
      } else {
        throw error;
      }
    }
  }

  recreateDatabase(): void {
    try {
      // Close current connection
      this.db.close();
      // Delete the corrupted database file
      if (fs.existsSync(this.dbPath)) {
        fs.unlinkSync(this.dbPath);
        console.log('✅ Removed corrupted database file');
      }
      // Create new database
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = OFF');
      console.log('✅ Created new database');
    } catch (error: any) {
      console.error('❌ Error recreating database:', error);
      throw error;
    }
  }

  createTables(): void {
    // Users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'viewer')),
        created_at INTEGER NOT NULL
      )
    `);

    // Modbus devices table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS modbus_devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('tcp', 'rtu')),
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_start INTEGER NOT NULL DEFAULT 0,
        host TEXT,
        port INTEGER,
        serial_port TEXT,
        baud_rate INTEGER,
        data_bits INTEGER,
        stop_bits INTEGER,
        parity TEXT,
        slave_id INTEGER NOT NULL,
        poll_interval INTEGER NOT NULL,
        record_interval INTEGER NOT NULL DEFAULT 5000,
        timeout INTEGER NOT NULL,
        retry_attempts INTEGER NOT NULL DEFAULT 3,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Add record_interval column to existing tables if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE modbus_devices ADD COLUMN record_interval INTEGER DEFAULT 5000`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    try {
      this.db.exec(`ALTER TABLE modbus_devices ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    // Add parameter_id column to parameter_mappings table
    try {
      this.db.exec(`ALTER TABLE parameter_mappings ADD COLUMN parameter_id TEXT`);
      console.log('Added parameter_id column to parameter_mappings table');
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    // Add unique index for parameter_id
    try {
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_parameter_id ON parameter_mappings(parameter_id) WHERE parameter_id IS NOT NULL`);
      console.log('Created unique index for parameter_id');
    } catch (error: any) {
      console.warn('Index creation warning:', error.message);
    }

    // Clean up any leftover migration tables and fix database schema
    try {
      this.db.exec('DROP TABLE IF EXISTS parameter_mappings_old');
      console.log('Cleaned up any leftover migration tables');
      // Check and fix historical_data table if it has foreign key issues
      try {
        this.db.prepare('SELECT COUNT(*) FROM historical_data LIMIT 1').get();
        console.log('✅ historical_data table is working properly');
      } catch (error: any) {
        if (error.message?.includes('parameter_mappings_old')) {
          console.log('🔧 Fixing historical_data table foreign key constraint...');
          this.db.exec('DROP TABLE IF EXISTS historical_data');
          this.db.exec(`
            CREATE TABLE historical_data (
              id TEXT PRIMARY KEY,
              mapping_id TEXT NOT NULL,
              timestamp INTEGER NOT NULL,
              value TEXT NOT NULL,
              quality TEXT NOT NULL
            )
          `);
          console.log('✅ Recreated historical_data table without foreign key constraint');
        }
      }
    } catch (error: any) {
      console.warn('Cleanup warning:', error.message);
    }

    // Add timestamp configuration columns to parameter_mappings table
    try {
      this.db.exec(`ALTER TABLE parameter_mappings ADD COLUMN input_format TEXT`);
      console.log('Added input_format column');
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    try {
      this.db.exec(`ALTER TABLE parameter_mappings ADD COLUMN input_timezone TEXT`);
      console.log('Added input_timezone column');
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    try {
      this.db.exec(`ALTER TABLE parameter_mappings ADD COLUMN output_format TEXT`);
      console.log('Added output_format column');
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    try {
      this.db.exec(`ALTER TABLE parameter_mappings ADD COLUMN output_timezone TEXT`);
      console.log('Added output_timezone column');
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    // Add JSON format columns to publishers table
    try {
      this.db.exec(`ALTER TABLE publishers ADD COLUMN json_format TEXT DEFAULT 'simple'`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    try {
      this.db.exec(`ALTER TABLE publishers ADD COLUMN custom_json_template TEXT`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    // System configuration table for global settings like Client ID
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_config (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Modbus registers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS modbus_registers (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        name TEXT NOT NULL,
        function_code INTEGER NOT NULL,
        address INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        data_type TEXT NOT NULL,
        byte_order TEXT,
        word_order TEXT,
        scale_factor REAL,
        offset REAL,
        unit TEXT,
        FOREIGN KEY (device_id) REFERENCES modbus_devices(id) ON DELETE CASCADE
      )
    `);

    // MQTT Broker configuration table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mqtt_broker_config (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        auto_start INTEGER NOT NULL DEFAULT 0,
        port INTEGER NOT NULL DEFAULT 1883,
        ws_port INTEGER,
        allow_anonymous INTEGER NOT NULL DEFAULT 1,
        username TEXT,
        password TEXT,
        use_tls INTEGER NOT NULL DEFAULT 0,
        tls_cert TEXT,
        tls_key TEXT,
        tls_ca TEXT,
        max_connections INTEGER NOT NULL DEFAULT 100,
        retained_messages INTEGER NOT NULL DEFAULT 1,
        persistence_enabled INTEGER NOT NULL DEFAULT 1,
        log_level TEXT NOT NULL DEFAULT 'warning',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    try {
      this.db.exec(`ALTER TABLE mqtt_broker_config ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    // MQTT devices table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mqtt_devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_start INTEGER NOT NULL DEFAULT 0,
        broker TEXT NOT NULL,
        port INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        client_id TEXT NOT NULL,
        username TEXT,
        password TEXT,
        qos INTEGER NOT NULL,
        topics TEXT NOT NULL,
        use_tls INTEGER NOT NULL DEFAULT 0,
        tls_cert TEXT,
        tls_key TEXT,
        tls_ca TEXT,
        reject_unauthorized INTEGER DEFAULT 1,
        keep_alive INTEGER NOT NULL DEFAULT 60,
        reconnect_period INTEGER NOT NULL DEFAULT 1000,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    try {
      this.db.exec(`ALTER TABLE mqtt_devices ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    // Parameter mappings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS parameter_mappings (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parameter_id TEXT,
        description TEXT,
        source_type TEXT NOT NULL CHECK(source_type IN ('modbus', 'mqtt', 'system')),
        source_device_id TEXT NOT NULL,
        register_id TEXT,
        topic TEXT,
        json_path TEXT,
        mapped_name TEXT NOT NULL,
        unit TEXT,
        data_type TEXT NOT NULL,
        input_format TEXT,
        input_timezone TEXT,
        output_format TEXT,
        output_timezone TEXT,
        transform_expression TEXT,
        store_history INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.ensureParameterMappingsSchema();

    // Historical data table (time-series optimized)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS historical_data (
        id TEXT PRIMARY KEY,
        mapping_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        value TEXT NOT NULL,
        quality TEXT NOT NULL CHECK(quality IN ('good', 'bad', 'uncertain'))
      )
    `);

    // Create indices for time-series queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_historical_timestamp 
      ON historical_data(timestamp);
      
      CREATE INDEX IF NOT EXISTS idx_historical_mapping_timestamp 
      ON historical_data(mapping_id, timestamp);
    `);

    // Publishers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS publishers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('mqtt', 'http')),
        enabled INTEGER NOT NULL DEFAULT 0,
        auto_start INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL CHECK(mode IN ('realtime', 'buffer', 'both')),
        mqtt_broker TEXT,
        mqtt_port INTEGER,
        mqtt_protocol TEXT,
        mqtt_topic TEXT,
        mqtt_qos INTEGER,
        mqtt_username TEXT,
        mqtt_password TEXT,
        mqtt_use_tls INTEGER,
        http_url TEXT,
        http_method TEXT,
        http_headers TEXT,
        use_jwt INTEGER,
        jwt_token TEXT,
        jwt_header TEXT,
        buffer_size INTEGER,
        buffer_flush_interval INTEGER,
        retry_attempts INTEGER,
        retry_delay INTEGER,
        mapping_ids TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    try {
      this.db.exec(`ALTER TABLE publishers ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    // Scheduled publishing fields
    try {
      this.db.exec(`ALTER TABLE publishers ADD COLUMN scheduled_enabled INTEGER NOT NULL DEFAULT 0`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    try {
      this.db.exec(`ALTER TABLE publishers ADD COLUMN scheduled_interval INTEGER`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    try {
      this.db.exec(`ALTER TABLE publishers ADD COLUMN scheduled_interval_unit TEXT`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning:', error.message);
      }
    }

    // Buffer queue table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS buffer_queue (
        id TEXT PRIMARY KEY,
        publisher_id TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt INTEGER,
        status TEXT NOT NULL CHECK(status IN ('pending', 'failed', 'sent')),
        FOREIGN KEY (publisher_id) REFERENCES publishers(id) ON DELETE CASCADE
      )
    `);

    // Create index for buffer queue processing
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_buffer_status_timestamp 
      ON buffer_queue(status, timestamp);
    `);

    // SPARING Configuration table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sparing_config (
        id TEXT PRIMARY KEY,
        logger_id TEXT NOT NULL,
        api_base TEXT,
        api_secret_url TEXT,
        api_send_hourly_url TEXT,
        api_send_2min_url TEXT,
        api_testing_url TEXT,
        api_secret TEXT,
        api_secret_fetched_at INTEGER,
        enabled INTEGER NOT NULL DEFAULT 0,
        send_mode TEXT NOT NULL DEFAULT 'hourly' CHECK(send_mode IN ('hourly', '2min', 'both')),
        last_hourly_send INTEGER,
        last_2min_send INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // SPARING Parameter Mappings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sparing_mappings (
        id TEXT PRIMARY KEY,
        sparing_param TEXT NOT NULL,
        mapping_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      )
    `);

    // Migrations for sparing_config new columns
    try {
      this.db.exec(`ALTER TABLE sparing_config ADD COLUMN last_2min_send INTEGER`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning (sparing_config.last_2min_send):', error.message);
      }
    }
    try {
      this.db.exec(`ALTER TABLE sparing_config ADD COLUMN api_base TEXT`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning (sparing_config.api_base):', error.message);
      }
    }
    try {
      this.db.exec(`ALTER TABLE sparing_config ADD COLUMN api_secret_url TEXT`);
      this.db.exec(`ALTER TABLE sparing_config ADD COLUMN api_send_hourly_url TEXT`);
      this.db.exec(`ALTER TABLE sparing_config ADD COLUMN api_send_2min_url TEXT`);
      this.db.exec(`ALTER TABLE sparing_config ADD COLUMN api_testing_url TEXT`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning (sparing_config.api_*_url):', error.message);
      }
    }

    // Retry configuration fields
    try {
      this.db.exec(`ALTER TABLE sparing_config ADD COLUMN retry_max_attempts INTEGER`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning (sparing_config.retry_max_attempts):', error.message);
      }
    }

    try {
      this.db.exec(`ALTER TABLE sparing_config ADD COLUMN retry_interval_minutes INTEGER`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('Database migration warning (sparing_config.retry_interval_minutes):', error.message);
      }
    }
    // SPARING Send Queue table (for retry logic)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sparing_queue (
        id TEXT PRIMARY KEY,
        send_type TEXT NOT NULL CHECK(send_type IN ('hourly', '2min', 'testing')),
        hour_timestamp INTEGER NOT NULL,
        payload TEXT NOT NULL,
        records_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        sent_at INTEGER
      )
    `);

    // SPARING Send Logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sparing_logs (
        id TEXT PRIMARY KEY,
        send_type TEXT NOT NULL CHECK(send_type IN ('hourly', '2min', 'testing')),
        hour_timestamp INTEGER,
        records_count INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
        response TEXT,
        duration_ms INTEGER,
        timestamp INTEGER NOT NULL
      )
    `);

    // Create indices for SPARING tables
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sparing_queue_status 
      ON sparing_queue(status, hour_timestamp);
      
      CREATE INDEX IF NOT EXISTS idx_sparing_logs_timestamp 
      ON sparing_logs(timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_sparing_mappings_param 
      ON sparing_mappings(sparing_param);
    `);
  }

  async createDefaultUser(): Promise<void> {
    const existingUser = this.db.prepare('SELECT id FROM users LIMIT 1').get();
    if (!existingUser) {
      const hashedPassword = await bcrypt.hash('admin', 10);
      this.db
        .prepare('INSERT INTO users (id, username, password, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), 'admin', hashedPassword, 'admin', Date.now());
    }
  }

  // User operations
  getUsers(): User[] {
    return this.db
      .prepare('SELECT id, username, role, created_at as createdAt FROM users')
      .all() as User[];
  }

  getUserByUsername(username: string): any {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row) return undefined;
    return {
      ...row,
      createdAt: (row as any).created_at,
    };
  }

  async createUser(user: { username: string; password: string; role: 'admin' | 'viewer' }): Promise<User> {
    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(user.password, 10);
    const createdAt = Date.now();
    this.db
      .prepare('INSERT INTO users (id, username, password, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, user.username, hashedPassword, user.role, createdAt);
    return { id, username: user.username, role: user.role, createdAt };
  }

  // Modbus Device operations
  getModbusDevices(): ModbusDevice[] {
    const rows = this.db.prepare('SELECT * FROM modbus_devices ORDER BY created_at DESC').all();
    return rows.map((row) => this.rowToModbusDevice(row as any));
  }

  getModbusDeviceById(id: string): ModbusDevice | undefined {
    const row = this.db.prepare('SELECT * FROM modbus_devices WHERE id = ?').get(id);
    return row ? this.rowToModbusDevice(row as any) : undefined;
  }

  createModbusDevice(device: Partial<ModbusDevice>): ModbusDevice {
    const id = uuidv4();
    const now = Date.now();
    this.db
      .prepare(`
        INSERT INTO modbus_devices (
          id, name, type, enabled, auto_start, host, port, serial_port, baud_rate,
          data_bits, stop_bits, parity, slave_id, poll_interval, record_interval, timeout,
          retry_attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        device.name,
        device.type,
        device.enabled ? 1 : 0,
        device.autoStart ? 1 : 0,
        device.host,
        device.port,
        device.serialPort,
        device.baudRate,
        device.dataBits,
        device.stopBits,
        device.parity,
        device.slaveId,
        device.pollInterval,
        device.recordInterval || 5000,
        device.timeout,
        device.retryAttempts,
        now,
        now
      );
    return {
      ...device,
      id,
      createdAt: now,
      updatedAt: now,
      autoStart: !!device.autoStart,
    } as ModbusDevice;
  }

  updateModbusDevice(id: string, device: Partial<ModbusDevice>): void {
    const updates: string[] = [];
    const values: any[] = [];
    Object.entries(device).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'createdAt') {
        const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        updates.push(`${snakeKey} = ?`);
        if (typeof value === 'boolean') {
          values.push(value ? 1 : 0);
        } else {
          values.push(value);
        }
      }
    });
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      this.db.prepare(`UPDATE modbus_devices SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  deleteModbusDevice(id: string): void {
    this.db.prepare('DELETE FROM modbus_devices WHERE id = ?').run(id);
  }

  // Modbus Register operations
  getModbusRegisters(deviceId: string): ModbusRegister[] {
    const rows = this.db.prepare('SELECT * FROM modbus_registers WHERE device_id = ?').all(deviceId);
    return rows.map((row) => this.rowToModbusRegister(row as any));
  }

  createModbusRegister(register: Partial<ModbusRegister>): ModbusRegister {
    const id = uuidv4();
    this.db
      .prepare(`
        INSERT INTO modbus_registers (
          id, device_id, name, function_code, address, quantity, data_type,
          byte_order, word_order, scale_factor, offset, unit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        register.deviceId,
        register.name,
        register.functionCode,
        register.address,
        register.quantity,
        register.dataType,
        register.byteOrder,
        register.wordOrder,
        register.scaleFactor,
        register.offset,
        register.unit
      );
    return { ...register, id } as ModbusRegister;
  }

  updateModbusRegister(id: string, register: Partial<ModbusRegister>): void {
    const updates: string[] = [];
    const values: any[] = [];
    Object.entries(register).forEach(([key, value]) => {
      if (key !== 'id') {
        const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        updates.push(`${snakeKey} = ?`);
        values.push(value);
      }
    });
    if (updates.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE modbus_registers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  deleteModbusRegister(id: string): void {
    this.db.prepare('DELETE FROM modbus_registers WHERE id = ?').run(id);
  }

  getModbusRegisterById(id: string): ModbusRegister | undefined {
    const row = this.db.prepare('SELECT * FROM modbus_registers WHERE id = ?').get(id);
    return row ? this.rowToModbusRegister(row as any) : undefined;
  }

  // MQTT Device operations
  getMqttDevices(): MqttDevice[] {
    const rows = this.db.prepare('SELECT * FROM mqtt_devices ORDER BY created_at DESC').all();
    return rows.map((row) => this.rowToMqttDevice(row as any));
  }

  getMqttDeviceById(id: string): MqttDevice | undefined {
    const row = this.db.prepare('SELECT * FROM mqtt_devices WHERE id = ?').get(id);
    return row ? this.rowToMqttDevice(row as any) : undefined;
  }

  createMqttDevice(device: Partial<MqttDevice>): MqttDevice {
    const id = uuidv4();
    const now = Date.now();
    this.db
      .prepare(`
        INSERT INTO mqtt_devices (
          id, name, enabled, auto_start, broker, port, protocol, client_id, username, password,
          qos, topics, use_tls, tls_cert, tls_key, tls_ca, reject_unauthorized,
          keep_alive, reconnect_period, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        device.name,
        device.enabled ? 1 : 0,
        device.autoStart ? 1 : 0,
        device.broker,
        device.port,
        device.protocol,
        device.clientId,
        device.username,
        device.password,
        device.qos,
        JSON.stringify(device.topics),
        device.useTls ? 1 : 0,
        device.tlsCert,
        device.tlsKey,
        device.tlsCa,
        device.rejectUnauthorized ? 1 : 0,
        device.keepAlive,
        device.reconnectPeriod,
        now,
        now
      );
    return {
      ...device,
      id,
      createdAt: now,
      updatedAt: now,
      autoStart: !!device.autoStart,
    } as MqttDevice;
  }

  updateMqttDevice(id: string, device: Partial<MqttDevice>): void {
    const updates: string[] = [];
    const values: any[] = [];
    Object.entries(device).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'createdAt') {
        const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        if (key === 'topics') {
          updates.push(`${snakeKey} = ?`);
          values.push(JSON.stringify(value));
        } else {
          updates.push(`${snakeKey} = ?`);
          if (typeof value === 'boolean') {
            values.push(value ? 1 : 0);
          } else {
            values.push(value);
          }
        }
      }
    });
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      this.db.prepare(`UPDATE mqtt_devices SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  deleteMqttDevice(id: string): void {
    this.db.prepare('DELETE FROM mqtt_devices WHERE id = ?').run(id);
  }

  /**
   * Get or create a virtual MQTT device for the local broker
   * This device is used for parameter mappings but doesn't create an actual connection
   */
  getOrCreateLocalBrokerDevice(): MqttDevice {
    const VIRTUAL_DEVICE_ID = 'local-broker-virtual';
    let device = this.getMqttDeviceById(VIRTUAL_DEVICE_ID);
    if (!device) {
      const now = Date.now();
      this.db
        .prepare(`
          INSERT INTO mqtt_devices (
          id, name, enabled, auto_start, broker, port, protocol, client_id, qos,
            topics, use_tls, keep_alive, reconnect_period, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          VIRTUAL_DEVICE_ID,
          'Local MQTT Broker (Internal)',
          0,
        0,
          '127.0.0.1',
          11883,
          'mqtt',
          'local-broker-internal',
          0,
          JSON.stringify(['#']),
          0,
          60,
          1000,
          now,
          now
        );
      device = this.getMqttDeviceById(VIRTUAL_DEVICE_ID);
      console.log('Created virtual local broker device for parameter mappings');
    }
    return device!;
  }

  // MQTT Broker operations
  getMqttBrokerConfig(): MqttBrokerConfig | undefined {
    const row = this.db.prepare('SELECT * FROM mqtt_broker_config ORDER BY created_at DESC LIMIT 1').get();
    return row ? this.rowToMqttBrokerConfig(row as any) : undefined;
  }

  createMqttBrokerConfig(config: Partial<MqttBrokerConfig>): MqttBrokerConfig {
    const id = uuidv4();
    const now = Date.now();
    this.db
      .prepare(`
        INSERT INTO mqtt_broker_config (
          id, name, enabled, auto_start, port, ws_port, allow_anonymous, username, password,
          use_tls, tls_cert, tls_key, tls_ca, max_connections, retained_messages,
          persistence_enabled, log_level, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        config.name,
        config.enabled ? 1 : 0,
        config.autoStart ? 1 : 0,
        config.port,
        config.wsPort,
        config.allowAnonymous ? 1 : 0,
        config.username,
        config.password,
        config.useTls ? 1 : 0,
        config.tlsCert,
        config.tlsKey,
        config.tlsCa,
        config.maxConnections,
        config.retainedMessages ? 1 : 0,
        config.persistenceEnabled ? 1 : 0,
        config.logLevel,
        now,
        now
      );
    return { ...config, id, createdAt: now, updatedAt: now, autoStart: !!config.autoStart } as MqttBrokerConfig;
  }

  updateMqttBrokerConfig(id: string, config: Partial<MqttBrokerConfig>): void {
    const updates: string[] = [];
    const values: any[] = [];
    Object.entries(config).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'createdAt') {
        const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        updates.push(`${snakeKey} = ?`);
        if (typeof value === 'boolean') {
          values.push(value ? 1 : 0);
        } else {
          values.push(value);
        }
      }
    });
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      this.db.prepare(`UPDATE mqtt_broker_config SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  deleteMqttBrokerConfig(id: string): void {
    this.db.prepare('DELETE FROM mqtt_broker_config WHERE id = ?').run(id);
  }

  // Parameter Mapping operations
  getParameterMappings(): ParameterMapping[] {
    const rows = this.db.prepare('SELECT * FROM parameter_mappings ORDER BY created_at DESC').all();
    return rows.map((row) => this.rowToParameterMapping(row as any));
  }

  getParameterMappingById(id: string): ParameterMapping | undefined {
    const row = this.db.prepare('SELECT * FROM parameter_mappings WHERE id = ?').get(id);
    return row ? this.rowToParameterMapping(row as any) : undefined;
  }

  createParameterMapping(mapping: Partial<ParameterMapping>): ParameterMapping {
    this.ensureParameterMappingsSchema();
    const id = uuidv4();
    const now = Date.now();
    const parameterId = mapping.parameterId?.trim() || null;
    const inputFormat = mapping.inputFormat?.trim() || null;
    const inputTimezone = mapping.inputTimezone?.trim() || null;
    const outputFormat = mapping.outputFormat?.trim() || null;
    const outputTimezone = mapping.outputTimezone?.trim() || null;
    const sourceDeviceId =
      mapping.sourceType === 'system'
        ? mapping.sourceDeviceId || 'system-timestamp'
        : mapping.sourceDeviceId;

    // Validate parameterId uniqueness if provided
    if (parameterId) {
      const existing = this.db.prepare('SELECT id FROM parameter_mappings WHERE parameter_id = ?').get(parameterId);
      if (existing) {
        throw new Error(`Parameter ID "${parameterId}" already exists. Please use a unique ID.`);
      }
    }

    this.db
      .prepare(`
        INSERT INTO parameter_mappings (
          id, name, parameter_id, description, source_type, source_device_id, register_id,
          topic, json_path, mapped_name, unit, data_type, input_format, input_timezone,
          output_format, output_timezone, transform_expression, store_history, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        mapping.name,
        parameterId,
        mapping.description,
        mapping.sourceType,
        sourceDeviceId,
        mapping.registerId,
        mapping.topic,
        mapping.jsonPath,
        mapping.mappedName,
        mapping.unit,
        mapping.dataType,
        inputFormat,
        inputTimezone,
        outputFormat,
        outputTimezone,
        mapping.transformExpression,
        mapping.storeHistory ? 1 : 0,
        now,
        now
      );
    return { ...mapping, id, createdAt: now, updatedAt: now } as ParameterMapping;
  }

  updateParameterMapping(id: string, mapping: Partial<ParameterMapping>): void {
    this.ensureParameterMappingsSchema();

    const processed: Partial<ParameterMapping> = { ...mapping };

    if (processed.parameterId !== undefined) {
      const trimmed = processed.parameterId?.trim() || '';
      processed.parameterId = trimmed.length > 0 ? trimmed : undefined;
    }
    if (processed.inputFormat !== undefined) {
      const trimmed = processed.inputFormat?.trim() || '';
      processed.inputFormat = trimmed.length > 0 ? trimmed : undefined;
    }
    if (processed.inputTimezone !== undefined) {
      const trimmed = processed.inputTimezone?.trim() || '';
      processed.inputTimezone = trimmed.length > 0 ? trimmed : undefined;
    }
    if (processed.outputFormat !== undefined) {
      const trimmed = processed.outputFormat?.trim() || '';
      processed.outputFormat = trimmed.length > 0 ? trimmed : undefined;
    }
    if (processed.outputTimezone !== undefined) {
      const trimmed = processed.outputTimezone?.trim() || '';
      processed.outputTimezone = trimmed.length > 0 ? trimmed : undefined;
    }
    if (processed.sourceType === 'system' && (!processed.sourceDeviceId || processed.sourceDeviceId.trim() === '')) {
      processed.sourceDeviceId = 'system-timestamp';
    }

    if (processed.parameterId) {
      const existing = this.db
        .prepare('SELECT id FROM parameter_mappings WHERE parameter_id = ? AND id != ?')
        .get(processed.parameterId, id);
      if (existing) {
        throw new Error(`Parameter ID "${processed.parameterId}" already exists. Please use a unique ID.`);
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    Object.entries(processed).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'createdAt') {
        const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        updates.push(`${snakeKey} = ?`);
        if (typeof value === 'boolean') {
          values.push(value ? 1 : 0);
        } else {
          values.push(value ?? null);
        }
      }
    });
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      this.db.prepare(`UPDATE parameter_mappings SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  private ensureParameterMappingsSchema(): void {
    if (this.parameterMappingsSchemaChecked) {
      return;
    }

    this.parameterMappingsSchemaChecked = true;

    const tableSqlRow = this.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'parameter_mappings'`)
      .get() as { sql?: string } | undefined;

    if (tableSqlRow?.sql && !tableSqlRow.sql.includes("'system'")) {
      console.log('⚙️ Migrating parameter_mappings table to support system source type...');
      this.db.exec('BEGIN TRANSACTION');
      try {
        this.db.exec(`
          ALTER TABLE parameter_mappings RENAME TO parameter_mappings_old_v1;

          CREATE TABLE parameter_mappings (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parameter_id TEXT,
            description TEXT,
            source_type TEXT NOT NULL CHECK(source_type IN ('modbus', 'mqtt', 'system')),
            source_device_id TEXT NOT NULL,
            register_id TEXT,
            topic TEXT,
            json_path TEXT,
            mapped_name TEXT NOT NULL,
            unit TEXT,
            data_type TEXT NOT NULL,
            input_format TEXT,
            input_timezone TEXT,
            output_format TEXT,
            output_timezone TEXT,
            transform_expression TEXT,
            store_history INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );

          INSERT INTO parameter_mappings (
            id, name, parameter_id, description, source_type, source_device_id,
            register_id, topic, json_path, mapped_name, unit, data_type,
            input_format, input_timezone, output_format, output_timezone,
            transform_expression, store_history, created_at, updated_at
          )
          SELECT
            id, name, parameter_id, description, source_type, source_device_id,
            register_id, topic, json_path, mapped_name, unit, data_type,
            input_format, input_timezone, output_format, output_timezone,
            transform_expression, store_history, created_at, updated_at
          FROM parameter_mappings_old_v1;

          DROP TABLE parameter_mappings_old_v1;
        `);
        this.db.exec('COMMIT');
        console.log('✅ parameter_mappings table migrated successfully.');
      } catch (error: any) {
        console.error('Failed to migrate parameter_mappings table:', error);
        this.db.exec('ROLLBACK');
        this.parameterMappingsSchemaChecked = false;
        throw error;
      }
    }
    // Ensure system mappings have a source device id
    this.db
      .prepare(
        `UPDATE parameter_mappings SET source_device_id = 'system-timestamp' WHERE source_type = 'system' AND (source_device_id IS NULL OR TRIM(source_device_id) = '')`
      )
      .run();
  }

  deleteParameterMapping(id: string): void {
    this.db.prepare('DELETE FROM parameter_mappings WHERE id = ?').run(id);
  }

  // Historical Data operations
  insertHistoricalData(data: { mappingId: string; timestamp: number; value: any; quality: 'good' | 'bad' | 'uncertain' }): void {
    const id = uuidv4();
    try {
      this.db
        .prepare(`
          INSERT INTO historical_data (id, mapping_id, timestamp, value, quality)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(id, data.mappingId, data.timestamp, JSON.stringify(data.value), data.quality);
    } catch (error: any) {
      if (error.message?.includes('parameter_mappings_old')) {
        console.log('Fixing database migration issue...');
        try {
          this.db.exec('DROP TABLE IF EXISTS parameter_mappings_old');
          console.log('✅ Cleaned up problematic migration table');
          const tableExists = this.db
            .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='historical_data'`)
            .get();
          if (!tableExists) {
            console.log('Recreating historical_data table...');
            this.db.exec(`
              CREATE TABLE IF NOT EXISTS historical_data (
                id TEXT PRIMARY KEY,
                mapping_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                value TEXT NOT NULL,
                quality TEXT NOT NULL,
                FOREIGN KEY (mapping_id) REFERENCES parameter_mappings(id)
              )
            `);
            console.log('✅ Recreated historical_data table');
          }
          this.db
            .prepare(`
              INSERT INTO historical_data (id, mapping_id, timestamp, value, quality)
              VALUES (?, ?, ?, ?, ?)
            `)
            .run(id, data.mappingId, data.timestamp, JSON.stringify(data.value), data.quality);
          console.log('✅ Successfully inserted historical data after cleanup');
        } catch (retryError: any) {
          console.error('❌ Failed to insert historical data even after cleanup:', retryError.message);
          console.log('⚠️ Skipping historical data storage due to database issues');
        }
      } else {
        throw error;
      }
    }
  }

  queryHistoricalData(startTime: number, endTime: number, mappingIds: string[] = []): HistoricalData[] {
    console.log('Querying historical data:', {
      startTime,
      endTime,
      startDate: new Date(startTime).toISOString(),
      endDate: new Date(endTime).toISOString(),
      mappingIds,
    });

    const totalRecords = this.db.prepare('SELECT COUNT(*) as count FROM historical_data').get() as { count: number };
    console.log(`📊 Total historical data records in database: ${totalRecords.count}`);

    if (mappingIds.length > 0) {
      const placeholders = mappingIds.map(() => '?').join(',');
      const mappingRecords = this.db
        .prepare(`SELECT COUNT(*) as count FROM historical_data WHERE mapping_id IN (${placeholders})`)
        .get(...mappingIds) as { count: number };
      console.log(`📊 Records for selected mappings: ${mappingRecords.count}`);
    }

    let query = `SELECT * FROM historical_data WHERE timestamp >= ? AND timestamp <= ?`;
    const params: any[] = [startTime, endTime];

    if (mappingIds.length > 0) {
      const placeholders = mappingIds.map(() => '?').join(',');
      query += ` AND mapping_id IN (${placeholders})`;
      params.push(...mappingIds);
    }

    query += ' ORDER BY timestamp ASC';
    console.log('SQL Query:', query);
    console.log('Parameters:', params);

    const rows = this.db.prepare(query).all(...params) as any[];
    console.log(`Found ${rows.length} historical data records`);

    return rows.map((row) => ({
      id: row.id,
      mappingId: row.mapping_id,
      timestamp: row.timestamp,
      value: JSON.parse(row.value),
      quality: row.quality,
    }));
  }

  getLatestHistoricalDataForMappings(mappingIds: string[]): Map<string, HistoricalData> {
    if (mappingIds.length === 0) {
      return new Map();
    }

    const placeholders = mappingIds.map(() => '?').join(',');
    // Get the latest value for each mapping ID
    const query = `
      SELECT h1.* FROM historical_data h1
      INNER JOIN (
        SELECT mapping_id, MAX(timestamp) as max_timestamp
        FROM historical_data
        WHERE mapping_id IN (${placeholders})
        GROUP BY mapping_id
      ) h2 ON h1.mapping_id = h2.mapping_id AND h1.timestamp = h2.max_timestamp
    `;

    const rows = this.db.prepare(query).all(...mappingIds) as any[];
    const result = new Map<string, HistoricalData>();

    rows.forEach((row) => {
      result.set(row.mapping_id, {
        id: row.id,
        mappingId: row.mapping_id,
        timestamp: row.timestamp,
        value: JSON.parse(row.value),
        quality: row.quality,
      });
    });

    return result;
  }

  exportData(startTime: number, endTime: number, mappingIds: string[], format: 'csv' | 'json'): { path: string } {
    const data = this.queryHistoricalData(startTime, endTime, mappingIds);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `export_${timestamp}.${format}`;
    if (!fs.existsSync(this.exportDir)) fs.mkdirSync(this.exportDir, { recursive: true });
    const exportPath = path.join(this.exportDir, filename);

    if (format === 'csv') {
      const mappings = this.getParameterMappings();
      const header = 'Timestamp,Parameter,Value,Unit,Quality\n';
      const rows = data.map((row) => {
        const mapping = mappings.find((m) => m.id === row.mappingId);
        const value = typeof row.value === 'object' ? JSON.stringify(row.value) : row.value;
        return `${new Date(row.timestamp).toISOString()},${mapping?.mappedName || row.mappingId},${value},${mapping?.unit || ''},${row.quality}`;
      });
      fs.writeFileSync(exportPath, header + rows.join('\n'));
    } else {
      fs.writeFileSync(exportPath, JSON.stringify(data, null, 2));
    }

    return { path: exportPath };
  }

  // Publisher operations
  getPublishers(): Publisher[] {
    const rows = this.db.prepare('SELECT * FROM publishers ORDER BY created_at DESC').all();
    return rows.map((row) => this.rowToPublisher(row as any));
  }

  getPublisherById(id: string): Publisher | undefined {
    const row = this.db.prepare('SELECT * FROM publishers WHERE id = ?').get(id);
    return row ? this.rowToPublisher(row as any) : undefined;
  }

  createPublisher(publisher: Partial<Publisher>): Publisher {
    const id = uuidv4();
    const now = Date.now();
    this.db
      .prepare(`
        INSERT INTO publishers (
          id, name, type, enabled, auto_start, mode, json_format, custom_json_template,
          mqtt_broker, mqtt_port, mqtt_protocol, mqtt_topic, mqtt_qos, mqtt_username, 
          mqtt_password, mqtt_use_tls, http_url, http_method, http_headers, use_jwt, 
          jwt_token, jwt_header, buffer_size, buffer_flush_interval, retry_attempts, 
          retry_delay, mapping_ids, scheduled_enabled, scheduled_interval, scheduled_interval_unit,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        publisher.name,
        publisher.type,
        publisher.enabled ? 1 : 0,
        publisher.autoStart ? 1 : 0,
        publisher.mode,
        publisher.jsonFormat || 'simple',
        publisher.customJsonTemplate,
        publisher.mqttBroker,
        publisher.mqttPort,
        publisher.mqttProtocol,
        publisher.mqttTopic,
        publisher.mqttQos,
        publisher.mqttUsername,
        publisher.mqttPassword,
        publisher.mqttUseTls ? 1 : 0,
        publisher.httpUrl,
        publisher.httpMethod,
        JSON.stringify(publisher.httpHeaders),
        publisher.useJwt ? 1 : 0,
        publisher.jwtToken,
        publisher.jwtHeader,
        publisher.bufferSize,
        publisher.bufferFlushInterval,
        publisher.retryAttempts,
        publisher.retryDelay,
        JSON.stringify(publisher.mappingIds || []),
        publisher.scheduledEnabled ? 1 : 0,
        publisher.scheduledInterval,
        publisher.scheduledIntervalUnit,
        now,
        now
      );
    return {
      ...publisher,
      id,
      createdAt: now,
      updatedAt: now,
      autoStart: !!publisher.autoStart,
    } as Publisher;
  }

  updatePublisher(id: string, publisher: Partial<Publisher>): void {
    const updates: string[] = [];
    const values: any[] = [];
    Object.entries(publisher).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'createdAt') {
        const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        if (key === 'httpHeaders' || key === 'mappingIds') {
          updates.push(`${snakeKey} = ?`);
          values.push(JSON.stringify(value));
        } else {
          updates.push(`${snakeKey} = ?`);
          if (typeof value === 'boolean') {
            values.push(value ? 1 : 0);
          } else {
            values.push(value);
          }
        }
      }
    });
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      this.db.prepare(`UPDATE publishers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  deletePublisher(id: string): void {
    this.db.prepare('DELETE FROM publishers WHERE id = ?').run(id);
  }

  togglePublisher(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE publishers SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, Date.now(), id);
  }

  // Buffer Queue operations
  enqueueBuffer(item: { publisherId: string; data: RealtimeData; timestamp: number; attempts: number; lastAttempt?: number; status: 'pending' | 'failed' | 'sent' }): void {
    const id = uuidv4();
    this.db
      .prepare(`
        INSERT INTO buffer_queue (id, publisher_id, data, timestamp, attempts, last_attempt, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, item.publisherId, JSON.stringify(item.data), item.timestamp, item.attempts, item.lastAttempt, item.status);
  }

  getPendingBufferItems(publisherId: string, limit: number): BufferItem[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM buffer_queue 
        WHERE publisher_id = ? AND status = 'pending'
        ORDER BY timestamp ASC
        LIMIT ?
      `)
      .all(publisherId, limit);
    return rows.map((row: any) => ({
      id: row.id,
      publisherId: row.publisher_id,
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
      attempts: row.attempts,
      lastAttempt: row.last_attempt,
      status: row.status,
    }));
  }

  updateBufferItemStatus(id: string, status: 'pending' | 'failed' | 'sent', attempts: number): void {
    this.db.prepare('UPDATE buffer_queue SET status = ?, attempts = ?, last_attempt = ? WHERE id = ?').run(status, attempts, Date.now(), id);
  }

  deleteBufferItem(id: string): void {
    this.db.prepare('DELETE FROM buffer_queue WHERE id = ?').run(id);
  }

  /**
   * Mark all pending buffer items as 'sent' for a publisher up to a given timestamp.
   * Returns the number of items updated.
   */
  markBufferItemsSentUpTo(publisherId: string, upToTimestamp: number): number {
    const stmt = this.db.prepare(`
      UPDATE buffer_queue
      SET status = 'sent', last_attempt = ?, attempts = attempts + 1
      WHERE publisher_id = ? AND status = 'pending' AND timestamp <= ?
    `);
    const info = stmt.run(Date.now(), publisherId, upToTimestamp);
    return info.changes as number;
  }

  // Helper methods
  private rowToModbusDevice(row: any): ModbusDevice {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled === 1,
      autoStart: row.auto_start === 1,
      host: row.host,
      port: row.port,
      serialPort: row.serial_port,
      baudRate: row.baud_rate,
      dataBits: row.data_bits,
      stopBits: row.stop_bits,
      parity: row.parity,
      slaveId: row.slave_id,
      pollInterval: row.poll_interval,
      recordInterval: row.record_interval || 5000,
      timeout: row.timeout,
      retryAttempts: row.retry_attempts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToModbusRegister(row: any): ModbusRegister {
    return {
      id: row.id,
      deviceId: row.device_id,
      name: row.name,
      functionCode: row.function_code,
      address: row.address,
      quantity: row.quantity,
      dataType: row.data_type,
      byteOrder: row.byte_order,
      wordOrder: row.word_order,
      scaleFactor: row.scale_factor,
      offset: row.offset,
      unit: row.unit,
    };
  }

  private rowToMqttDevice(row: any): MqttDevice {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      autoStart: row.auto_start === 1,
      broker: row.broker,
      port: row.port,
      protocol: row.protocol,
      clientId: row.client_id,
      username: row.username,
      password: row.password,
      qos: row.qos,
      topics: JSON.parse(row.topics),
      useTls: row.use_tls === 1,
      tlsCert: row.tls_cert,
      tlsKey: row.tls_key,
      tlsCa: row.tls_ca,
      rejectUnauthorized: row.reject_unauthorized === 1,
      keepAlive: row.keep_alive,
      reconnectPeriod: row.reconnect_period,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToMqttBrokerConfig(row: any): MqttBrokerConfig {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      autoStart: row.auto_start === 1,
      port: row.port,
      wsPort: row.ws_port,
      allowAnonymous: row.allow_anonymous === 1,
      username: row.username,
      password: row.password,
      useTls: row.use_tls === 1,
      tlsCert: row.tls_cert,
      tlsKey: row.tls_key,
      tlsCa: row.tls_ca,
      maxConnections: row.max_connections,
      retainedMessages: row.retained_messages === 1,
      persistenceEnabled: row.persistence_enabled === 1,
      logLevel: row.log_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToParameterMapping(row: any): ParameterMapping {
    return {
      id: row.id,
      name: row.name,
      parameterId: row.parameter_id,
      description: row.description,
      sourceType: row.source_type,
      sourceDeviceId: row.source_device_id,
      registerId: row.register_id,
      topic: row.topic,
      jsonPath: row.json_path,
      mappedName: row.mapped_name,
      unit: row.unit,
      dataType: row.data_type,
      inputFormat: row.input_format,
      inputTimezone: row.input_timezone,
      outputFormat: row.output_format,
      outputTimezone: row.output_timezone,
      transformExpression: row.transform_expression,
      storeHistory: row.store_history === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToPublisher(row: any): Publisher {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled === 1,
      autoStart: row.auto_start === 1,
      mode: row.mode,
      jsonFormat: row.json_format || 'simple',
      customJsonTemplate: row.custom_json_template,
      mqttBroker: row.mqtt_broker,
      mqttPort: row.mqtt_port,
      mqttProtocol: row.mqtt_protocol,
      mqttTopic: row.mqtt_topic,
      mqttQos: row.mqtt_qos,
      mqttUsername: row.mqtt_username,
      mqttPassword: row.mqtt_password,
      mqttUseTls: row.mqtt_use_tls === 1,
      httpUrl: row.http_url,
      httpMethod: row.http_method,
      httpHeaders: row.http_headers ? JSON.parse(row.http_headers) : undefined,
      useJwt: row.use_jwt === 1,
      jwtToken: row.jwt_token,
      jwtHeader: row.jwt_header,
      bufferSize: row.buffer_size,
      bufferFlushInterval: row.buffer_flush_interval,
      retryAttempts: row.retry_attempts,
      retryDelay: row.retry_delay,
      mappingIds: JSON.parse(row.mapping_ids),
      scheduledEnabled: row.scheduled_enabled === 1,
      scheduledInterval: row.scheduled_interval,
      scheduledIntervalUnit: row.scheduled_interval_unit as 'seconds' | 'minutes' | 'hours' | undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // System Configuration
  getSystemConfig(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM system_config WHERE key = ?').get(key);
    return row ? (row as any).value : undefined;
  }

  setSystemConfig(key: string, value: string): void {
    const existing = this.db.prepare('SELECT id FROM system_config WHERE key = ?').get(key);
    const now = Date.now();
    if (existing) {
      this.db.prepare('UPDATE system_config SET value = ?, updated_at = ? WHERE key = ?').run(value, now, key);
    } else {
      const id = uuidv4();
      this.db.prepare('INSERT INTO system_config (id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, key, value, now, now);
    }
  }

  getClientId(): string {
    return this.getSystemConfig('clientId') || '';
  }

  setClientId(clientId: string): void {
    this.setSystemConfig('clientId', clientId);
  }

  getSystemTimestampInterval(): number {
    const raw = this.getSystemConfig('systemTimestampInterval');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 60;
    }
    return Math.floor(parsed);
  }

  setSystemTimestampInterval(seconds: number): void {
    const safe = Math.max(1, Math.floor(seconds));
    this.setSystemConfig('systemTimestampInterval', String(safe));
  }

  close(): void {
    this.db.close();
  }
}

