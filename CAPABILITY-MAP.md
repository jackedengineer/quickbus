# KwikBus capability map

Proposed boundaries for the first release. IDs are stable and are used in the PRD and task backlog. This is a design for review, not an approved implementation contract.

| Module ID | Owns | Depends on |
|---|---|---|
| `identity` | Verified-email login, sessions, customer/admin authorization | Auth library and database adapter |
| `catalog` | Cities/aliases, stops, operators, layout templates, draft trip authoring | `identity` for protected authoring |
| `booking` | Published trip search/descriptions, inventory, live allocations, booking snapshots, pricing, payment intents/attempts, cancellation, refunds, payment reconciliation | `identity`, `catalog`, payment-provider adapter |
| `notifications` | Ticket and cancellation email delivery, delivery history | Versioned events from `booking`; no synchronous dependency on booking writes |
| `operations` | Admin screens and command composition, reconciliation cases, audit views, health signals | Public interfaces of `identity`, `catalog`, `booking`, `notifications` |

Build order: compatibility spikes → identity and catalog browsing → booking contention proof → booking checkout and payment recovery → notifications → operations completion → release evidence.

The payment-provider adapter is infrastructure inside the booking boundary. It does not own bookings and cannot modify inventory. Keeping booking and payment orchestration together avoids a cycle in which a payment service needs booking state while a booking service needs payment state. A separate deployment is not needed to demonstrate clear modularity.

Catalog owns editable templates. Publication transfers an immutable trip snapshot to the booking module. Thereafter fare/layout/schedule changes to that published trip are prohibited in v1; opening/closing sales and cancelling the trip go through booking commands. Admin endpoints compose these interfaces rather than writing other modules' tables.

Public city suggestions use catalog interfaces; public departure search/detail/seat queries use booking interfaces. Catalog never calls booking to read published state, so the dependency direction stays acyclic.

Within a module, add a service, repository, or pure policy function only when the behavior needs it. Avoid a separate package for every table, generic base repositories, event buses for synchronous local calls, and a microservice per feature.
