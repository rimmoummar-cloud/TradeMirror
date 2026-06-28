import { create } from 'zustand';

export interface DebugLog {
  id: string;
  timestamp: number;
  type: 'request' | 'response' | 'error' | 'ui_action';
  method?: string;
  url?: string;
  payload?: any;
  debug?: any; // The debug envelope from backend
  message?: string;
}

interface DebugState {
  isDebugMode: boolean;
  logs: DebugLog[];
  toggleDebugMode: () => void;
  addLog: (log: Omit<DebugLog, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
}

export const useDebugStore = create<DebugState>((set) => ({
  isDebugMode: localStorage.getItem('DEBUG_MODE') === 'true',
  logs: [],
  toggleDebugMode: () => set((state) => {
    const next = !state.isDebugMode;
    localStorage.setItem('DEBUG_MODE', String(next));
    return { isDebugMode: next };
  }),
  addLog: (log) => set((state) => ({
    logs: [{ ...log, id: Math.random().toString(36).slice(2), timestamp: Date.now() }, ...state.logs].slice(0, 100) // keep last 100
  })),
  clearLogs: () => set({ logs: [] }),
}));
