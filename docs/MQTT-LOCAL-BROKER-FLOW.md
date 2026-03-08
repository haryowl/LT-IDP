# MQTT data flow with local broker

This document describes how MQTT data from devices reaches the app when using the **local MQTT broker** (Mosquitto) started by LT-IDP.

## Overview

1. **Start the local broker** (e.g. from Broker / MQTT Broker in the app). It listens on:
   - MQTT: port **11883** (configurable)
   - WebSocket: port **19001** (if enabled)

2. **Internal subscriber**  
   When the broker starts, the app starts an **internal** MQTT client that:
   - Connects to `127.0.0.1:<broker_port>` (e.g. 11883)
   - Subscribes to topic `#` (all topics)
   - For every message received, emits `'data'` with `deviceId: 'local-broker-virtual'`

3. **External device sends data**  
   Your MQTT device (sensor, gateway, etc.) publishes to the **same broker**:
   - From the same machine: `127.0.0.1:11883`
   - From the network: `<server-IP>:11883` (e.g. over Tailscale or LAN)

4. **Server pipeline**  
   The server wires:
   - `mqttBrokerService.on('data', dataMapperService.mapMqttData)`
   So every message from the internal subscriber is passed to the data mapper.

5. **Parameter mappings**  
   For values to be stored and shown:
   - In **Parameter Mappings**, create mappings with:
     - **Source type:** MQTT  
     - **Source device:** **Local MQTT Broker (Internal)** (id `local-broker-virtual`)  
     - **Topic:** the topic your device publishes to (e.g. `sensor/temp`, or a pattern)
   - The mapper matches by `sourceDeviceId === 'local-broker-virtual'` and topic; it extracts the value and emits `dataMapped` / stores history.

## Summary flow

```
[Your MQTT device]  --publish-->  [Mosquitto :11883]  <--subscribe #--  [Internal MQTT client]
                                                                              |
                                                                              v
                                                                     emit 'data' { deviceId: 'local-broker-virtual', topic, value }
                                                                              |
                                                                              v
                                                                     dataMapperService.mapMqttData()
                                                                              |
                                                                              v
                                                                     Parameter mappings (sourceDeviceId = local-broker-virtual, topic)
                                                                              |
                                                                              v
                                                                     dataMapped / history
```

## MQTT Devices table and “Local MQTT Broker (Internal)”

The **MQTT Devices** table lists all MQTT devices from the database, including the virtual entry **Local MQTT Broker (Internal)**. Connection status there comes from **MqttSubscriberService** (per-device MQTT clients you connect via the UI). The local broker data is **not** received via that path; it is received by **MqttBrokerService**’s internal client. So **Local MQTT Broker (Internal)** can show as **Disconnected** in the table even when the broker is running and data is flowing. That row is only for reference and mapping configuration; toggling Connect there is not required for local broker data.

## Checklist for “device → app” via local broker

- [ ] Local MQTT broker is started (Broker / MQTT Broker).
- [ ] Device publishes to the same host and port (e.g. `127.0.0.1:11883` or `<server>:11883`).
- [ ] Parameter Mappings exist with source type **MQTT**, source device **Local MQTT Broker (Internal)**, and the correct topic (or pattern).
