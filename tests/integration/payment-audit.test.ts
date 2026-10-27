import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { sql } from '../../packages/db/src/schema';
import { invariantQuery } from '../../scripts/recovery-audit';
import { paymentFixture } from '../support/payments';

test('runtime can advance payment state but cannot rewrite financial identity or evidence', async () => {
  const f = await paymentFixture();
  try {
    const permissions = await f.runtime.db.execute(sql`SELECT
      has_column_privilege(current_user,'payment_intents','amount','UPDATE') amount,
      has_column_privilege(current_user,'payment_intents','booking_id','UPDATE') booking,
      has_column_privilege(current_user,'checkout_attempts','intent_id','UPDATE') intent,
      has_column_privilege(current_user,'checkout_attempts','state','UPDATE') checkout_state,
      has_column_privilege(current_user,'provider_payments','id','UPDATE') payment_id,
      has_column_privilege(current_user,'provider_payments','amount','UPDATE') payment_amount,
      has_column_privilege(current_user,'provider_payments','state','UPDATE') payment_state,
      has_column_privilege(current_user,'payment_refunds','payment_id','UPDATE') refund_payment,
      has_column_privilege(current_user,'payment_refunds','amount','UPDATE') refund_amount,
      has_column_privilege(current_user,'payment_refunds','state','UPDATE') refund_state,
      has_column_privilege(current_user,'payment_inbox','payload_hash','UPDATE') evidence,
      has_column_privilege(current_user,'payment_inbox','processed_at','UPDATE') processed,
      has_table_privilege(current_user,'payment_refunds','DELETE') refund_delete`);
    expect(permissions.rows[0]).toEqual({
      amount: false,
      booking: false,
      intent: false,
      checkout_state: true,
      payment_id: false,
      payment_amount: false,
      payment_state: true,
      refund_payment: false,
      refund_amount: false,
      refund_state: true,
      evidence: false,
      processed: true,
      refund_delete: false,
    });
    await expect(
      f.runtime.db.execute(
        sql`UPDATE payment_intents SET amount=100 WHERE id=${f.intent}`,
      ),
    ).rejects.toThrow();
    await f.runtime.db.execute(
      sql`UPDATE checkout_attempts SET last_checked_at=clock_timestamp() WHERE id=${f.checkout}`,
    );
    expect(
      (
        await f.owner.query('SELECT amount FROM payment_intents WHERE id=$1', [
          f.intent,
        ])
      ).rows[0].amount,
    ).toBe(74900);
  } finally {
    await f.close();
  }
});

test('independent recovery audit detects missing money, wrong refunds and orphaned recovery work', async () => {
  const f = await paymentFixture();
  const audit = async () =>
    (await f.owner.query(invariantQuery)).rows[0].value as Record<
      string,
      number
    >;
  try {
    const before = await audit();
    // The fixture deliberately has a READY checkout without queue entries.
    expect(before.checkoutWithoutRecovery).toBeGreaterThan(0);
    await f.owner.query(
      "INSERT INTO payment_jobs(id,kind,resource_id) VALUES($1,'RECONCILE',$2)",
      [randomUUID(), f.checkout],
    );
    expect((await audit()).checkoutWithoutRecovery).toBe(
      before.checkoutWithoutRecovery - 1,
    );
    await f.owner.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1", [
      f.booking,
    ]);
    expect((await audit()).confirmedWithoutMoney).toBe(
      before.confirmedWithoutMoney + 1,
    );
    await f.owner.query(
      "INSERT INTO provider_payments(id,checkout_id,intent_id,amount,currency,state,disposition) VALUES($1,$2,$3,74900,'INR','captured','FULFILLED')",
      [f.payment.id, f.checkout, f.intent],
    );
    expect((await audit()).confirmedWithoutMoney).toBe(
      before.confirmedWithoutMoney,
    );
    await f.owner.query(
      "UPDATE provider_payments SET disposition='REFUND' WHERE id=$1",
      [f.payment.id],
    );
    expect((await audit()).compensationWithoutRefund).toBe(
      before.compensationWithoutRefund + 1,
    );
    const refund = randomUUID();
    await f.owner.query(
      'INSERT INTO payment_refunds(id,payment_id,amount) VALUES($1,$2,100)',
      [refund, f.payment.id],
    );
    const wrong = await audit();
    expect(wrong.refundQuoteMismatch).toBe(before.refundQuoteMismatch + 1);
    expect(wrong.refundWithoutJob).toBe(before.refundWithoutJob + 1);
    await f.owner.query('UPDATE payment_refunds SET amount=74900 WHERE id=$1', [
      refund,
    ]);
    await f.owner.query(
      "INSERT INTO payment_jobs(id,kind,resource_id) VALUES($1,'REFUND',$2)",
      [randomUUID(), refund],
    );
    const repaired = await audit();
    expect(repaired.refundQuoteMismatch).toBe(before.refundQuoteMismatch);
    expect(repaired.refundWithoutJob).toBe(before.refundWithoutJob);
  } finally {
    await f.close();
  }
});
