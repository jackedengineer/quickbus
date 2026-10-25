export type Session = {
  localMailbox: boolean;
  user: { id: string; email: string; emailVerified: boolean } | null;
};
export type Trip = {
  id: string;
  origin: string;
  destination: string;
  operatorName: string;
  departureAt: string;
  arrivalAt: string;
  fareMinor: number;
  seatCount: number;
};
export type Seat = {
  label: string;
  position: number;
  fareMinor: number;
  available: boolean;
};
export type Booking = {
  id: string;
  tripId: string;
  reference: string;
  status: 'HELD' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
  serverTime: string;
  totalMinor: number;
  currency: string;
  seatLabels: string[];
  origin?: string;
  destination?: string;
  departureAt?: string;
};
export const money = (minor: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(minor / 100);
export const day = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value}T12:00:00+05:30`));
export const dateInIndia = (value: string | Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
export const time = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value));
