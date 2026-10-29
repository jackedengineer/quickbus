export type Session = {
  localMailbox: boolean;
  googleEnabled: boolean;
  emailEnabled: boolean;
  user: { id: string; email: string; emailVerified: boolean } | null;
};
export type { Trip } from '@kwikbus/contracts';
export type Seat = {
  label: string;
  position: number;
  fareMinor: number;
  available: boolean;
};
export type Booking = {
  tripCancelled: boolean;
  id: string;
  tripId: string;
  reference: string;
  status: 'HELD' | 'PAYMENT_PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
  serverTime: string;
  totalMinor: number;
  currency: string;
  seatLabels: string[];
  origin?: string;
  destination?: string;
  departureAt?: string;
};
// Fixed-locale formatters contain no customer state. Reuse them across the
// timetable instead of loading ICU formatting data for every trip/render.
const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
const dayFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
export const money = (minor: number) => currencyFormatter.format(minor / 100);
export const day = (value: string) =>
  dayFormatter.format(new Date(`${value}T12:00:00+05:30`));
export const dateInIndia = (value: string | Date) =>
  dateFormatter.format(new Date(value));
export const time = (value: string) => timeFormatter.format(new Date(value));
