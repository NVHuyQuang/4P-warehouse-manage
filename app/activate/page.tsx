'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Pizza4PsLogo } from '@/components/ui/rail';
import { dispatchAction } from '@/lib/actions/dispatch';
import { activateUserWithToken } from '@/lib/data/users';

function ActivateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get('token') || '';

  const { showToast } = useShell();

  const [token, setToken] = useState(tokenParam);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isActivated, setIsActivated] = useState(false);
  const [activatedEmail, setActivatedEmail] = useState<string | null>(null);

  useEffect(() => {
    if (tokenParam) {
      setToken(tokenParam);
    }
  }, [tokenParam]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token.trim()) {
      setError('Activation token is required. Please check your invitation email link.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setIsSubmitting(true);

    const result = await dispatchAction({
      actionName: 'ACTIVATE_USER_ACCOUNT',
      payload: { token: token.trim() },
      execute: async () => {
        const response = await activateUserWithToken(token.trim(), password);
        if (!response.success) {
          throw new Error('Invalid or expired activation link.');
        }
        return response;
      },
      onSuccess: (data) => {
        setIsSubmitting(false);
        setIsActivated(true);
        if (data.email) {
          setActivatedEmail(data.email);
        }
        showToast('Account activated successfully. You can now sign in.');
      },
      onError: (err) => {
        setIsSubmitting(false);
        setError(err.message || 'Failed to activate account. The invitation link may have expired.');
      },
    });

    if (!result.success) {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '40px auto 60px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-block', marginBottom: 12 }}>
          <Pizza4PsLogo className="logo" />
        </div>
        <div className="kicker" style={{ marginTop: 8 }}>
          Onboarding &middot; Staff Account Activation
        </div>
        <h1 className="h1" style={{ fontSize: 36, marginTop: 4 }}>
          Set Your <em>Password</em>
        </h1>
        <p className="sub" style={{ marginTop: 6 }}>
          Decision 1: Passwords are never shown, set or seen by System Admin. Establish your private password below.
        </p>
      </div>

      <Ticket
        no="FLOW 0 · ONBOARDING"
        right={
          isActivated ? (
            <Badge variant="ok">ACTIVATED</Badge>
          ) : token ? (
            <Badge variant="re">TOKEN ATTACHED</Badge>
          ) : (
            <Badge variant="am">TOKEN REQUIRED</Badge>
          )
        }
      >
        {isActivated ? (
          <div>
            <div className="note ok" style={{ marginBottom: 18 }}>
              <b>Account Successfully Activated!</b>
              {activatedEmail && (
                <div>
                  Your staff account <code>{activatedEmail}</code> is now ready.
                </div>
              )}
              <div style={{ marginTop: 6, fontSize: 13 }}>
                Your private credentials are encrypted within Supabase Auth.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
              <Link href="/login" className="btn">
                Proceed to Sign In
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleActivate}>
            {error && (
              <div className="note er" style={{ marginBottom: 16 }}>
                <b>Activation Error:</b> {error}
              </div>
            )}

            {!tokenParam && (
              <div className="fld">
                <label className="lbl" htmlFor="token-input">
                  Activation Token
                </label>
                <input
                  id="token-input"
                  type="text"
                  className="in"
                  placeholder="Paste token from email link (e.g. token-secure-xyz-987)"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                />
                <span className="meta" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                  If you arrived directly without an invitation URL, paste your token above.
                </span>
              </div>
            )}

            {tokenParam && (
              <div className="note" style={{ marginBottom: 16, fontSize: 13 }}>
                <span className="lbl" style={{ margin: 0 }}>Valid Token Verified</span>
                <span className="meta" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                  {tokenParam.slice(0, 16)}...
                </span>
              </div>
            )}

            <div className="fld">
              <label className="lbl" htmlFor="activate-password">
                New Confidential Password *
              </label>
              <input
                id="activate-password"
                type="password"
                className="in"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isSubmitting}
                autoComplete="new-password"
              />
            </div>

            <div className="fld">
              <label className="lbl" htmlFor="activate-confirm">
                Confirm Confidential Password *
              </label>
              <input
                id="activate-confirm"
                type="password"
                className="in"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isSubmitting}
                autoComplete="new-password"
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 22 }}>
              <Link href="/login" className="btn ghost sm">
                Back to Sign In
              </Link>
              <button
                type="submit"
                className="btn"
                disabled={isSubmitting || !token || !password || !confirmPassword}
              >
                {isSubmitting ? 'Activating Account...' : 'Set Password & Activate'}
              </button>
            </div>
          </form>
        )}
      </Ticket>

      <div className="stub w" style={{ marginTop: 20 }}>
        <span className="lbl">Zero Plaintext Passwords Policy</span>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
          Under the India DPDP Act and internal security guidelines, passwords are salted and hashed exclusively via Supabase Auth. No administrator, custodian, or system process can view, retrieve, or transmit your password.
        </p>
      </div>
    </div>
  );
}

export default function ActivatePage() {
  return (
    <Suspense
      fallback={
        <div style={{ maxWidth: 640, margin: '40px auto 60px', textAlign: 'center' }}>
          <div className="kicker">Loading Invitation...</div>
        </div>
      }
    >
      <ActivateForm />
    </Suspense>
  );
}
