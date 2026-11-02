'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface ToastContextValue {
  showToast: (message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

export interface ToastProps {
  message?: string | null;
  className?: string;
}

export function Toast({ message, className = '' }: ToastProps) {
  if (!message) return null;
  return (
    <div className={`toast ${className}`.trim()} role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toast message={toastMessage} />
    </ToastContext.Provider>
  );
}
