import type { Express } from 'express';
import { z } from 'zod';
import { context } from './context';
import { preparePayment } from './payment-prepare';
import { paymentHint, paymentStatus } from './payment-status';

export function paymentRoutes(app: Express) {
  const uuid = z.uuid();
  app.get('/api/v1/bookings/:id/payment', async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ code: 'INVALID_REQUEST' });
    const { db, environment } = context(),
      result = await paymentStatus(db, environment, res.locals.userId, id.data);
    return result
      ? res.json(result)
      : res.status(404).json({ code: 'BOOKING_NOT_FOUND' });
  });
  app.post('/api/v1/bookings/:id/checkout', async (req, res) => {
    const id = uuid.safeParse(req.params.id),
      key = uuid.safeParse(req.get('idempotency-key')),
      version = req.get('if-match');
    if (version === undefined)
      return res.status(428).json({ code: 'VERSION_REQUIRED' });
    if (
      !id.success ||
      !key.success ||
      !/^"[1-9][0-9]{0,8}"$/.test(version) ||
      !z
        .object({ policyAccepted: z.literal(true) })
        .strict()
        .safeParse(req.body).success
    )
      return res.status(400).json({ code: 'INVALID_REQUEST' });
    const { db, environment } = context(),
      result = await preparePayment(
        db,
        environment,
        res.locals.userId,
        id.data,
        key.data,
        Number(version.slice(1, -1)),
      );
    return res.status(result.status).json(result.body);
  });
  const verificationSchema = z
    .object({
      checkoutId: uuid,
      paymentId: z.string().regex(/^pay_[A-Za-z0-9]{1,40}$/),
      signature: z.string().regex(/^[a-f0-9]{64}$/i),
    })
    .strict();
  for (const action of ['verify', 'refresh'] as const)
    app.post(`/api/v1/bookings/:id/payment/${action}`, async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const input = (
        action === 'verify'
          ? verificationSchema
          : z.object({ checkoutId: uuid }).strict()
      ).safeParse(req.body);
      if (!id.success || !input.success)
        return res.status(400).json({ code: 'INVALID_REQUEST' });
      const { db, environment } = context(),
        result = await paymentHint(
          db,
          environment,
          res.locals.userId,
          id.data,
          input.data.checkoutId,
          action === 'verify'
            ? verificationSchema.parse(input.data)
            : undefined,
        );
      return res.status(result.status).json(result.body);
    });
}
