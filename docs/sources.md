# QuickBus research sources

Accessed **25 October 2026**. Official documentation supports technology capabilities and provider contracts. Product scope, policy, architecture, timing estimates, and performance targets are QuickBus design choices. Recheck documentation when pinning versions; a rolling “latest” page is not a version lock.

## Product reference material

| Source | What it supports |
|---|---|
| Supplied local recording, 306.683 seconds | Observed European FlixBus flow, recorded in detail in [recording review](research/recording-review.md); no inferred server internals |
| [redBus home](https://www.redbus.in/) | Search entry, navigation, documented commercial feature breadth; supplemented by a live route/seat-map session |
| [FlixBus India](https://www.flixbus.in/) | Public service/navigation surface |
| [FlixBus booking guide](https://www.flixbus.in/service/book-bus-ticket) | Documented trip/seat/payment/confirmation flow and ten-minute cart reservation |

## Framework, data, and runtime

| Source | What it supports |
|---|---|
| [TanStack Start overview](https://tanstack.com/start/latest/docs/framework/react/overview) | Start includes rendering and server capabilities; Express ownership is a project choice |
| [Start execution model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model) | Client/server execution boundaries |
| [Start hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting) | Deployment options to verify in the compatibility spike |
| [Turborepo repository structure](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) | Workspaces and application/package organization |
| [Drizzle with Neon](https://orm.drizzle.team/docs/connect-neon) | Driver options; interactive transactions need an appropriate connection/driver |
| [Drizzle transactions](https://orm.drizzle.team/docs/transactions) | Transaction callback/rollback capability; actual schema/protocol still needs implementation tests |
| [Neon Node connections](https://neon.com/docs/guides/node) | Node application connectivity |
| [Neon pooling](https://neon.com/docs/connect/connection-pooling) | Transaction pooling, direct migration connections, session-feature limitations |
| [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) | Row locks, conflict behavior, and deadlock considerations |
| [PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html) | Isolation semantics; coarse-lock correctness argument is project-specific |
| [Node release status](https://nodejs.org/en/about/previous-releases) | LTS selection at research time |

## Payments, identity, and quality

| Source | What it supports |
|---|---|
| [Razorpay create order](https://razorpay.com/docs/api/orders/create/) | Amount/currency, unique receipt field, current fresh-order instruction after failed attempt; verify behavior in test mode |
| [Razorpay list orders](https://razorpay.com/docs/api/orders/fetch-all/) | Receipt filter and pagination for reconciliation; validate exact matches |
| [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test/) | Raw-body signature validation, duplicate event IDs, out-of-order delivery |
| [Razorpay idempotent refunds](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent) | Dedicated stable refund key and retry payload requirements |
| [Better Auth Express integration](https://better-auth.com/docs/integrations/express) | Mounting/auth handler boundaries and body-parser ordering |
| [Better Auth magic links](https://better-auth.com/docs/plugins/magic-link) | Passwordless flow and configurable token storage; configure hashing explicitly |
| [Express production security](https://expressjs.com/en/advanced/best-practice-security/) | Production middleware/session/security considerations |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Accessibility acceptance standard; conformance needs testing |

## Evidence status

Completed: video metadata inspection, one-second visual review and enlarged key states, live redBus search/seat inspection, official-document research, and design consistency review.

Still to execute during development: exact version compatibility, schema migration execution, transaction/load/fault tests, real Razorpay sandbox calls, email/login/MFA behavior, deployment, backup restore, and user/accessibility testing. Provider documentation contains potentially differing order-attempt descriptions; the design avoids assuming reuse and makes the sandbox spike a release dependency.

The planning artifacts were also checked for broken local links, balanced code fences, unique/dependency-ordered task IDs, and accidental email/long payment-number text. The three included recording stills were visually reviewed and contain no entered personal or payment values. These artifact checks do not substitute for application or database tests.
