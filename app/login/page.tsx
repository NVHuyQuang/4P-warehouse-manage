'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { Pizza4PsLogo } from '@/components/ui/rail';
import { dispatchAction } from '@/lib/actions/dispatch';
import { supabase } from '@/lib/supabase/client';
import {
  recordFailedLogin,
  recordLoginSuccess,
  isAccountLocked,
} from '@/lib/data/users';

const SAMPLE_USERS = [
  { role: 'Warehouse Keeper', email: 'admin@example.test', roleKey: 'keeper' },
  { role: 'Restaurant Manager', email: 'rm@example.test', roleKey: 'rm' },
  { role: 'Section Requester', email: 'kitchen@example.test', roleKey: 'req' },
  { role: 'Store Accountant', email: 'accountant@example.test', roleKey: 'acct' },
  { role: 'Financial Controller', email: 'approver@example.test', roleKey: 'fc' },
  { role: 'System Admin', email: 'sysadmin@example.test', roleKey: 'admin' },
];

export default function LoginPage() {
  const router = useRouter();
  const { setRole, showToast } = useShell();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutRemainingMinutes, setLockoutRemainingMinutes] = useState<number | null>(null);

  // Password reset request state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  // Check lockout on email change/blur
  const checkEmailLockout = async (targetEmail: string) => {
    if (!targetEmail.includes('@')) return;
    try {
      const status = await isAccountLocked(targetEmail);
      setIsLocked(status.locked);
      setFailedAttempts(status.attempts);
      if (status.locked && status.lockout_until) {
        const remaining = Math.max(
          1,
          Math.ceil((new Date(status.lockout_until).getTime() - Date.now()) / (60 * 1000))
        );
        setLockoutRemainingMinutes(remaining);
      } else {
        setLockoutRemainingMinutes(null);
      }
    } catch {
      // Non-blocking
    }
  };

  const handleSelectSampleUser = (sample: (typeof SAMPLE_USERS)[0]) => {
    setEmail(sample.email);
    setPassword('Password123!');
    setErrorMessage(null);
    checkEmailLockout(sample.email);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isLocked) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    const result = await dispatchAction({
      actionName: 'AUTH_SIGN_IN',
      payload: { email: email.trim().toLowerCase() },
      execute: async () => {
        // First check lockout status
        const lockStatus = await isAccountLocked(email);
        if (lockStatus.locked) {
          throw new Error('ACCOUNT_LOCKED');
        }

        // Supabase Auth sign-in
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });

        if (error) {
          // If auth failed, record failed login
          const failure = await recordFailedLogin(email);
          setFailedAttempts(failure.failed_login_count);
          if (failure.locked) {
            setIsLocked(true);
            setLockoutRemainingMinutes(30);
            throw new Error('ACCOUNT_LOCKED_ATTEMPTS');
          }
          throw error;
        }

        // Login success: reset failure counter
        await recordLoginSuccess(email);
        return data;
      },
      onSuccess: () => {
        showToast('Signed in successfully.');

        // Route user based on matching synthetic role or email
        const found = SAMPLE_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
        if (found) {
          setRole(found.roleKey as never);
          if (found.roleKey === 'admin') {
            router.push('/users');
            return;
          }
        }
        router.push('/overview');
      },
      onError: (err) => {
        setIsSubmitting(false);
        if (err.message === 'ACCOUNT_LOCKED' || err.message === 'ACCOUNT_LOCKED_ATTEMPTS') {
          setIsLocked(true);
          setErrorMessage('Account is locked due to 5 consecutive failed login attempts.');
        } else {
          setErrorMessage(err.message || 'Invalid email or password.');
        }
      },
    });

    if (!result.success) {
      setIsSubmitting(false);
    }
  };

  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail || resetSubmitting) return;

    setResetSubmitting(true);
    await dispatchAction({
      actionName: 'REQUEST_PASSWORD_RESET',
      payload: { email: resetEmail },
      execute: async () => {
        // Supabase Auth reset password
        const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim().toLowerCase(), {
          redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/activate` : undefined,
        });
        if (error) {
          // Don't leak whether email exists
        }
        return { success: true };
      },
      onSuccess: () => {
        setResetSubmitting(false);
        setResetSent(true);
        showToast('Password reset link sent.');
      },
      onError: () => {
        setResetSubmitting(false);
        setResetSent(true); // Uniform response
      },
    });
  };

  return (
    <div style={{ maxWidth: 760, margin: '40px auto 60px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-block', marginBottom: 12 }}>
          <Pizza4PsLogo className="logo" />
        </div>
        <div className="kicker" style={{ marginTop: 8 }}>
          Internal Stock &amp; Inventory Access
        </div>
        <h1 className="h1" style={{ fontSize: 36, marginTop: 4 }}>
          Sign In to <em>Workspace</em>
        </h1>
        <p className="sub" style={{ marginTop: 6 }}>
          Physical quantities in kg and pcs &middot; Strict operational counts &middot; Secure Supabase Auth
        </p>
      </div>

      <Ticket
        no="AUTH · FLOW 0"
        right={
          isLocked ? (
            <Badge variant="er">LOCKED</Badge>
          ) : (
            <Badge variant="ok">SUPABASE AUTH</Badge>
          )
        }
        className="stack"
      >
        {isLocked && (
          <div className="note er" style={{ marginBottom: 16 }}>
            <b>Account Locked.</b> 5 consecutive failed attempts detected (limit 5).
            {lockoutRemainingMinutes != null && (
              <span> Time remaining until unlock: <b>{lockoutRemainingMinutes} minutes</b>.</span>
            )}
            <div style={{ marginTop: 6, fontSize: 13 }}>
              System Admin has been notified. Contact System Admin to unlock and reset your attempt counter immediately.
            </div>
          </div>
        )}

        {errorMessage && !isLocked && (
          <div className="note er" style={{ marginBottom: 16 }}>
            <b>Authentication Failed:</b> {errorMessage}
            {failedAttempts > 0 && failedAttempts < 5 && (
              <div style={{ marginTop: 4, fontSize: 12 }}>
                Attempt {failedAttempts} of 5 before account lock.
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSignIn}>
          <div className="fld">
            <label className="lbl" htmlFor="login-email">
              Staff Email Address
            </label>
            <input
              id="login-email"
              type="email"
              className={`in ${errorMessage ? 'err' : ''}`}
              placeholder="name@example.test"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => checkEmailLockout(email)}
              required
              disabled={isSubmitting || isLocked}
              autoComplete="username"
            />
          </div>

          <div className="fld">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label className="lbl" htmlFor="login-password">
                Private Password
              </label>
              <button
                type="button"
                className="btn ghost sm"
                style={{ padding: '0 4px', fontSize: 12, border: 0, textDecoration: 'underline' }}
                onClick={() => {
                  setResetEmail(email || '');
                  setShowResetModal(true);
                  setResetSent(false);
                }}
              >
                Forgot password?
              </button>
            </div>
            <input
              id="login-password"
              type="password"
              className="in"
              placeholder="Enter your confidential password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isSubmitting || isLocked}
              autoComplete="current-password"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 22 }}>
            <span className="meta" style={{ fontSize: 12 }}>
              Passwords are never logged or stored in application tables.
            </span>
            <button
              type="submit"
              className="btn"
              disabled={isSubmitting || isLocked || !email || !password}
            >
              {isSubmitting ? 'Authenticating...' : isLocked ? 'Account Locked' : 'Sign In'}
            </button>
          </div>
        </form>

        <div style={{ marginTop: 24, borderTop: '1px dashed var(--rule)', paddingTop: 18 }}>
          <span className="lbl" style={{ marginBottom: 8 }}>
            Sample Synthetic Test Identities (@example.test)
          </span>
          <Chips>
            {SAMPLE_USERS.map((sample) => (
              <Chip
                key={sample.email}
                label={`${sample.role} (${sample.email.split('@')[0]})`}
                onClick={() => handleSelectSampleUser(sample)}
              />
            ))}
          </Chips>
          <p className="gloss" style={{ margin: '8px 0 0' }}>
            Click any test identity to pre-fill credentials for local testing.
          </p>
        </div>
      </Ticket>

      <div className="stub w" style={{ marginTop: 20 }}>
        <span className="lbl">India DPDP Act &amp; Privacy Compliance</span>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
          All test personas utilize synthetic non-commercial domains (<code>@example.test</code>). Passwords and cryptographic secrets are isolated within Supabase Auth and never accessible to ledger or inventory tables.
        </p>
      </div>

      {/* Password Reset Request Modal / Dialog */}
      {showResetModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(23, 28, 43, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 20,
          }}
        >
          <div
            className="tk"
            style={{
              width: 520,
              maxWidth: '100%',
              borderRadius: 4,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
          >
            <div className="tk-head">
              <span className="no" id="reset-modal-title">
                PASSWORD RESET REQUEST
              </span>
              <span className="fill" />
              <Badge variant="re">TOKEN EMAIL</Badge>
            </div>

            <div className="tk-body">
              {resetSent ? (
                <div>
                  <div className="note ok" style={{ marginBottom: 16 }}>
                    <b>Reset Link Dispatched.</b> If an active account matches <code>{resetEmail}</code>, an activation/reset link has been sent. Please check your inbox.
                  </div>
                  <p className="sub" style={{ fontSize: 13, margin: '0 0 16px' }}>
                    Per Decision 1, no temporary passwords are used. The link will allow you to establish a new private password directly.
                  </p>
                  <div style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setShowResetModal(false)}
                    >
                      Return to Sign In
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleRequestPasswordReset}>
                  <p className="sub" style={{ margin: '0 0 14px' }}>
                    Enter your registered staff email address. A private reset token link will be dispatched to your inbox.
                  </p>

                  <div className="fld">
                    <label htmlFor="reset-email" className="lbl">
                      Staff Email Address
                    </label>
                    <input
                      id="reset-email"
                      type="email"
                      className="in"
                      placeholder="name@example.test"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setShowResetModal(false)}
                      disabled={resetSubmitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn"
                      disabled={resetSubmitting || !resetEmail}
                    >
                      {resetSubmitting ? 'Dispatching...' : 'Send Reset Link'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
