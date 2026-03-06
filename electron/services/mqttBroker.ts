import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import mqtt, { MqttClient } from 'mqtt';
import type { MqttBrokerConfig } from '../types';

interface BrokerStatus {
  running: boolean;
  lastError?: string;
  connections?: number;
  uptime?: number;
}

export class MqttBrokerService extends EventEmitter {
  private brokerProcess: ChildProcess | null = null;
  private config: MqttBrokerConfig | null = null;
  private status: BrokerStatus = { running: false };
  private startTime: number = 0;
  private internalClient: MqttClient | null = null;
  private configDir: string;
  private dataDir: string;

  constructor() {
    super();
    const userDataPath = app.getPath('userData');
    this.configDir = path.join(userDataPath, 'mqtt-broker');
    this.dataDir = path.join(userDataPath, 'mqtt-data');

    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async start(config: MqttBrokerConfig): Promise<void> {
    if (this.brokerProcess) {
      throw new Error('Broker is already running');
    }

    this.config = config;

    try {
      const configPath = this.generateMosquittoConfig(config);
      const mosquittoPath = await this.findMosquittoExecutable();

      if (!mosquittoPath) {
        throw new Error('Mosquitto is not installed. Please install Mosquitto MQTT broker.');
      }

      await this.killExistingMosquittoProcesses();

      // Check for required DLLs before attempting to start
      const mosquittoDir = path.dirname(mosquittoPath);
      console.log(`Checking Mosquitto installation in: ${mosquittoDir}`);
      
      const checkDlls = (dllNames: string[]): string[] => {
        const missing: string[] = [];
        for (const dll of dllNames) {
          const dllPath = path.join(mosquittoDir, dll);
          if (!fs.existsSync(dllPath)) {
            missing.push(dll);
          } else {
            console.log(`✓ Found DLL: ${dll}`);
          }
        }
        return missing;
      };
      
      // Check for OpenSSL DLLs (store in outer scope for error messages)
      const oldOpenSsl = checkDlls(['libeay32.dll', 'ssleay32.dll']);
      let newOpenSsl: string[] = [];
      try {
        const files = fs.readdirSync(mosquittoDir);
        newOpenSsl = files.filter((f: string) => 
          (f.startsWith('libcrypto-') && f.endsWith('.dll')) || 
          (f.startsWith('libssl-') && f.endsWith('.dll'))
        );
        if (newOpenSsl.length > 0) {
          console.log(`✓ Found OpenSSL DLLs: ${newOpenSsl.join(', ')}`);
        }
      } catch (dirError: any) {
        console.warn('Could not read Mosquitto directory:', dirError.message);
      }
      
      if (oldOpenSsl.length > 0 && newOpenSsl.length === 0) {
        console.warn(`⚠️ Missing OpenSSL 1.0.x DLLs: ${oldOpenSsl.join(', ')}`);
      } else if (newOpenSsl.length === 0 && oldOpenSsl.length === 0) {
        console.warn(`⚠️ No OpenSSL DLLs found in Mosquitto directory`);
      }
      
      // Store for error messages
      const dllCheckResult = { oldOpenSsl, newOpenSsl, mosquittoDir };

      console.log(`Starting Mosquitto broker from: ${mosquittoPath}`);
      console.log(`Using config: ${configPath}`);

      let stderrBuffer = '';
      let stdoutBuffer = '';
      let exitCode: number | null = null;
      let exitSignal: NodeJS.Signals | null = null;

      // Use spawn with explicit error handling
      // Use the actual config path (with backslashes on Windows) - spawn handles this correctly
      const args = ['-c', configPath, '-v'];
      console.log(`Spawning Mosquitto with args: ${args.join(' ')}`);
      console.log(`Full command: "${mosquittoPath}" ${args.join(' ')}`);
      
      // Capture all output before spawning
      // On Windows, try using cmd.exe to run in a proper Windows environment
      // This helps with DLL loading issues
      const isWindows = process.platform === 'win32';
      const env = {
        ...process.env,
        // Ensure PATH includes Mosquitto's directory FIRST so DLLs are found
        PATH: `${mosquittoDir}${path.delimiter}${process.env.PATH || ''}`,
        // Set SystemRoot for Windows DLL loading
        SystemRoot: process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
      };
      
      console.log(`Environment PATH: ${env.PATH?.substring(0, 200)}...`);
      console.log(`SystemRoot: ${env.SystemRoot}`);
      
      // On Windows, try using shell: true to ensure proper DLL loading
      // This uses cmd.exe internally which provides the Windows environment
      if (isWindows) {
        // Use shell: true to run in a proper Windows command environment
        // This ensures DLLs are loaded correctly
        const command = `"${mosquittoPath}" ${args.join(' ')}`;
        console.log(`Running with shell: ${command}`);
        
        this.brokerProcess = spawn(command, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          windowsHide: false, // Show window for debugging
          shell: true, // Use shell for proper Windows DLL loading
          cwd: mosquittoDir, // Set working directory to Mosquitto's directory
          env: env,
        });
      } else {
        // Linux/Mac - run directly
        this.brokerProcess = spawn(mosquittoPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          windowsHide: false,
          shell: false,
          cwd: mosquittoDir,
          env: env,
        });
      }
      
      console.log(`Mosquitto process spawned with PID: ${this.brokerProcess.pid}`);
      
      // Capture exit immediately to get error code
      this.brokerProcess.on('exit', (code, signal) => {
        exitCode = code;
        exitSignal = signal;
        console.log(`[EXIT HANDLER] Mosquitto exited with code ${code}, signal ${signal}`);
        console.log(`[EXIT HANDLER] Stdout buffer length: ${stdoutBuffer.length}, Stderr buffer length: ${stderrBuffer.length}`);
      });

      this.startTime = Date.now();

      this.brokerProcess.stdout?.on('data', (data) => {
        const message = data.toString();
        stdoutBuffer += message;
        console.log(`[Mosquitto STDOUT]: ${message.trim()}`);
        this.parseLogMessage(message);
      });

      this.brokerProcess.stderr?.on('data', (data) => {
        const message = data.toString();
        stderrBuffer += message;
        console.error(`[Mosquitto STDERR]: ${message.trim()}`);
        this.status.lastError = message;

        if (message.includes('Error') || message.includes('Failed') || message.includes('Unknown')) {
          console.error('Mosquitto configuration or startup error detected');
        }
        
        // Check for port in use error
        if (message.includes('Only one usage of each socket address') || 
            (message.includes('port') && message.includes('already in use')) ||
            message.includes('Error: Only one usage')) {
          console.error('⚠️ Port conflict detected - another Mosquitto instance may be running');
          console.error('The app will try to kill existing processes and retry');
          // Try to kill processes again and wait
          this.killExistingMosquittoProcesses().then(() => {
            console.log('Re-checked for existing Mosquitto processes');
          });
        }
      });
      
      // Capture any errors from spawn itself
      this.brokerProcess.on('error', (spawnError: any) => {
        console.error('Mosquitto spawn error (process failed to start):', spawnError);
        stderrBuffer += `Spawn error: ${spawnError.message}\n`;
        this.status.lastError = spawnError.message;
      });

      // Set up exit handler (duplicate handler to ensure we capture everything)
      const exitHandler = (code: number | null, signal: NodeJS.Signals | null) => {
        console.log(`[EXIT] Mosquitto exited with code ${code}, signal ${signal}`);
        
        // Check for specific error types
        if (code === 3221226505) {
          console.log(`Exit code 3221226505 (0xC0000005) = Access Violation / Crash`);
          console.log(`This usually means: Missing DLLs, corrupted executable, or memory error`);
        } else if (code !== 0 && code !== null) {
          console.log(`Mosquitto exited with error code ${code}`);
        }
        
        console.log(`[EXIT] Final stdout buffer (${stdoutBuffer.length} chars):\n${stdoutBuffer || '(empty)'}`);
        console.log(`[EXIT] Final stderr buffer (${stderrBuffer.length} chars):\n${stderrBuffer || '(empty)'}`);
        
        if (stdoutBuffer) {
          console.log(`Full Mosquitto stdout output:\n${stdoutBuffer}`);
        }
        if (stderrBuffer) {
          console.error(`Full Mosquitto stderr output:\n${stderrBuffer}`);
          
          // Check for port conflict in stderr
          if (stderrBuffer.includes('Only one usage of each socket address') || 
              (stderrBuffer.includes('port') && stderrBuffer.includes('already in use'))) {
            this.status.lastError = `Port conflict: Another Mosquitto instance is using port ${config.port}. Please stop all Mosquitto processes and try again.`;
          } else {
            this.status.lastError = stderrBuffer || stdoutBuffer || `Exit code: ${code}`;
          }
        } else if (stdoutBuffer) {
          this.status.lastError = stdoutBuffer;
        } else {
          // No output captured - this is the problem
          let errorMsg = `Mosquitto exited immediately with code ${code}. `;
          if (code === 3221226505) {
            errorMsg += `Access violation detected. This usually means:\n`;
            errorMsg += `1. Missing OpenSSL DLLs (libeay32.dll, ssleay32.dll, or libcrypto-*.dll, libssl-*.dll)\n`;
            errorMsg += `2. Missing Visual C++ runtime libraries\n`;
            errorMsg += `3. Mosquitto executable is corrupted\n`;
            errorMsg += `\nPlease check:\n`;
            errorMsg += `- Mosquitto directory: ${mosquittoDir}\n`;
            errorMsg += `- Try running manually: "${mosquittoPath}" -h\n`;
            errorMsg += `- Check Windows Event Viewer for more details`;
          } else {
            errorMsg += `No error output captured. This may indicate a configuration error or missing dependencies.`;
          }
          this.status.lastError = errorMsg;
        }
        this.brokerProcess = null;
        this.status.running = false;
        this.emit('stopped', { code, signal });
      };
      
      this.brokerProcess.on('exit', exitHandler);

      // Note: This 'error' event is for process errors, not spawn errors
      // Spawn errors are handled above
      this.brokerProcess.on('error', (error: any) => {
        console.error('Mosquitto process runtime error:', error);
        this.status.running = false;
        this.status.lastError = error.message;
        stderrBuffer += `Process error: ${error.message}\n`;
        this.emit('error', error);
      });

      // Wait a bit for the process to start and potentially output errors
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check if process exited immediately (this indicates a crash)
      if (this.brokerProcess && (this.brokerProcess.exitCode !== null || exitCode !== null)) {
        const finalExitCode = exitCode ?? this.brokerProcess.exitCode;
        const errorMsg = stderrBuffer || stdoutBuffer || 'Mosquitto exited immediately without output';
        
        console.error(`Mosquitto failed to start immediately:`);
        console.error(`Exit code: ${finalExitCode}`);
        console.error(`Stdout buffer (${stdoutBuffer.length} chars): ${stdoutBuffer || '(empty)'}`);
        console.error(`Stderr buffer (${stderrBuffer.length} chars): ${stderrBuffer || '(empty)'}`);
        
        let detailedError = `Failed to start Mosquitto broker. Exit code: ${finalExitCode}. `;
        
        if (finalExitCode === 3221226505) {
          detailedError += `\n\nAccess Violation (0xC0000005) - Mosquitto crashed immediately.\n`;
          detailedError += `This usually means:\n`;
          detailedError += `1. Missing OpenSSL DLLs - Mosquitto needs OpenSSL libraries in its directory\n`;
          detailedError += `   Check if these exist in "${dllCheckResult.mosquittoDir}":\n`;
          if (dllCheckResult.oldOpenSsl.length > 0) {
            detailedError += `   - Missing: ${dllCheckResult.oldOpenSsl.join(', ')}\n`;
          }
          if (dllCheckResult.newOpenSsl.length > 0) {
            detailedError += `   - Found: ${dllCheckResult.newOpenSsl.join(', ')}\n`;
          } else {
            detailedError += `   - No OpenSSL DLLs found!\n`;
          }
          detailedError += `\n2. Solution: Download OpenSSL from https://slproweb.com/products/Win32OpenSSL.html\n`;
          detailedError += `   Copy libeay32.dll and ssleay32.dll (or libcrypto-*.dll, libssl-*.dll) to:\n`;
          detailedError += `   ${dllCheckResult.mosquittoDir}\n`;
        } else {
          detailedError += errorMsg;
        }
        
        throw new Error(detailedError);
      }

      // Wait longer for Mosquitto to fully start (Windows sometimes needs more time)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if process is still running (also check exitCode variable)
      if (this.brokerProcess && !this.brokerProcess.killed && this.brokerProcess.exitCode === null && exitCode === null) {
        // Verify the process is actually alive by checking if we can get its pid
        try {
          if (this.brokerProcess.pid) {
            // Process is running, wait a bit more for it to be ready
            await new Promise((resolve) => setTimeout(resolve, 1000));
            
            // Double-check it's still running
            if (this.brokerProcess && this.brokerProcess.exitCode === null) {
              this.status.running = true;
              this.status.lastError = undefined;
              this.emit('started');
              console.log('Mosquitto broker started successfully');
              
              // Start internal subscriber with retry logic
              await this.startInternalSubscriber(config);
            } else {
              const exitCode = this.brokerProcess?.exitCode;
              const errorMsg = stderrBuffer || stdoutBuffer || 'Mosquitto process died during startup';
              console.error(`Mosquitto process died. Stdout: ${stdoutBuffer}, Stderr: ${stderrBuffer}`);
              throw new Error(`Failed to start Mosquitto broker. Exit code: ${exitCode}. ${errorMsg}`);
            }
          } else {
            throw new Error('Mosquitto process has no PID');
          }
        } catch (error: any) {
          const finalExitCode = exitCode ?? this.brokerProcess?.exitCode ?? 'unknown';
          const errorMsg = stderrBuffer || stdoutBuffer || error.message || 'Unknown error';
          console.error(`Error starting Mosquitto. Stdout: ${stdoutBuffer}, Stderr: ${stderrBuffer}`);
          
          // Provide helpful error message
          let detailedError = `Failed to start Mosquitto broker. Exit code: ${finalExitCode}. ${errorMsg}`;
          if ((typeof finalExitCode === 'number' && finalExitCode === 3221226505) || finalExitCode === 'unknown') {
            detailedError += '\n\nPossible causes:\n';
            detailedError += '1. Missing Visual C++ runtime libraries - Install Visual C++ Redistributable\n';
            detailedError += '2. Missing OpenSSL DLLs or wrong architecture - Check DLL architecture matches Mosquitto\n';
            detailedError += '3. Configuration error - Check the config file\n';
            detailedError += '4. Port already in use - Try a different port\n';
            detailedError += '5. Permission issues - Try running as Administrator\n';
            detailedError += `\nConfig file: ${configPath}\n`;
            detailedError += `Mosquitto path: ${mosquittoPath}\n`;
            if (dllCheckResult.newOpenSsl.length > 0) {
              detailedError += `\nNote: OpenSSL DLLs found: ${dllCheckResult.newOpenSsl.join(', ')}\n`;
              detailedError += `But Mosquitto still crashes. This may indicate:\n`;
              detailedError += `- Architecture mismatch (32-bit vs 64-bit)\n`;
              detailedError += `- Missing Visual C++ runtime\n`;
              detailedError += `- Missing dependencies of OpenSSL DLLs\n`;
            }
          }
          throw new Error(detailedError);
        }
      } else {
        const finalExitCode = exitCode ?? this.brokerProcess?.exitCode ?? 'unknown';
        const errorMsg = stderrBuffer || stdoutBuffer || 'Unknown error';
        console.error(`Mosquitto failed. Exit code: ${finalExitCode}, Stdout: ${stdoutBuffer}, Stderr: ${stderrBuffer}`);
        
        let detailedError = `Failed to start Mosquitto broker. Exit code: ${finalExitCode}. ${errorMsg}`;
        if ((typeof finalExitCode === 'number' && finalExitCode === 3221226505) || finalExitCode === 'unknown') {
          detailedError += '\n\nPossible causes:\n';
          detailedError += '1. Missing Visual C++ runtime libraries - Install Visual C++ Redistributable\n';
          detailedError += '2. Missing OpenSSL DLLs or wrong architecture - Check DLL architecture matches Mosquitto\n';
          detailedError += '3. Configuration error - Check the config file\n';
          detailedError += '4. Port already in use - Try a different port\n';
          detailedError += '5. Permission issues - Try running as Administrator\n';
          detailedError += `\nConfig file: ${configPath}\n`;
          detailedError += `Mosquitto path: ${mosquittoPath}\n`;
          if (dllCheckResult.newOpenSsl.length > 0) {
            detailedError += `\nNote: OpenSSL DLLs found: ${dllCheckResult.newOpenSsl.join(', ')}\n`;
            detailedError += `But Mosquitto still crashes. This may indicate:\n`;
            detailedError += `- Architecture mismatch (32-bit vs 64-bit)\n`;
            detailedError += `- Missing Visual C++ runtime\n`;
            detailedError += `- Missing dependencies of OpenSSL DLLs\n`;
          }
        }
        throw new Error(detailedError);
      }
    } catch (error: any) {
      this.status.running = false;
      this.status.lastError = error.message;
      this.brokerProcess = null;
      throw error;
    }
  }

  private async startInternalSubscriber(config: MqttBrokerConfig): Promise<void> {
    try {
      // Wait longer for broker to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const brokerUrl = `mqtt://127.0.0.1:${config.port}`;
      console.log(`Starting internal MQTT subscriber to ${brokerUrl}...`);

      this.internalClient = mqtt.connect(brokerUrl, {
        clientId: `lt-iot-client-internal-${Date.now()}`,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 10000, // 10 second timeout
      });

      this.internalClient.on('connect', () => {
        console.log('Internal MQTT client connected to local broker');
        this.internalClient?.subscribe('#', { qos: 0 }, (err) => {
          if (err) {
            console.error('Error subscribing to all topics:', err);
          } else {
            console.log('Internal client subscribed to all topics (#)');
          }
        });
      });

      this.internalClient.on('error', (error: any) => {
        // Only log if broker is still running (don't spam if broker crashed)
        if (this.status.running) {
          console.error('Internal MQTT client error:', error);
          // Retry connection after a delay if broker is still running
          if (error.code === 'ECONNREFUSED' && this.status.running) {
            console.log('Retrying internal subscriber connection in 3 seconds...');
            setTimeout(() => {
              if (this.status.running && !this.internalClient?.connected) {
                this.startInternalSubscriber(config).catch((err) => {
                  console.error('Failed to reconnect internal subscriber:', err);
                });
              }
            }, 3000);
          }
        }
      });

      this.internalClient.on('message', (topic, message) => {
        try {
          const payload = message.toString();
          let data: any;
          try {
            data = JSON.parse(payload);
          } catch {
            data = payload;
          }

          console.log(`Broker received message on topic "${topic}":`, payload);

          this.emit('data', {
            deviceId: 'local-broker-virtual',
            topic,
            data,
            value: data,
            timestamp: Date.now(),
            quality: 'good' as const,
          });
        } catch (error: any) {
          console.error('Error processing broker message:', error);
        }
      });

      this.internalClient.on('close', () => {
        // Only log if broker is still supposed to be running
        if (this.status.running) {
          console.log('Internal MQTT client connection closed - will retry if broker is still running');
          // Don't retry here - let the error handler manage retries
        } else {
          console.log('Internal MQTT client connection closed (broker stopped)');
        }
      });
    } catch (error: any) {
      console.error('Failed to start internal MQTT subscriber:', error);
    }
  }

  async stop(): Promise<void> {
    if (this.internalClient) {
      try {
        await new Promise<void>((resolve) => {
          this.internalClient!.end(false, {}, () => {
            console.log('Internal MQTT client disconnected');
            this.internalClient = null;
            resolve();
          });
        });
      } catch (error: any) {
        console.error('Error disconnecting internal client:', error);
        this.internalClient = null;
      }
    }

    if (!this.brokerProcess) {
      return;
    }

    return new Promise((resolve) => {
      if (!this.brokerProcess) {
        resolve();
        return;
      }

      this.brokerProcess.once('exit', () => {
        this.brokerProcess = null;
        this.status.running = false;
        console.log('Mosquitto broker stopped');
        resolve();
      });

      this.brokerProcess.kill('SIGTERM');

      setTimeout(() => {
        if (this.brokerProcess) {
          this.brokerProcess.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  getStatus(): BrokerStatus {
    if (this.status.running && this.startTime) {
      this.status.uptime = Date.now() - this.startTime;
    }
    return { ...this.status };
  }

  async isMosquittoInstalled(): Promise<boolean> {
    const path = await this.findMosquittoExecutable();
    return path !== null;
  }

  private async killExistingMosquittoProcesses(): Promise<void> {
    const isWindows = process.platform === 'win32';

    return new Promise((resolve) => {
      if (isWindows) {
        // Check for Windows service first
        const serviceCheck = spawn('sc', ['query', 'mosquitto'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        
        let serviceOutput = '';
        serviceCheck.stdout?.on('data', (data) => {
          serviceOutput += data.toString();
        });
        
        serviceCheck.on('close', (code) => {
          if (code === 0 && serviceOutput.includes('RUNNING')) {
            console.warn('⚠️ Mosquitto Windows service is running. Stopping it...');
            // Try to stop the service
            const stopService = spawn('net', ['stop', 'mosquitto'], {
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            stopService.on('close', () => {
              console.log('Attempted to stop Mosquitto service');
            });
          }
        });
        
        // Kill any running processes
        const proc = spawn('taskkill', ['/F', '/IM', 'mosquitto.exe'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        
        let output = '';
        proc.stdout?.on('data', (data) => {
          output += data.toString();
        });
        proc.stderr?.on('data', (data) => {
          output += data.toString();
        });
        
        proc.on('close', (code) => {
          if (code === 0) {
            console.log('Killed existing Mosquitto process(es)');
            console.log('Output:', output);
          } else if (code === 128) {
            // No process found
            console.log('No existing Mosquitto process found (this is OK)');
          } else {
            console.log(`taskkill returned code ${code}, output: ${output}`);
          }
          // Wait longer to ensure processes are fully terminated
          setTimeout(resolve, 1500);
        });
        proc.on('error', (error) => {
          console.log('Error killing Mosquitto processes:', error.message);
          // Continue anyway
          setTimeout(resolve, 1500);
        });
      } else {
        const proc = spawn('pkill', ['-9', 'mosquitto'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        proc.on('close', (code) => {
          if (code === 0) {
            console.log('Killed existing Mosquitto process');
          } else {
            console.log('No existing Mosquitto process found (this is OK)');
          }
          setTimeout(resolve, 1000);
        });
        proc.on('error', () => {
          console.log('No existing Mosquitto process found (this is OK)');
          resolve();
        });
      }
    });
  }

  private async findMosquittoExecutable(): Promise<string | null> {
    const isWindows = process.platform === 'win32';
    const possiblePaths = isWindows
      ? [
          'C:\\Program Files\\mosquitto\\mosquitto.exe',
          'C:\\Program Files (x86)\\mosquitto\\mosquitto.exe',
          'mosquitto.exe',
        ]
      : ['/usr/bin/mosquitto', '/usr/local/bin/mosquitto', '/opt/mosquitto/bin/mosquitto', 'mosquitto'];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return new Promise((resolve) => {
      const command = isWindows ? 'where' : 'which';
      const proc = spawn(command, ['mosquitto'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let output = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('exit', (code) => {
        if (code === 0 && output.trim()) {
          resolve(output.trim().split('\n')[0]);
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  }

  private generateMosquittoConfig(config: MqttBrokerConfig): string {
    const configPath = path.join(this.configDir, 'mosquitto.conf');
    const persistenceDir = path.resolve(path.join(this.dataDir, 'persistence'));
    const passwordFile = path.resolve(path.join(this.configDir, 'passwd'));
    const aclFile = path.resolve(path.join(this.configDir, 'acl'));
    
    // Convert Windows paths to forward slashes for Mosquitto config
    // Use path.resolve to ensure absolute paths
    const normalizePath = (p: string) => {
      const resolved = path.resolve(p);
      return resolved.replace(/\\/g, '/');
    };

    // Ensure persistence directory exists and is writable
    if (!fs.existsSync(persistenceDir)) {
      fs.mkdirSync(persistenceDir, { recursive: true });
    }
    // Test write permissions
    try {
      const testFile = path.join(persistenceDir, '.test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log(`Persistence directory is writable: ${persistenceDir}`);
    } catch (error: any) {
      console.warn(`Warning: Persistence directory may not be writable: ${error.message}`);
    }

    let configContent = `# Mosquitto Configuration - LT IDP
# Generated automatically - do not edit manually

# Basic listener on all interfaces (0.0.0.0) for local network access
# This allows devices on your local network to connect to this broker
listener ${config.port} 0.0.0.0

`;

    // Handle authentication
    if (!config.allowAnonymous && config.username && config.password) {
      // Generate password file using mosquitto_passwd command
      // Note: This requires mosquitto_passwd to be available in PATH
      try {
        const { execSync } = require('child_process');
        // Remove password file if exists
        if (fs.existsSync(passwordFile)) {
          fs.unlinkSync(passwordFile);
        }
        // Create password file using mosquitto_passwd
        // -c creates the file, -b allows batch mode with password as argument
        execSync(`mosquitto_passwd -c -b "${passwordFile}" "${config.username}" "${config.password}"`, {
          stdio: 'ignore',
        });
        console.log(`Password file created for user: ${config.username}`);
      } catch (error: any) {
        console.warn('Could not create password file with mosquitto_passwd:', error.message);
        console.warn('Authentication may not work. Please ensure mosquitto_passwd is in your PATH.');
        // Fallback: create a simple password file (won't work with mosquitto, but won't crash)
        fs.writeFileSync(passwordFile, `# Password file - please use mosquitto_passwd to create properly\n`);
      }
      
      configContent += `# Password file for authentication
password_file ${normalizePath(passwordFile)}

# ACL file for access control
acl_file ${normalizePath(aclFile)}

# Disable anonymous access
allow_anonymous false

`;
      
      // Create ACL file - allow all topics for authenticated users
      fs.writeFileSync(aclFile, `user ${config.username}\ntopic readwrite #\n`);
    } else {
      configContent += `# Allow anonymous connections (no authentication required)
allow_anonymous true

`;
    }

    // WebSocket support
    if (config.wsPort && config.wsPort > 0) {
      configContent += `# WebSocket support on all interfaces for browser-based clients
listener ${config.wsPort} 0.0.0.0
protocol websockets

`;
    }

    // Persistence configuration
    if (config.persistenceEnabled) {
      // Ensure persistence directory exists
      const resolvedPersistenceDir = path.resolve(persistenceDir);
      if (!fs.existsSync(resolvedPersistenceDir)) {
        fs.mkdirSync(resolvedPersistenceDir, { recursive: true });
      }
      const normalizedPersistenceDir = normalizePath(resolvedPersistenceDir);
      configContent += `# Message persistence
persistence true
persistence_location ${normalizedPersistenceDir}
persistence_file mosquitto.db

`;
      console.log(`Persistence directory (resolved): ${resolvedPersistenceDir}`);
      console.log(`Persistence directory (normalized): ${normalizedPersistenceDir}`);
    } else {
      configContent += `# Message persistence disabled
persistence false

`;
    }

    // Logging configuration
    configContent += `# Logging
log_dest stdout
log_type ${config.logLevel || 'warning'}

# Connection limits
max_connections ${config.maxConnections || 100}

`;

    // TLS/SSL configuration
    if (config.useTls && config.tlsCert && config.tlsKey) {
      configContent += `# TLS/SSL configuration
cafile ${normalizePath(config.tlsCa || '')}
certfile ${normalizePath(config.tlsCert)}
keyfile ${normalizePath(config.tlsKey)}
require_certificate false

`;
    }

    fs.writeFileSync(configPath, configContent);
    console.log(`Mosquitto config written to: ${configPath}`);
    console.log(`Full config file contents:\n${configContent}`);
    console.log(`Broker configured to listen on 0.0.0.0:${config.port} (all network interfaces)`);
    return configPath;
  }

  private parseLogMessage(message: string): void {
    if (message.includes('New connection')) {
      this.status.connections = (this.status.connections || 0) + 1;
    }
    if (message.includes('Client') && message.includes('disconnected')) {
      this.status.connections = Math.max(0, (this.status.connections || 0) - 1);
    }
  }
}

