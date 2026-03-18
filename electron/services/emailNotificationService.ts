import nodemailer from 'nodemailer';
import fs from 'fs';
import type { DatabaseService } from './database';
import { getLogger } from './logger';

export interface SparingSendLoggedInfo {
  sendType: 'hourly' | '2min' | 'testing';
  hourTimestamp: number | null;
  recordsCount: number;
  status: 'success' | 'failed';
  response: string;
  durationMs: number;
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 4000);
}

function tailAppLog(filePath: string, maxLines: number, maxBytes: number): string {
  try {
    if (!fs.existsSync(filePath)) return '(Log file not found)';
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return '(Empty)';
    const readSize = Math.min(maxBytes, stat.size);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split(/\r?\n/);
    return lines.slice(-maxLines).join('\n') || '(Empty)';
  } catch (e: any) {
    return `(Could not read log: ${e?.message || e})`;
  }
}

export class EmailNotificationService {
  private scheduledRunning = false;
  private triggerRunning = false;

  constructor(
    private db: DatabaseService,
    private getAppLogFilePath: () => string
  ) {}

  /** Safe for API: no raw SMTP password */
  getSettingsForApi(): Record<string, unknown> {
    const s = this.db.getEmailNotificationSettings();
    return {
      id: s.id,
      smtpHost: s.smtpHost,
      smtpPort: s.smtpPort,
      smtpSecure: s.smtpSecure,
      smtpUser: s.smtpUser,
      smtpPasswordConfigured: !!(s.smtpPassword && s.smtpPassword.length > 0),
      fromAddress: s.fromAddress,
      toAddresses: s.toAddresses,
      scheduleEnabled: s.scheduleEnabled,
      scheduleTime: s.scheduleTime,
      scheduleIncludeSparing: s.scheduleIncludeSparing,
      scheduleIncludeAppLog: s.scheduleIncludeAppLog,
      scheduleOnlyIfActivity: s.scheduleOnlyIfActivity,
      triggerSparingFailure: s.triggerSparingFailure,
      triggerCooldownMinutes: s.triggerCooldownMinutes,
      lastScheduledRunDate: s.lastScheduledRunDate,
      lastTriggerSentAt: s.lastTriggerSentAt,
      updatedAt: s.updatedAt,
    };
  }

  saveSettings(updates: {
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
    smtpUser?: string;
    smtpPassword?: string;
    fromAddress?: string;
    toAddresses?: string;
    scheduleEnabled?: boolean;
    scheduleTime?: string;
    scheduleIncludeSparing?: boolean;
    scheduleIncludeAppLog?: boolean;
    scheduleOnlyIfActivity?: boolean;
    triggerSparingFailure?: boolean;
    triggerCooldownMinutes?: number;
  }): void {
    this.db.upsertEmailNotificationSettings(updates);
  }

  private buildTransporter() {
    const s = this.db.getEmailNotificationSettings();
    if (!s.smtpHost?.trim()) throw new Error('SMTP host is required');
    return nodemailer.createTransport({
      host: s.smtpHost.trim(),
      port: s.smtpPort || 587,
      secure: s.smtpSecure,
      auth:
        s.smtpUser && s.smtpPassword
          ? { user: s.smtpUser.trim(), pass: s.smtpPassword }
          : s.smtpUser
            ? { user: s.smtpUser.trim(), pass: s.smtpPassword || '' }
            : undefined,
    });
  }

  async sendMail(subject: string, html: string, text?: string): Promise<void> {
    const s = this.db.getEmailNotificationSettings();
    const to = (s.toAddresses || '')
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (to.length === 0) throw new Error('At least one recipient (To) is required');
    const from = (s.fromAddress || s.smtpUser || '').trim();
    if (!from) throw new Error('From address is required');
    const transporter = this.buildTransporter();
    await transporter.sendMail({
      from,
      to: to.join(', '),
      subject,
      text: text || subject,
      html,
    });
  }

  async testEmail(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.sendMail(
        'LT-IDP — test email',
        '<p>This is a test message from your IoT SCADA / LT-IDP client.</p><p>If you received this, SMTP settings are working.</p>'
      );
      return { ok: true };
    } catch (e: any) {
      getLogger().error('Test email failed:', e?.message || e);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async onSparingSendLogged(info: SparingSendLoggedInfo): Promise<void> {
    if (info.status !== 'failed') return;
    if (this.triggerRunning) return;
    const s = this.db.getEmailNotificationSettings();
    if (!s.triggerSparingFailure || !s.smtpHost?.trim()) return;
    const to = (s.toAddresses || '').trim();
    if (!to) return;
    const cooldownMs = (s.triggerCooldownMinutes || 60) * 60 * 1000;
    if (s.lastTriggerSentAt && Date.now() - s.lastTriggerSentAt < cooldownMs) return;

    this.triggerRunning = true;
    try {
      await this.sendMail(
        `[LT-IDP] SPARING send failed (${info.sendType})`,
        `<p><strong>SPARING transmission failed</strong></p>
        <ul>
          <li>Send type: ${escHtml(info.sendType)}</li>
          <li>Records: ${info.recordsCount}</li>
          <li>Response / error: <pre style="white-space:pre-wrap">${escHtml(info.response)}</pre></li>
          <li>Time: ${new Date().toISOString()}</li>
        </ul>`
      );
      this.db.setEmailLastTriggerSent(Date.now());
    } catch (e: any) {
      getLogger().error('SPARING failure alert email failed:', e?.message || e);
    } finally {
      this.triggerRunning = false;
    }
  }

  /** Call once per minute from main process / server */
  tickScheduled(): void {
    if (this.scheduledRunning) return;
    const s = this.db.getEmailNotificationSettings();
    if (!s.scheduleEnabled || !s.smtpHost?.trim() || !(s.toAddresses || '').trim()) return;

    const parts = (s.scheduleTime || '08:00').split(':');
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1] ?? '0', 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return;

    const now = new Date();
    if (now.getHours() !== hh || now.getMinutes() !== mm) return;

    const today = now.toISOString().split('T')[0];
    if (s.lastScheduledRunDate === today) return;

    this.scheduledRunning = true;
    this.db.setEmailLastScheduledRunDate(today);

    void this.runScheduledDigest(s)
      .catch((e) => getLogger().error('Scheduled digest email failed:', e?.message || e))
      .finally(() => {
        this.scheduledRunning = false;
      });
  }

  private async runScheduledDigest(s: ReturnType<DatabaseService['getEmailNotificationSettings']>): Promise<void> {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const db = this.db.getDb();

    let sparingSection = '';
    if (s.scheduleIncludeSparing) {
      const total = (
        db.prepare('SELECT COUNT(*) as c FROM sparing_logs WHERE timestamp > ?').get(since) as any
      )?.c as number;
      if (s.scheduleOnlyIfActivity && total === 0) {
        getLogger().info('Scheduled email: skipped (no SPARING activity in 24h)');
        return;
      }
      const byStatus = db
        .prepare(
          `SELECT send_type, status, COUNT(*) as cnt FROM sparing_logs 
           WHERE timestamp > ? GROUP BY send_type, status`
        )
        .all(since) as { send_type: string; status: string; cnt: number }[];
      const fails = db
        .prepare(
          `SELECT send_type, response, timestamp FROM sparing_logs 
           WHERE status = 'failed' AND timestamp > ? ORDER BY timestamp DESC LIMIT 8`
        )
        .all(since) as { send_type: string; response: string; timestamp: number }[];

      let rows = '<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Type</th><th>Status</th><th>Count</th></tr>';
      for (const r of byStatus) {
        rows += `<tr><td>${escHtml(r.send_type)}</td><td>${escHtml(r.status)}</td><td>${r.cnt}</td></tr>`;
      }
      rows += '</table>';
      if (fails.length) {
        rows += '<p><strong>Recent failures</strong></p><ul>';
        for (const f of fails) {
          rows += `<li>${new Date(f.timestamp).toISOString()} [${escHtml(f.send_type)}]: ${escHtml(f.response)}</li>`;
        }
        rows += '</ul>';
      }
      sparingSection = `<h2>SPARING (last 24h)</h2><p>Total events: ${total}</p>${rows}`;
    } else if (s.scheduleOnlyIfActivity) {
      getLogger().info('Scheduled email: SPARING section disabled; skipping only-if-activity check edge case');
    }

    let appSection = '';
    if (s.scheduleIncludeAppLog) {
      const path = this.getAppLogFilePath();
      const tail = tailAppLog(path, 80, 48 * 1024);
      appSection = `<h2>Application log (tail)</h2><pre style="white-space:pre-wrap;font-size:12px">${escHtml(tail)}</pre>`;
    }

    if (!sparingSection && !appSection) {
      sparingSection = '<p>No sections enabled for digest.</p>';
    }

    const body = `<p>Scheduled report from LT-IDP / IoT SCADA Client.</p>${sparingSection}${appSection}`;
    await this.sendMail(`[LT-IDP] Daily log digest ${new Date().toISOString().split('T')[0]}`, body);
    getLogger().info('Scheduled digest email sent');
  }
}
