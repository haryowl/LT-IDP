import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { DatabaseService } from './database';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

export class AuthService {
  private activeSessions: Map<string, { user: any; expiresAt: number }> = new Map();

  constructor(private db: DatabaseService) {}

  async login(username: string, password: string) {
    const user = this.db.getUserByUsername(username);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    const expiresAt = Date.now() + TOKEN_EXPIRY;
    const payload = {
      userId: user.id,
      username: user.username,
      role: user.role,
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: '24h',
    });

    // Store session
    this.activeSessions.set(token, {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
      },
      expiresAt,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
      },
      expiresAt,
    };
  }

  async logout(token: string) {
    this.activeSessions.delete(token);
  }

  verifyToken(token: string): { valid: boolean; user?: { id: string; username: string; role: string; createdAt: number } } {
    try {
      const session = this.activeSessions.get(token);
      if (session) {
        if (Date.now() > session.expiresAt) {
          this.activeSessions.delete(token);
          return { valid: false };
        }
        return { valid: true, user: session.user };
      }

      // Restored session after app restart: verify JWT and re-establish session
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string; role: string; exp: number };
      const user = this.db.getUserByUsername(decoded.username);
      if (!user) return { valid: false };
      const expiresAt = decoded.exp * 1000;
      if (Date.now() > expiresAt) return { valid: false };
      this.activeSessions.set(token, {
        user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt },
        expiresAt,
      });
      return {
        valid: true,
        user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt },
      };
    } catch (error) {
      return { valid: false };
    }
  }

  cleanup() {
    // Remove expired sessions
    const now = Date.now();
    for (const [token, session] of this.activeSessions.entries()) {
      if (now > session.expiresAt) {
        this.activeSessions.delete(token);
      }
    }
  }
}

