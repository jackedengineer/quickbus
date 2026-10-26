import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import stylesheet from '../styles.css?url';

export const Route = createRootRoute({
  headers: () => ({ 'Cache-Control': 'private, no-store' }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'KwikBus · Book your next journey' },
    ],
    links: [
      { rel: 'stylesheet', href: stylesheet },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  errorComponent: () => (
    <main id="main" className="empty-state">
      <h1>We couldn’t load your journeys</h1>
      <p>Please check your connection and try again.</p>
      <a href="/">Try again</a>
    </main>
  ),
  notFoundComponent: () => (
    <main id="main" className="empty-state">
      <h1>Page not found</h1>
      <a href="/">Back to KwikBus</a>
    </main>
  ),
  component: Outlet,
  shellComponent: RootDocument,
});
function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
