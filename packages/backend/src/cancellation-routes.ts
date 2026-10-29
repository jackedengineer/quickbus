import type { Express } from 'express';
import { z } from 'zod';
import { cancelCustomerBooking, cancellationPreview } from './cancellation';
import { context } from './context';
export function cancellationRoutes(app: Express) {
  app.get('/api/v1/bookings/:id/cancellation', async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ code: 'INVALID_REQUEST' });
    const preview = await cancellationPreview(
      context().db,
      res.locals.userId,
      id.data,
    );
    return preview
      ? res.json(preview)
      : res.status(404).json({ code: 'BOOKING_NOT_FOUND' });
  });
  app.post('/api/v1/bookings/:id/cancel', async (req, res) => {
    const id = z.uuid().safeParse(req.params.id),
      key = z.uuid().safeParse(req.get('idempotency-key')),
      version = req.get('if-match');
    if (version === undefined)
      return res.status(428).json({ code: 'VERSION_REQUIRED' });
    if (
      !id.success ||
      !key.success ||
      !/^"[1-9][0-9]{0,8}"$/.test(version) ||
      !z
        .object({ policyVersion: z.literal(1) })
        .strict()
        .safeParse(req.body).success
    )
      return res.status(400).json({ code: 'INVALID_REQUEST' });
    const result = await cancelCustomerBooking(
      context().db,
      res.locals.userId,
      id.data,
      key.data,
      Number(version.slice(1, -1)),
    );
    return res.status(result.status).json(result.body);
  });
}
