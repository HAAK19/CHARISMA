import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

registerSW({ immediate: true });

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || 'Unexpected rendering error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#05070D] text-[#F2F6FF] flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-[#0C1222] border border-white/15 rounded-2xl p-6 space-y-3">
            <h1 className="text-lg font-bold text-[#00E5FF]">CHARISMA</h1>
            <p className="text-xs text-slate-300">
              Could not initialize the app UI cleanly ({this.state.message}). Please reload or ensure browser storage (IndexedDB) is enabled.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-[#00E5FF] text-[#041018] text-xs font-semibold"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
