import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((msg: string) => {
    setMessage(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2400);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`glass fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-surface-2 px-5 py-3 text-sm transition-all duration-200 lg:bottom-8 ${
          message ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
        }`}
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
