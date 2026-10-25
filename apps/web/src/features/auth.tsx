import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

async function authRequest(path: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    code?: string;
    url?: string;
  };
  if (!response.ok) {
    if (response.status === 429)
      throw new Error('Too many attempts. Please wait a minute and try again.');
    if (
      ['INVALID_OTP', 'OTP_EXPIRED', 'TOO_MANY_ATTEMPTS'].includes(
        data.code ?? '',
      )
    )
      throw new Error(
        'This code is incorrect or has expired. Check your latest email or request a new code.',
      );
    throw new Error('Sign-in is temporarily unavailable. Please try again.');
  }
  return data;
}

export function SignIn({
  localMailbox,
  googleEnabled,
  emailEnabled,
  onSuccess,
}: {
  localMailbox: boolean;
  googleEnabled: boolean;
  emailEnabled: boolean;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === 'code') codeInput.current?.focus();
  }, [step]);
  useEffect(() => {
    const update = () =>
      setSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);
  async function sendCode() {
    await authRequest('email-otp/send-verification-otp', {
      email: email.trim(),
      type: 'sign-in',
    });
    setOtp('');
    setResendAt(Date.now() + 60000);
    setStep('code');
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-form">
      <p className="auth-intro">
        {step === 'email'
          ? 'Your journeys, all in one place.'
          : 'Check your inbox'}
      </p>
      {step === 'email' ? (
        <>
          <button
            type="button"
            className="google-button secondary"
            disabled={busy || !googleEnabled}
            onClick={() =>
              void run(async () => {
                const data = await authRequest('sign-in/social', {
                  provider: 'google',
                  callbackURL: `${window.location.pathname}${window.location.search}`,
                  errorCallbackURL: `${window.location.pathname}${window.location.search}${window.location.search ? '&' : '?'}authError=true`,
                });
                if (!data.url)
                  throw new Error('Google sign-in is unavailable.');
                const url = new URL(data.url);
                if (url.origin !== 'https://accounts.google.com')
                  throw new Error('Google sign-in is unavailable.');
                window.location.assign(url.href);
              })
            }
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
              />
              <path
                fill="#34A853"
                d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#FBBC05"
                d="M6.41 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.92V7.49H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.51l3.34-2.59Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z"
              />
            </svg>
            Continue with Google
          </button>
          {!googleEnabled && (
            <small className="muted">Google sign-in is being configured.</small>
          )}
          <div className="auth-divider">
            <span>or continue with email</span>
          </div>
        </>
      ) : (
        <p>
          We sent a six-digit code to{' '}
          <strong className="auth-email">{email}</strong>. It expires in five
          minutes.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (step === 'email') await sendCode();
            else {
              await authRequest('sign-in/email-otp', {
                email: email.trim(),
                otp,
              });
              await router.invalidate();
              window.dispatchEvent(new Event('kwikbus:session'));
              onSuccess();
            }
          });
        }}
      >
        {step === 'email' ? (
          <>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              disabled={busy || !emailEnabled}
            />
          </>
        ) : (
          <>
            <label htmlFor="otp">Verification code</label>
            <input
              ref={codeInput}
              id="otp"
              className="otp-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={otp}
              disabled={busy}
              onChange={(event) =>
                setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="000000"
            />
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!emailEnabled && (
          <p className="auth-note">
            Email sign-in is temporarily unavailable. Please use Google.
          </p>
        )}
        <button
          type="submit"
          className="auth-submit"
          disabled={busy || !emailEnabled}
        >
          {busy
            ? 'Please wait…'
            : step === 'email'
              ? 'Continue with email'
              : 'Verify and sign in'}
        </button>
      </form>
      {step === 'code' && (
        <div className="auth-actions">
          <button
            type="button"
            className="text-button"
            disabled={busy || seconds > 0}
            onClick={() => void run(sendCode)}
          >
            {seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code'}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setStep('email');
              setError('');
              setOtp('');
            }}
          >
            Use another email
          </button>
        </div>
      )}
      <p className="auth-note">
        No password needed. New here? We’ll create your account when you sign
        in.
      </p>
      <p className="auth-note">
        By continuing, you agree to our{' '}
        <a href="/?view=terms" target="_blank" rel="noreferrer">
          Terms
        </a>{' '}
        and acknowledge our{' '}
        <a href="/?view=privacy" target="_blank" rel="noreferrer">
          Privacy notice
        </a>
        .
      </p>
      {localMailbox && (
        <a
          className="local-mailbox"
          href="http://localhost:8025"
          target="_blank"
          rel="noreferrer"
        >
          Open the local development inbox
        </a>
      )}
    </div>
  );
}

export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const response = await fetch('/api/auth/sign-out', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            });
            if (!response.ok) throw new Error();
            await router.invalidate();
            window.dispatchEvent(new Event('kwikbus:session'));
          } catch {
            setError('Sign-out could not be confirmed. Please try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}
