import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  it('starts unauthenticated', () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().username).toBeNull();
    expect(useAuthStore.getState().role).toBeNull();
  });

  it('login sets token, username, role and authenticated', () => {
    useAuthStore.getState().login('jwt-123', 'admin', 'admin');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().token).toBe('jwt-123');
    expect(useAuthStore.getState().username).toBe('admin');
    expect(useAuthStore.getState().role).toBe('admin');
  });

  it('login with viewer role', () => {
    useAuthStore.getState().login('jwt-456', 'viewer', 'viewer');
    expect(useAuthStore.getState().role).toBe('viewer');
  });

  it('setFromSession restores session', () => {
    useAuthStore.getState().setFromSession('token-789', 'operator', 'viewer');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().username).toBe('operator');
    expect(useAuthStore.getState().role).toBe('viewer');
  });

  it('logout clears state', () => {
    useAuthStore.getState().login('jwt', 'user', 'admin');
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().username).toBeNull();
    expect(useAuthStore.getState().role).toBeNull();
  });
});
