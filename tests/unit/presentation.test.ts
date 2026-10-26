import { expect, test } from 'vitest';
import {
  dateInIndia,
  day,
  money,
  time,
} from '../../apps/web/src/features/models';

test('journey presentation preserves Indian midnight and integer-paise fares', () => {
  expect(dateInIndia('2026-10-26T18:29:59.999Z')).toBe('2026-10-26');
  expect(dateInIndia('2026-10-26T18:30:00.000Z')).toBe('2026-10-27');
  expect(dateInIndia(new Date('2026-10-26T18:30:00.000Z'))).toBe('2026-10-27');
  expect(day('2026-10-26')).toBe('Mon, 26 Oct');
  expect(time('2026-10-26T14:30:00.000Z')).toBe('08:00 pm');
  expect(money(1)).toBe('₹0.01');
  expect(money(74900)).toBe('₹749.00');
  expect(money(2500000)).toBe('₹25,000.00');
});
