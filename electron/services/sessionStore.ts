import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';
import { getLogger } from './logger';

export interface StoredSession {
  token: string;
  username: string;
  role: 'admin' | 'viewer';
}

const SESSION_FILE = 'session.bin';
const SESSION_FILE_PLAIN = 'session.json';

function getSessionPath(): string {
  return path.join(app.getPath('userData'), SESSION_FILE);
}

function getSessionPathPlain(): string {
  return path.join(app.getPath('userData'), SESSION_FILE_PLAIN);
}

export function setStoredSession(session: StoredSession): void {
  const payload = JSON.stringify(session);
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(payload);
      fs.writeFileSync(getSessionPath(), encrypted, { flag: 'w' });
      if (fs.existsSync(getSessionPathPlain())) fs.unlinkSync(getSessionPathPlain());
    } else {
      fs.writeFileSync(getSessionPathPlain(), payload, { flag: 'w' });
      if (fs.existsSync(getSessionPath())) fs.unlinkSync(getSessionPath());
    }
  } catch (error: any) {
    getLogger().error('Failed to store session:', error?.message);
    throw error;
  }
}

export function getStoredSession(): StoredSession | null {
  try {
    const p = getSessionPath();
    const pPlain = getSessionPathPlain();
    if (fs.existsSync(p)) {
      const encrypted = fs.readFileSync(p);
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted) as StoredSession;
    }
    if (fs.existsSync(pPlain)) {
      const data = fs.readFileSync(pPlain, 'utf-8');
      return JSON.parse(data) as StoredSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearStoredSession(): void {
  try {
    const p = getSessionPath();
    const pPlain = getSessionPathPlain();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    if (fs.existsSync(pPlain)) fs.unlinkSync(pPlain);
  } catch (error: any) {
    getLogger().error('Failed to clear session:', error?.message);
  }
}
