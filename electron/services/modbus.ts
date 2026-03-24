import ModbusRTU from 'modbus-serial';
import { EventEmitter } from 'events';
import type { DatabaseService } from './database';
import type { ModbusDevice, ModbusRegister } from '../types';

/** If no successful poll for this long (ms), force reconnect. */
const BAD_CONNECTION_THRESHOLD_MS = 10_000;
/** Delay before first reconnect attempt after failure (ms). */
const RECONNECT_DELAY_MS = 3_000;
/** Delay before retry when reconnect attempt fails (ms). Keeps retrying when device powered off. */
const RECONNECT_RETRY_DELAY_MS = 5_000;

interface ModbusConnection {
  device: ModbusDevice;
  client: ModbusRTU;
  registers: ModbusRegister[];
  pollTimer?: NodeJS.Timeout;
  recordTimer?: NodeJS.Timeout;
  /** Timestamp of last poll that had at least one successful register read. */
  lastSuccessfulPollTime?: number;
  /** Prevents multiple simultaneous reconnect attempts. */
  reconnecting?: boolean;
  status: {
    deviceId: string;
    deviceName: string;
    type: 'modbus';
    connected: boolean;
    lastConnected?: number;
    lastError?: string;
    messagesReceived?: number;
    lastMessageTime?: number;
    reconnectAttempts?: number;
    reconnecting?: boolean;
    lastReconnectAt?: number;
  };
  lastRecordedData: Map<string, { value: any; timestamp: number; quality: 'good' | 'bad' | 'uncertain'; registerName?: string }>;
}

export class ModbusService extends EventEmitter {
  private connections: Map<string, ModbusConnection> = new Map();
  private reconnectStats: Map<string, { attempts: number; lastReconnectAt?: number }> = new Map();

  constructor(private db: DatabaseService) {
    super();
  }

  async connect(deviceId: string): Promise<void> {
    const device = this.db.getModbusDeviceById(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    if (!device.enabled) {
      throw new Error(`Device ${device.name} is disabled`);
    }

    // If already in map, force reconnect so UI can recover from stale/dead connection
    if (this.connections.has(deviceId)) {
      await this.disconnect(deviceId);
    }

    const client = new ModbusRTU();
    let registers = this.db.getModbusRegisters(deviceId);
    console.log(`Connecting to Modbus device: ${device.name}`);
    console.log(`Type: ${device.type}, Host: ${device.host}, Port: ${device.port}, Slave ID: ${device.slaveId}`);
    console.log(`Registers configured: ${registers.length}`);

    const type = (device.type || '').toString().toLowerCase();
    try {
      if (type === 'tcp') {
        const host = (device.host || '').trim();
        const port = device.port || 502;
        if (!host) throw new Error('TCP host is required');
        console.log(`Attempting TCP connection to ${host}:${port}...`);
        await client.connectTCP(host, { port });
        console.log(`TCP connection successful`);
      } else if (type === 'rtu') {
        console.log(`Attempting RTU connection to ${device.serialPort}...`);
        await client.connectRTUBuffered(device.serialPort!, {
          baudRate: device.baudRate || 9600,
          dataBits: device.dataBits || 8,
          stopBits: device.stopBits || 1,
          parity: (device.parity as 'none' | 'even' | 'odd' | 'mark' | 'space') || 'none',
        });
        console.log(`RTU connection successful`);
      } else {
        throw new Error(`Unsupported device type: ${device.type}. Use TCP or RTU.`);
      }

      client.setID(device.slaveId);
      client.setTimeout(device.timeout);
      console.log(`Modbus client configured - Slave ID: ${device.slaveId}, Timeout: ${device.timeout}ms`);

      if (registers.length === 0) {
        console.log(`No registers configured for ${device.name}. Attempting automatic discovery...`);
        registers = await this.autoDiscoverRegisters(device, client, registers);
        console.log(`Auto-discovery completed. Registers found: ${registers.length}`);
      }

      if (registers.length === 0) {
        const hint =
          type === 'rtu'
            ? ' Check serial port path (e.g. /dev/ttyUSB0), baud rate, Slave ID, and that the device is powered and connected. On Linux you may need: sudo usermod -aG dialout $USER'
            : ' Check host, port, and Slave ID.';
        throw new Error(
          `No registers could be detected for device ${device.name}.${hint} You can add registers manually in the device settings.`
        );
      }

      const connection: ModbusConnection = {
        device,
        client,
        registers,
        lastSuccessfulPollTime: Date.now(),
        status: {
          deviceId: device.id,
          deviceName: device.name,
          type: 'modbus',
          connected: true,
          lastConnected: Date.now(),
          messagesReceived: 0,
          reconnectAttempts: this.reconnectStats.get(device.id)?.attempts || 0,
          reconnecting: false,
          lastReconnectAt: this.reconnectStats.get(device.id)?.lastReconnectAt,
        },
        lastRecordedData: new Map(),
      };

      this.connections.set(deviceId, connection);
      this.attachSocketListeners(deviceId);
      this.startPolling(deviceId);
      this.startRecording(deviceId);
      console.log(`Device ${device.name} connected successfully, starting polling...`);
      this.emit('connected', deviceId);
    } catch (error: any) {
      console.error(`Connection error for ${device.name}:`, error);
      let message = error?.message ?? String(error);
      const type = (device.type || '').toString().toLowerCase();
      if (type === 'rtu' && message) {
        if (message.includes('Permission denied') || message.includes('EACCES'))
          message = `Serial port access denied for ${device.serialPort}. On Linux, add your user to the dialout group: sudo usermod -aG dialout $USER (then log out and back in).`;
        else if (message.includes('ENOENT') || message.includes('No such file'))
          message = `Serial port not found: ${device.serialPort}. Check the port path (e.g. /dev/ttyUSB0) and that the device is connected.`;
      }
      const status = {
        deviceId: device.id,
        deviceName: device.name,
        type: 'modbus' as const,
        connected: false,
        lastError: message,
      };

      if (this.connections.has(deviceId)) {
        this.connections.delete(deviceId);
      }

      this.emit('error', deviceId, error);
      throw new Error(message);
    }
  }

  private attachSocketListeners(deviceId: string): void {
    const connection = this.connections.get(deviceId);
    if (!connection) return;
    const onCloseOrError = () => {
      if (connection.reconnecting) return;
      connection.reconnecting = true;
      connection.status.reconnecting = true;
      console.log(`Modbus device ${connection.device.name}: connection lost (close/error), reconnecting...`);
      this.reconnect(deviceId);
    };
    connection.client.on('close', onCloseOrError);
    connection.client.on('error', onCloseOrError);
    (connection as any)._onCloseOrError = onCloseOrError;
  }

  async disconnect(deviceId: string): Promise<void> {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      return;
    }

    const onCloseOrError = (connection as any)._onCloseOrError;
    if (onCloseOrError) {
      const client = connection.client as unknown as EventEmitter;
      client.removeListener('close', onCloseOrError);
      client.removeListener('error', onCloseOrError);
    }

    if (connection.pollTimer) {
      clearInterval(connection.pollTimer);
    }
    if (connection.recordTimer) {
      clearInterval(connection.recordTimer);
    }

    try {
      if (connection.client?.isOpen) {
        connection.client.close(() => {});
      }
    } catch (error: any) {
      console.error(`Error closing Modbus connection for ${deviceId}:`, error);
    }

    this.connections.delete(deviceId);
    this.emit('disconnected', deviceId);
  }

  private startPolling(deviceId: string): void {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      return;
    }

    const poll = async () => {
      const connectionNow = this.connections.get(deviceId);
      if (!connectionNow) return;
      const now = Date.now();
      if (
        connectionNow.lastSuccessfulPollTime != null &&
        now - connectionNow.lastSuccessfulPollTime > BAD_CONNECTION_THRESHOLD_MS
      ) {
        console.log(
          `Modbus device ${connectionNow.device.name}: no good data for ${BAD_CONNECTION_THRESHOLD_MS / 1000}s, reconnecting...`
        );
        this.reconnect(deviceId);
        return;
      }

      try {
        console.log(`Polling ${connection.registers.length} registers from ${connection.device.name}...`);
        let successCount = 0;
        for (const register of connection.registers) {
          console.log(`Reading register: ${register.name} (FC${register.functionCode}, Addr: ${register.address})`);
          const timestamp = Date.now();
          try {
            const data = await this.readRegister(connection.client, register);
            console.log(`Register ${register.name} value:`, data);

            connection.lastRecordedData.set(register.id, {
              value: data,
              timestamp,
              quality: 'good',
              registerName: register.name,
            });

            const payload = {
              deviceId,
              registerId: register.id,
              registerName: register.name,
              value: data,
              timestamp,
              quality: 'good' as const,
            };
            this.emit('data', payload);
            this.emit(`data:${deviceId}:${register.id}`, payload);

            connection.status.messagesReceived = (connection.status.messagesReceived || 0) + 1;
            connection.status.lastMessageTime = timestamp;
            successCount++;
          } catch (registerError: any) {
            console.error(
              `Error reading register ${register.name} (FC${register.functionCode}, Addr: ${register.address}) on device ${connection.device.name}:`,
              registerError
            );

            connection.lastRecordedData.set(register.id, {
              value: null,
              timestamp,
              quality: 'bad',
              registerName: register.name,
            });

            const payload = {
              deviceId,
              registerId: register.id,
              registerName: register.name,
              value: null,
              timestamp,
              quality: 'bad' as const,
            };
            this.emit('data', payload);
            this.emit(`data:${deviceId}:${register.id}`, payload);
          }
        }

        if (successCount > 0) {
          connection.lastSuccessfulPollTime = Date.now();
          connection.status.connected = true;
          connection.status.lastError = undefined;
        } else if (connection.registers.length > 0) {
          connection.status.connected = false;
          connection.status.lastError = 'All registers failed this poll';
          if (
            connection.lastSuccessfulPollTime != null &&
            now - connection.lastSuccessfulPollTime > BAD_CONNECTION_THRESHOLD_MS
          ) {
            console.log(
              `Modbus device ${connection.device.name}: bad for ${BAD_CONNECTION_THRESHOLD_MS / 1000}s, reconnecting...`
            );
            this.reconnect(deviceId);
            return;
          }
        }
        console.log(`Poll complete. Messages received: ${connection.status.messagesReceived}`);
      } catch (error: any) {
        console.error(`Polling error for device ${connection.device.name}:`, error);
        console.error(`Error stack:`, error.stack);
        connection.status.connected = false;
        connection.status.lastError = error.message;
        this.reconnect(deviceId);
      }
    };

    poll();
    connection.pollTimer = setInterval(poll, connection.device.pollInterval);
  }

  private startRecording(deviceId: string): void {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      return;
    }

    const record = async () => {
      try {
        console.log(`Recording data for device ${connection.device.name}...`);
        for (const [registerId, data] of connection.lastRecordedData.entries()) {
          const payload = {
            deviceId,
            registerId,
            registerName: data.registerName || 'Unknown',
            value: data.value,
            timestamp: data.timestamp,
            quality: data.quality,
          };
          this.emit('dataRecord', payload);
          this.emit(`dataRecord:${deviceId}:${registerId}`, payload);
        }
        console.log(`Recorded ${connection.lastRecordedData.size} data points for ${connection.device.name}`);
      } catch (error: any) {
        console.error(`Recording error for device ${connection.device.name}:`, error);
      }
    };

    record();
    connection.recordTimer = setInterval(record, connection.device.recordInterval || 5000);
  }

  private async readRegister(client: ModbusRTU, register: ModbusRegister): Promise<any> {
    switch (register.functionCode) {
      case 1: {
        const rawData = await client.readCoils(register.address, register.quantity);
        // Coils return boolean[], convert to number[] for parseData
        return this.parseData(rawData.data.map((b: boolean) => b ? 1 : 0), register);
      }
      case 2: {
        const rawData = await client.readDiscreteInputs(register.address, register.quantity);
        // Discrete inputs return boolean[], convert to number[] for parseData
        return this.parseData(rawData.data.map((b: boolean) => b ? 1 : 0), register);
      }
      case 3: {
        const rawData = await client.readHoldingRegisters(register.address, register.quantity);
        return this.parseData(rawData.data, register);
      }
      case 4: {
        const rawData = await client.readInputRegisters(register.address, register.quantity);
        return this.parseData(rawData.data, register);
      }
      default:
        throw new Error(`Unsupported function code: ${register.functionCode}`);
    }
  }

  private parseData(data: number[], register: ModbusRegister): any {
    let value: any;
    switch (register.dataType) {
      case 'bool':
        value = Boolean(data[0]);
        break;
      case 'int16':
        value = this.bufferToInt16(data);
        break;
      case 'uint16':
        value = data[0];
        break;
      case 'int32':
        value = this.bufferToInt32(data, register);
        break;
      case 'uint32':
        value = this.bufferToUInt32(data, register);
        break;
      case 'float':
        value = this.bufferToFloat(data, register);
        break;
      case 'double':
        value = this.bufferToDouble(data, register);
        break;
      default:
        value = data[0];
    }

    if (typeof value === 'number') {
      if (register.scaleFactor) {
        value *= register.scaleFactor;
      }
      if (register.offset) {
        value += register.offset;
      }
    }

    return value;
  }

  private buildValueBuffer(data: number[], register: ModbusRegister, expectedBytes: number): Buffer {
    const wordOrder = (register.wordOrder || 'BE').toUpperCase();
    const byteOrder = (register.byteOrder || 'ABCD').toUpperCase();

    const wordsNeeded = Math.ceil(expectedBytes / 2);
    const words = data.slice(0, wordsNeeded);
    while (words.length < wordsNeeded) {
      words.push(0);
    }

    if (wordOrder === 'LE') {
      for (let i = 0; i < words.length; i += 2) {
        if (i + 1 < words.length) {
          const temp = words[i];
          words[i] = words[i + 1];
          words[i + 1] = temp;
        }
      }
    }

    const bytes: number[] = [];
    for (const word of words) {
      bytes.push((word >> 8) & 0xff);
      bytes.push(word & 0xff);
    }

    const orderMap: Record<string, number[]> = {
      ABCD: [0, 1, 2, 3],
      BADC: [1, 0, 3, 2],
      CDAB: [2, 3, 0, 1],
      DCBA: [3, 2, 1, 0],
    };

    if (expectedBytes === 4 && orderMap[byteOrder]) {
      const indices = orderMap[byteOrder];
      return Buffer.from(indices.map((idx) => bytes[idx]));
    }

    if (expectedBytes === 8 && orderMap[byteOrder]) {
      const indices = orderMap[byteOrder];
      const result: number[] = [];
      for (let i = 0; i < expectedBytes; i += 4) {
        const chunk = bytes.slice(i, i + 4);
        if (chunk.length < 4) {
          result.push(...chunk);
          continue;
        }
        indices.forEach((idx) => {
          result.push(chunk[idx]);
        });
      }
      return Buffer.from(result);
    }

    return Buffer.from(bytes.slice(0, expectedBytes));
  }

  private bufferToInt16(data: number[]): number {
    const value = data[0];
    return value > 32767 ? value - 65536 : value;
  }

  private bufferToInt32(data: number[], register: ModbusRegister): number {
    const buffer = this.buildValueBuffer(data, register, 4);
    const value = buffer.readInt32BE(0);
    return value > 2147483647 ? value - 4294967296 : value;
  }

  private bufferToUInt32(data: number[], register: ModbusRegister): number {
    const buffer = this.buildValueBuffer(data, register, 4);
    return buffer.readUInt32BE(0);
  }

  private bufferToFloat(data: number[], register: ModbusRegister): number {
    const buffer = this.buildValueBuffer(data, register, 4);
    return buffer.readFloatBE(0);
  }

  private bufferToDouble(data: number[], register: ModbusRegister): number {
    const buffer = this.buildValueBuffer(data, register, 8);
    return buffer.readDoubleBE(0);
  }

  private async autoDiscoverRegisters(
    device: ModbusDevice,
    client: ModbusRTU,
    existingRegisters: ModbusRegister[]
  ): Promise<ModbusRegister[]> {
    const discovered: ModbusRegister[] = [];
    const existingKeys = new Set(existingRegisters.map((r) => `${r.functionCode}:${r.address}`));
    const addressRange = Array.from({ length: 10 }, (_, i) => i);

    const tests: Array<{
      functionCode: number;
      quantity: number;
      dataType: string;
      namePrefix: string;
    }> = [
      { functionCode: 3, quantity: 2, dataType: 'uint16', namePrefix: 'Holding' },
      { functionCode: 4, quantity: 2, dataType: 'uint16', namePrefix: 'Input' },
      { functionCode: 1, quantity: 8, dataType: 'bool', namePrefix: 'Coil' },
      { functionCode: 2, quantity: 8, dataType: 'bool', namePrefix: 'Discrete' },
    ];

    for (const test of tests) {
      for (const address of addressRange) {
        const key = `${test.functionCode}:${address}`;
        if (existingKeys.has(key)) {
          continue;
        }

        try {
          let successful = false;

          switch (test.functionCode) {
            case 1: {
              const response = await client.readCoils(address, test.quantity);
              successful = Array.isArray(response?.data) && response.data.length > 0;
              break;
            }
            case 2: {
              const response = await client.readDiscreteInputs(address, test.quantity);
              successful = Array.isArray(response?.data) && response.data.length > 0;
              break;
            }
            case 3: {
              const response = await client.readHoldingRegisters(address, test.quantity);
              successful = Array.isArray(response?.data) && response.data.length > 0;
              break;
            }
            case 4: {
              const response = await client.readInputRegisters(address, test.quantity);
              successful = Array.isArray(response?.data) && response.data.length > 0;
              break;
            }
            default:
              successful = false;
          }

          if (!successful) {
            continue;
          }

          const register = this.db.createModbusRegister({
            deviceId: device.id,
            name: `${test.namePrefix} FC${test.functionCode} Addr ${address}`,
            functionCode: test.functionCode,
            address,
            quantity: test.functionCode <= 2 ? 1 : test.quantity,
            dataType: test.dataType,
            byteOrder: test.functionCode <= 2 ? undefined : 'ABCD',
            wordOrder: 'BE',
          });

          existingKeys.add(key);
          discovered.push(register);

          console.log(
            `Auto-discovery: Created register ${register.name} (Function Code ${register.functionCode}, Address ${register.address})`
          );

          if (discovered.length >= 20) {
            console.log('Auto-discovery limit reached (20 registers). Stopping scan.');
            return this.db.getModbusRegisters(device.id);
          }
        } catch (error: any) {
          console.warn(
            `Auto-discovery read failed for FC${test.functionCode} address ${address}: ${error.message}`
          );
        }
      }
    }

    if (discovered.length === 0) {
      console.warn(
        `Auto-discovery completed for device ${device.name} but no responsive registers were detected.`
      );
    }

    return this.db.getModbusRegisters(device.id);
  }

  private async reconnect(deviceId: string): Promise<void> {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      return;
    }
    connection.reconnecting = true;
    connection.status.reconnecting = true;
    const prev = this.reconnectStats.get(deviceId) || { attempts: 0 };
    const next = { attempts: prev.attempts + 1, lastReconnectAt: Date.now() };
    this.reconnectStats.set(deviceId, next);
    connection.status.reconnectAttempts = next.attempts;
    connection.status.lastReconnectAt = next.lastReconnectAt;

    await this.disconnect(deviceId);
    this.scheduleReconnect(deviceId, RECONNECT_DELAY_MS);
  }

  /** Schedule a reconnect attempt; on failure, reschedule. Keeps retrying until device comes back. */
  private scheduleReconnect(deviceId: string, delayMs: number): void {
    setTimeout(async () => {
      const device = this.db.getModbusDeviceById(deviceId);
      if (!device || !device.enabled) {
        return;
      }
      try {
        await this.connect(deviceId);
        console.log(`Modbus device ${device.name} reconnected successfully.`);
      } catch (error: any) {
        console.error(
          `Modbus device ${device.name} reconnection failed, retrying in ${RECONNECT_RETRY_DELAY_MS / 1000}s (device may be powered off):`,
          error?.message
        );
        this.scheduleReconnect(deviceId, RECONNECT_RETRY_DELAY_MS);
      }
    }, delayMs);
  }

  getConnectionStatus(): any[] {
    const allDevices = this.db.getModbusDevices();
    return allDevices.map((device) => {
      const conn = this.connections.get(device.id);
      if (conn) return conn.status;
      return {
        deviceId: device.id,
        deviceName: device.name,
        type: 'modbus' as const,
        connected: false,
        lastError: undefined,
      };
    });
  }

  cleanup(): void {
    for (const deviceId of this.connections.keys()) {
      this.disconnect(deviceId);
    }
  }

  updateDeviceRegisters(deviceId: string, registers: ModbusRegister[]): void {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      return;
    }

    connection.registers = registers;
    const updatedDevice = this.db.getModbusDeviceById(deviceId);
    if (updatedDevice) {
      connection.device = updatedDevice;
    }
    // Remove cached data for registers that no longer exist
    const registerIds = new Set(registers.map((reg) => reg.id));
    for (const existingId of Array.from(connection.lastRecordedData.keys())) {
      if (!registerIds.has(existingId)) {
        connection.lastRecordedData.delete(existingId);
      }
    }
  }
}

