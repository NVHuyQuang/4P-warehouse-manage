'use client';

import React, { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log unexpected client runtime error to standard console
    console.error('Unhandled runtime application error:', error);
  }, [error]);

  return (
    <div style={{ padding: '60px 20px', maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--disp)', fontSize: 28, fontWeight: 700, color: 'var(--terra)', letterSpacing: '.05em', marginBottom: 12 }}>
        APPLICATION RUNTIME NOTICE
      </div>
      <p style={{ color: 'var(--ink-2)', marginBottom: 20, fontSize: 14 }}>
        An unexpected error occurred during client interface rendering.
      </p>
      <div style={{ background: 'var(--paper)', border: '1px solid var(--rule)', padding: '12px 16px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'left', marginBottom: 24, wordBreak: 'break-all' }}>
        {error.message || 'Unknown application error'}
      </div>
      <button onClick={() => reset()} className="btn btn-p" type="button">
        Retry Action
      </button>
    </div>
  );
}
