# Dependencies

## Main-process only (Electron main)

These packages are used **only** in the Electron main process (and must not be imported in the renderer or in Vite entry so they are not bundled into the frontend):

- **bcryptjs** – password hashing (AuthService)
- **jsonwebtoken** – JWT sign/verify (AuthService)
- **better-sqlite3** – SQLite database (DatabaseService)
- **modbus-serial** – Modbus TCP/RTU (ModbusService)
- **mqtt** – MQTT client (MqttSubscriberService, MqttPublisherService, MqttBrokerService)
- **serialport** – serial port access (Modbus RTU)

They are listed in `package.json` `dependencies` because they are required at runtime when the app runs under Electron. The renderer bundle (Vite) does not include them; only code under `src/` is bundled for the renderer, and `src/` does not import these modules.

## Frontend (renderer)

All other dependencies (React, MUI, Zustand, Recharts, etc.) are used only in the renderer or shared build tooling.
