import { useState } from 'react';
import { SignIn, SignOut } from './auth';
import { Dialog } from './dialog';
import { Icon } from './icon';
import type { Session } from './models';
export function SiteHeader({
  session,
  compact = false,
  onBookings,
  onHelp,
  onHome,
  accountOpen,
  setAccountOpen,
}: {
  session: Session;
  compact?: boolean;
  onBookings: () => void;
  onHelp: () => void;
  onHome: () => void;
  accountOpen: boolean;
  setAccountOpen: (value: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <>
      <header className={compact ? 'site-header compact' : 'site-header'}>
        <div className="header-inner">
          <a className="brand" href="/" aria-label="KwikBus home">
            KWIKBUS
          </a>
          <button
            type="button"
            className="mobile-menu icon-button"
            aria-label="Open navigation"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Icon name="menu" />
          </button>
          <nav
            className={menu ? 'main-nav expanded' : 'main-nav'}
            aria-label="Main"
          >
            <button
              type="button"
              onClick={() => {
                onHome();
                setMenu(false);
              }}
            >
              Plan Your Journey
              <Icon name="chevron" size={18} />
            </button>
            <button
              type="button"
              onClick={() => {
                onBookings();
                setMenu(false);
              }}
            >
              My Bookings
            </button>
            <button
              type="button"
              onClick={() => {
                onHelp();
                setMenu(false);
              }}
            >
              Help
            </button>
          </nav>
          <div className="header-widgets">
            <span className="language" aria-label="India, English">
              <span className="flag">🇮🇳</span>EN
            </span>
            <button
              type="button"
              className="account-button"
              onClick={() => setAccountOpen(true)}
            >
              <Icon name="user" size={23} />
              <span>{session.user ? 'My account' : 'Register / Sign in'}</span>
            </button>
          </div>
        </div>
      </header>
      {accountOpen && (
        <Dialog
          title={session.user ? 'My account' : 'Register / Sign in'}
          onClose={() => setAccountOpen(false)}
        >
          <div className="dialog-content">
            {session.user ? (
              <>
                <p>
                  Signed in as <strong>{session.user.email}</strong>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    onBookings();
                  }}
                >
                  My bookings
                </button>
                <SignOut />
              </>
            ) : (
              <SignIn localMailbox={session.localMailbox} />
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
export function LandingContent({
  onSearch,
  onHelp,
}: {
  onSearch: () => void;
  onHelp: () => void;
}) {
  return (
    <>
      <section className="benefits" aria-label="Travel with KwikBus">
        {(
          [
            {
              icon: 'seat',
              title: 'Comfort on board',
              copy: 'Air-conditioned coaches, comfortable seats and space to settle in.',
            },
            {
              icon: 'shield',
              title: 'Your seats, reserved',
              copy: 'Choose your seats and keep your whole party together.',
            },
            {
              icon: 'ticket',
              title: 'Travel made easy',
              copy: 'Clear fares and a simple way to manage your reservations.',
            },
            {
              icon: 'map',
              title: 'Your next destination',
              copy: 'Discover our curated journeys between Indian cities.',
            },
          ] as const
        ).map((b) => (
          <div key={b.title}>
            <span className="benefit-icon">
              <Icon name={b.icon} size={28} />
            </span>
            <h2>{b.title}</h2>
            <p>{b.copy}</p>
          </div>
        ))}
      </section>
      <section className="landing-copy content-width">
        <h2>Online bus booking with KwikBus</h2>
        <p>
          Choose a route, find a journey and pick the seats that suit you. See
          the full fare before you reserve, with all your journeys in one place.
        </p>
        <div className="travel-links">
          <button type="button" className="secondary" onClick={onSearch}>
            Find your next journey
            <Icon name="chevron" size={20} />
          </button>
          <button type="button" className="text-button" onClick={onHelp}>
            How reservations work
          </button>
        </div>
      </section>
    </>
  );
}
export function Help() {
  return (
    <section className="help-content">
      <h1>How can we help?</h1>
      <details open>
        <summary>How do seat reservations work?</summary>
        <p>
          Search for a journey, choose one seat per adult, then verify your
          email. Your selected seats are held together for up to ten minutes. A
          reservation is temporary and is not a confirmed travel ticket.
        </p>
      </details>
      <details>
        <summary>Can I pay for my booking?</summary>
        <p>
          Payments are not available in this development preview. The
          reservation will expire automatically or you can release it in My
          bookings.
        </p>
      </details>
      <details>
        <summary>Why did my selected seat become unavailable?</summary>
        <p>
          Other passengers can reserve seats while you browse. Availability is
          checked again when you reserve. If any seat is taken, no seats from
          your request are reserved.
        </p>
      </details>
      <details>
        <summary>How do I release my reservation?</summary>
        <p>
          Sign in with the same email, open My bookings and select Release
          seats. The entire party is released together.
        </p>
      </details>
    </section>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="content-width">
        <strong>KWIKBUS</strong>
        <span>Portfolio development preview · No live tickets or payments</span>
        <small>Independent project. Interface study based on FlixBus.</small>
      </div>
    </footer>
  );
}
