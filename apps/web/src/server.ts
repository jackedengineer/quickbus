import handler, { createServerEntry } from '@tanstack/react-start/server-entry';

export default createServerEntry({
  async fetch(request, options) {
    const nonce = crypto.randomUUID().replaceAll('-', '');
    const response = await handler.fetch(request, {
      ...options,
      context: { ...options?.context, nonce },
    });
    const secured = new Response(response.body, response);
    secured.headers.set('Cache-Control', 'private, no-store');
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    secured.headers.set('Referrer-Policy', 'no-referrer');
    secured.headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    if (new URL(request.url).protocol === 'https:') {
      secured.headers.set('Strict-Transport-Security', 'max-age=31536000');
      secured.headers.set('X-Frame-Options', 'DENY');
      secured.headers.set(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          `script-src 'self' 'nonce-${nonce}'`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self'",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          'upgrade-insecure-requests',
        ].join('; '),
      );
    }
    return secured;
  },
});
