import mqtt, { MqttClient } from 'mqtt';
import { EventEmitter } from 'events';
import fs from 'fs';
import type { DatabaseService } from './database';
import type { MqttDevice } from '../types';
import { getLogger } from './logger';

const log = getLogger();

interface MqttSubscriberConnection {
  device: MqttDevice;
  client: MqttClient;
  status: {
    deviceId: string;
    deviceName: string;
    type: 'mqtt';
    connected: boolean;
    lastConnected?: number;
    lastError?: string;
    messagesReceived?: number;
    lastMessageTime?: number;
  };
}

export class MqttSubscriberService extends EventEmitter {
  private connections: Map<string, MqttSubscriberConnection> = new Map();

  constructor(private db: DatabaseService) {
    super();
  }

  async connect(deviceId: string): Promise<void> {
    const device = this.db.getMqttDeviceById(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    if (!device.enabled) {
      throw new Error(`Device ${device.name} is disabled`);
    }

    if (this.connections.has(deviceId)) {
      throw new Error(`Device ${device.name} is already connected`);
    }

    try {
      log.info(`Attempting MQTT connection for ${device.name}:`);
      log.info(`  Broker: ${device.broker}:${device.port}`);
      log.info(`  Protocol: ${device.protocol}`);
      log.info(`  Client ID: ${device.clientId}`);
      log.info(`  Keep Alive: ${device.keepAlive}`);
      log.info(`  Topics: ${device.topics.join(', ')}`);

      const options: mqtt.IClientOptions = {
        clientId: device.clientId,
        keepalive: device.keepAlive,
        reconnectPeriod: device.reconnectPeriod,
        clean: true,
      };

      if (device.username) {
        options.username = device.username;
      }
      if (device.password) {
        options.password = device.password;
      }

      if (device.useTls) {
        options.protocol = (device.protocol.includes('s') ? device.protocol : 'mqtts') as any;
        options.rejectUnauthorized = device.rejectUnauthorized ?? true;
        if (device.tlsCert) {
          options.cert = fs.readFileSync(device.tlsCert);
        }
        if (device.tlsKey) {
          options.key = fs.readFileSync(device.tlsKey);
        }
        if (device.tlsCa) {
          options.ca = fs.readFileSync(device.tlsCa);
        }
      }

      const brokerUrl = `${device.protocol}://${device.broker}:${device.port}`;
      const client = mqtt.connect(brokerUrl, options);

      const status = {
        deviceId: device.id,
        deviceName: device.name,
        type: 'mqtt' as const,
        connected: false,
        messagesReceived: 0,
      };

      const connection: MqttSubscriberConnection = {
        device,
        client,
        status,
      };

      this.connections.set(deviceId, connection);

      client.on('connect', () => {
        log.info(`MQTT connected: ${device.name}`);
        connection.status.connected = true;
        connection.status.lastConnected = Date.now();
        connection.status.lastError = undefined;

        device.topics.forEach((topic) => {
          client.subscribe(topic, { qos: device.qos as any }, (err) => {
            if (err) {
              log.error(`Error subscribing to ${topic}:`, err);
            } else {
              log.info(`Subscribed to topic: ${topic}`);
            }
          });
        });

        this.emit('connected', deviceId);
      });

      client.on('message', (topic, message) => {
        try {
          const payload = message.toString();
          let data: any;
          try {
            data = JSON.parse(payload);
          } catch {
            data = payload;
          }

          log.info(`MQTT message received from ${device.name} on topic ${topic}:`, payload);

          this.emit('data', {
            deviceId,
            topic,
            data,
            timestamp: Date.now(),
            quality: 'good' as const,
          });

          connection.status.messagesReceived = (connection.status.messagesReceived || 0) + 1;
          connection.status.lastMessageTime = Date.now();
        } catch (error: any) {
          log.error(`Error processing MQTT message:`, error);
        }
      });

      client.on('error', (error: any) => {
        log.error(`MQTT error for ${device.name}:`, error);
        connection.status.connected = false;
        connection.status.lastError = error.message;

        if (error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')) {
          log.error(`Stopping auto-reconnect for ${device.name} due to connection error`);
          client.end(true);
          this.connections.delete(deviceId);
        }
      });

      client.on('close', () => {
        log.info(`MQTT connection closed: ${device.name}`);
        connection.status.connected = false;
        this.emit('disconnected', deviceId);
      });

      client.on('offline', () => {
        log.info(`MQTT offline: ${device.name}`);
        log.info(`  Client ID: ${device.clientId}`);
        log.info(`  Keep Alive: ${device.keepAlive}s`);
        log.info(`  Messages Received: ${connection.status.messagesReceived || 0}`);
        connection.status.connected = false;
      });

      client.on('reconnect', () => {
        log.info(`MQTT reconnecting: ${device.name}`);
      });
    } catch (error: any) {
      const status = {
        deviceId: device.id,
        deviceName: device.name,
        type: 'mqtt' as const,
        connected: false,
        lastError: error.message,
      };

      log.error(`Failed to connect MQTT device ${device.name}:`, error);
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      return;
    }

    return new Promise((resolve) => {
      if (connection.client.connected) {
        connection.client.end(false, {}, () => {
          this.connections.delete(deviceId);
          this.emit('disconnected', deviceId);
          resolve();
        });
      } else {
        this.connections.delete(deviceId);
        resolve();
      }
    });
  }

  getConnectionStatus(): any[] {
    const allDevices = this.db.getMqttDevices();
    return allDevices.map((device) => {
      const conn = this.connections.get(device.id);
      if (conn) return conn.status;
      return {
        deviceId: device.id,
        deviceName: device.name,
        type: 'mqtt' as const,
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
}

