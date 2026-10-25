import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router';
import stylesheet from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'QuickBus · Book your next journey' },
    ],
    links: [{ rel: 'stylesheet', href: stylesheet }],
  }),
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header>
          <a className="brand" href="/">
            quickbus<span>•</span>
          </a>
          <span>Development preview</span>
        </header>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
