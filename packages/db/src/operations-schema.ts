import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Only bounded job names, aggregate counts and timestamps; never payloads or credentials.
export const maintenanceJobs = pgTable(
  'maintenance_jobs',
  {
    name: text('name').primaryKey(),
    lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
    lastSucceededAt: timestamp('last_succeeded_at', { withTimezone: true }),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
    lastProcessed: integer('last_processed').notNull().default(0),
  },
  (t) => [
    check(
      'maintenance_job_name',
      sql`${t.name} IN ('expiry', 'inventory','payments','notifications')`,
    ),
  ],
);
