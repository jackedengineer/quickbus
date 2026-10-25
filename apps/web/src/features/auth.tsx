import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';

export function SignIn({ localMailbox }: { localMailbox: boolean }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  );
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setStatus('sending');
        try {
          const response = await fetch('/api/auth/sign-in/magic-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              callbackURL: `${window.location.pathname}${window.location.search}`,
            }),
          });
          setStatus(response.ok ? 'sent' : 'error');
        } catch {
          setStatus('error');
        }
      }}
    >
      <label htmlFor="email">Email address</label>
      <div className="form-row">
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <button type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
        </button>
      </div>
      <p role="status">
        {status === 'sent'
          ? 'Check your inbox. Your sign-in link works once and expires in ten minutes.'
          : status === 'error'
            ? 'We could not send the link. Please try again shortly.'
            : 'No password needed. Verify your email before reserving seats.'}
      </p>
      {localMailbox && (
        <a href="http://localhost:8025" target="_blank" rel="noreferrer">
          Open the local development inbox
        </a>
      )}
    </form>
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
