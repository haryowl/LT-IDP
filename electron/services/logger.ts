import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';

export class Logger {
  private logDir: string;
  private currentLogFile: string;
  private currentDate: string;
  private logStream: fs.WriteStream | null = null;

  constructor() {
    // Use app.getPath('userData') if available, otherwise use process.cwd()
    let baseDir: string;
    try {
      if (app && app.isReady()) {
        baseDir = app.getPath('userData');
      } else {
        // Fallback to userData path even if app not ready (for Windows: %APPDATA%)
        baseDir = path.join(os.homedir(), 'AppData', 'Roaming', 'ClientAPP');
      }
    } catch {
      baseDir = process.cwd();
    }
    
    this.logDir = path.join(baseDir, 'logs');
    this.currentDate = this.getDateString();
    this.currentLogFile = path.join(this.logDir, `app-${this.currentDate}.log`);

    // Ensure log directory exists
    this.ensureLogDir();

    // Initialize log stream
    this.initializeLogStream();

    // Rotate logs daily
    this.scheduleDailyRotation();
  }

  private ensureLogDir(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error: any) {
      console.error('Failed to create log directory:', error.message);
    }
  }

  private getDateString(): string {
    const now = new Date();
    return now.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  private initializeLogStream(): void {
    try {
      // Close existing stream if any
      if (this.logStream) {
        this.logStream.end();
      }

      // Open new stream in append mode
      this.logStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
      
      // Write initial message
      this.writeToFile(`\n${'='.repeat(80)}\n`);
      this.writeToFile(`Application started at ${new Date().toISOString()}\n`);
      this.writeToFile(`${'='.repeat(80)}\n`);
    } catch (error: any) {
      console.error('Failed to initialize log stream:', error.message);
    }
  }

  private scheduleDailyRotation(): void {
    // Check every hour if we need to rotate
    setInterval(() => {
      const today = this.getDateString();
      if (today !== this.currentDate) {
        this.currentDate = today;
        this.currentLogFile = path.join(this.logDir, `app-${today}.log`);
        this.initializeLogStream();
        this.log('info', 'Log file rotated to new day');
      }
    }, 3600000); // Check every hour
  }

  writeToFile(message: string): void {
    if (this.logStream && this.logStream.writable) {
      try {
        this.logStream.write(message);
      } catch (error: any) {
        console.error('Failed to write to log file:', error.message);
      }
    }
  }

  formatMessage(level: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    return `[${timestamp}] [${level.toUpperCase()}] ${formattedArgs}\n`;
  }

  log(level: string, ...args: any[]): void {
    const message = this.formatMessage(level, ...args);
    
    // Write to console (preserve original behavior)
    if (level === 'error') {
      console.error(...args);
    } else {
      console.log(...args);
    }

    // Write to file
    this.writeToFile(message);
  }

  info(...args: any[]): void {
    this.log('info', ...args);
  }

  error(...args: any[]): void {
    this.log('error', ...args);
  }

  warn(...args: any[]): void {
    this.log('warn', ...args);
  }

  debug(...args: any[]): void {
    this.log('debug', ...args);
  }

  getLogDirectory(): string {
    return this.logDir;
  }

  getCurrentLogFile(): string {
    return this.currentLogFile;
  }

  cleanup(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}

// Global logger instance
let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger();
  }
  return loggerInstance;
}

// Override console methods to also log to file
export function setupConsoleLogging(): void {
  const logger = getLogger();
  
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  console.log = (...args: any[]) => {
    originalLog(...args);
    logger.writeToFile(logger.formatMessage('info', ...args));
  };

  console.error = (...args: any[]) => {
    originalError(...args);
    logger.writeToFile(logger.formatMessage('error', ...args));
  };

  console.warn = (...args: any[]) => {
    originalWarn(...args);
    logger.writeToFile(logger.formatMessage('warn', ...args));
  };

  console.info = (...args: any[]) => {
    originalInfo(...args);
    logger.writeToFile(logger.formatMessage('info', ...args));
  };

  console.debug = (...args: any[]) => {
    originalDebug(...args);
    logger.writeToFile(logger.formatMessage('debug', ...args));
  };
}

