export function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <article className="help-content legal-content">
      <h1>{kind === 'privacy' ? 'Privacy notice' : 'Terms of use'}</h1>
      <p className="muted">
        KwikBus portfolio preview · Updated 25 October 2026
      </p>
      {kind === 'privacy' ? (
        <>
          <h2>What we collect</h2>
          <p>
            Signing in stores your email address, account identifier,
            verified-email status and session. Google sign-in may also provide
            your name and profile image. We store your selected journey, seats
            and reservation status. Authentication uses an IP address to limit
            abuse.
          </p>
          <h2>Why we use it</h2>
          <p>
            We use this information to sign you in, protect your account,
            reserve seats and show your own reservations. Sign-in codes expire
            after five minutes. Sessions expire after seven days unless renewed.
            We do not send marketing emails or sell your data.
          </p>
          <h2>Service providers</h2>
          <p>
            The application uses Cloudflare for hosting, Neon for PostgreSQL,
            Better Auth for authentication, Google when you choose Google
            sign-in, and Resend for production sign-in emails. Local development
            emails stay in a local test inbox. Service providers process the
            data needed to deliver their service.
          </p>
          <h2>Retention and your choices</h2>
          <p>
            Account and reservation records remain while you use this preview;
            automatic account deletion is not available yet. You can sign out at
            any time. For access, correction or deletion requests, contact the
            maintainer through the project's GitHub profile. Please do not put
            personal data or sign-in codes in a public issue.
          </p>
          <p>
            <a href="https://github.com/jackedengineer">
              Contact the project maintainer
            </a>
          </p>
        </>
      ) : (
        <>
          <h2>A demonstration, with no travel tickets</h2>
          <p>
            KwikBus is an independent portfolio project. Journeys, fares and
            seats are demonstration inventory. A reservation temporarily holds
            seats in this application; it does not book a real bus, create a
            valid ticket or promise transport. Payments are unavailable. Do not
            use this preview to arrange travel.
          </p>
          <h2>Your account and reservations</h2>
          <p>
            Use an email address you control. Keep sign-in codes private.
            Reservations last up to ten minutes and may expire earlier when
            journey sales close. You may release your seats from My bookings.
          </p>
          <h2>Availability and acceptable use</h2>
          <p>
            This early preview may change, become unavailable or have
            demonstration records reset. Please do not abuse sign-in emails,
            attempt to access another user's account, or disrupt the service.
          </p>
          <h2>Independent project</h2>
          <p>
            KwikBus is not affiliated with FlixBus or redBus. The visual
            interface is a study of bus-booking design.
          </p>
        </>
      )}
      <a href="/">Back to KwikBus</a>
    </article>
  );
}
