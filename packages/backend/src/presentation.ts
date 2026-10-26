// Neon raw SQL returns timestamptz text; pg fixtures may return Date objects.
// Browser DTOs use ISO-8601 consistently, including Safari and JSON consumers.
export const isoInstant = (value: unknown) =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();
