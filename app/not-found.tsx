'use client';

import React from 'react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ padding: '60px 20px', maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--disp)', fontSize: 32, fontWeight: 700, letterSpacing: '.05em', marginBottom: 12 }}>
        404 — PAGE NOT FOUND
      </div>
      <p style={{ color: 'var(--ink-2)', marginBottom: 24, fontSize: 14 }}>
        The requested inventory navigation route does not exist or has been relocated.
      </p>
      <Link href="/overview" className="btn btn-p" style={{ display: 'inline-block', textDecoration: 'none' }}>
        Return to Stock Overview
      </Link>
    </div>
  );
}
