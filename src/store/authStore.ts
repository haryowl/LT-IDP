import { create } from 'zustand';

export type UserRole = 'admin' | 'viewer' | 'guest';

interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  username: string | null;
  role: UserRole | null;
  login: (token: string, username: string, role: UserRole) => void;
  logout: () => void;
  setFromSession: (token: string, username: string, role: UserRole) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  token: null,
  username: null,
  role: null,
  login: (token: string, username: string, role: UserRole) => {
    set({ isAuthenticated: true, token, username, role });
  },
  logout: () => {
    set({ isAuthenticated: false, token: null, username: null, role: null });
  },
  setFromSession: (token: string, username: string, role: UserRole) => {
    set({ isAuthenticated: true, token, username, role });
  },
}));

