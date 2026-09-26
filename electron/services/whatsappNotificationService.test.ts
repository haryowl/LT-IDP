import { describe, expect, it } from 'vitest';
import { normalizePhone, truncateMessage } from './whatsappNotificationService';

describe('whatsappNotificationService helpers', () => {
  it('normalizePhone converts local 0-prefix to 62', () => {
    expect(normalizePhone('081234567890')).toBe('6281234567890');
    expect(normalizePhone('+6281234567890')).toBe('6281234567890');
    expect(normalizePhone('62 812-3456-7890')).toBe('6281234567890');
  });

  it('truncateMessage respects 1024 limit', () => {
    const long = 'a'.repeat(1100);
    const out = truncateMessage(long);
    expect(out.length).toBe(1024);
    expect(out.endsWith('...')).toBe(true);
  });
});
