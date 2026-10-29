import type { AuthEnvironment } from './auth';

export type NotificationEnvironment = Partial<AuthEnvironment>;
export type NotificationEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
};
export const localNotificationMail = (env: NotificationEnvironment) =>
  env.DEPLOYMENT_ENV === 'local' && Boolean(env.MAILPIT_URL);
export async function sendBookingEmail(
  env: NotificationEnvironment,
  message: NotificationEmail,
  key: string,
) {
  let url: string, body: unknown;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const local = localNotificationMail(env);
  if (local) {
    const endpoint = new URL(env.MAILPIT_URL ?? '');
    if (!['localhost', '127.0.0.1'].includes(endpoint.hostname))
      throw new Error('Invalid local mailbox');
    url = new URL('/api/v1/send', endpoint).href;
    body = {
      From: { Email: message.from, Name: 'KwikBus' },
      To: [{ Email: message.to }],
      Subject: message.subject,
      Text: message.text,
    };
  } else {
    if (!env.RESEND_API_KEY) throw new Error('Email delivery unavailable');
    url = 'https://api.resend.com/emails';
    headers.Authorization = `Bearer ${env.RESEND_API_KEY}`;
    headers['Idempotency-Key'] = `booking-v1/${key}`;
    body = message;
  }
  // Workers do not support redirect:'error'. Never forward the credential/body
  // to a redirect destination; a non-2xx response is an uncertain send.
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Email delivery unavailable');
  const result = (await response.json()) as { id?: unknown; ID?: unknown };
  const id = local ? result.ID : result.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
    throw new Error('Email delivery identity unavailable');
  return id;
}
