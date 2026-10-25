import type { AuthEnvironment } from './auth';

export async function sendSignInCode(
  environment: AuthEnvironment,
  email: string,
  otp: string,
) {
  const text = `Your KwikBus sign-in code is ${otp}.\n\nIt expires in five minutes and works once. Never share this code. If you did not request it, ignore this email.`;
  if (environment.DEPLOYMENT_ENV === 'local' && environment.MAILPIT_URL) {
    const endpoint = new URL(environment.MAILPIT_URL);
    if (!['localhost', '127.0.0.1'].includes(endpoint.hostname))
      throw new Error('The local mail adapter accepts loopback only.');
    const response = await fetch(new URL('/api/v1/send', endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: { Email: 'hello@kwikbus.test', Name: 'KwikBus' },
        To: [{ Email: email }],
        Subject: 'Your KwikBus sign-in code',
        Text: text,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Email delivery is unavailable.');
    return;
  }
  if (!environment.RESEND_API_KEY || !environment.EMAIL_FROM)
    throw new Error('A verified production sender is required.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${environment.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: environment.EMAIL_FROM,
      to: [email],
      subject: 'Your KwikBus sign-in code',
      text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  // Never include the provider response: it can contain recipient data.
  if (!response.ok) throw new Error('Email delivery is unavailable.');
}
