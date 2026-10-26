import { env } from 'cloudflare:workers';
import handler, { createServerEntry } from '@tanstack/react-start/server-entry';

export default createServerEntry({
  async fetch(request, options) {
    const url = new URL(request.url);
    const { PUBLIC_ORIGIN: canonicalOrigin } = env as unknown as {
      PUBLIC_ORIGIN?: string;
    };
    if (canonicalOrigin && url.origin !== canonicalOrigin) {
      // Mutations must be initiated on the origin that owns the session cookie.
      if (!['GET', 'HEAD'].includes(request.method))
        return Response.json(
          { code: 'CANONICAL_ORIGIN_REQUIRED' },
          { status: 421, headers: { 'Cache-Control': 'no-store' } },
        );
      const destination = new URL(canonicalOrigin);
      // Assign the path separately so a leading // cannot replace the hostname.
      destination.pathname = url.pathname;
      destination.search = url.search;
      return Response.redirect(destination, 308);
    }
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
