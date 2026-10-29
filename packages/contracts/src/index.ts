import { z } from 'zod';
export const indiaDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const date = new Date(v);
    return (
      !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === v
    );
  });
export const searchInput = z
  .object({
    from: z.string().trim().min(1).max(100),
    to: z.string().trim().min(1).max(100),
    date: indiaDate,
    adults: z.coerce.number().int().min(1).max(4).default(1),
    sort: z.enum(['departure', 'price']).default('departure'),
    limit: z.coerce.number().int().min(1).max(20).default(10),
    cursor: z
      .string()
      .min(1)
      .max(1200)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export type SearchInput = z.infer<typeof searchInput>;
export type City = { id: string; name: string };
export type Trip = {
  id: string;
  origin: string;
  destination: string;
  operatorName: string;
  vehicleLabel: string;
  departureAt: string;
  arrivalAt: string;
  fareMinor: number;
  seatCount: number;
  availableSeats?: number;
};
export type TripStop = {
  id: string;
  name: string;
  address: string;
  cityId: string;
  role: 'PICKUP' | 'DROP';
  sequence: number;
  scheduledAt: string;
};
export type Catalog = {
  cities: City[];
  today: string;
  through: string;
  defaults: { from: string; to: string; date: string } | null;
};
export type SearchPage = {
  trips: Trip[];
  nextCursor?: string;
  code?: string;
  detail?: string;
};

export const reservationDetailsInput = z
  .object({
    pickupStopId: z.uuid(),
    dropStopId: z.uuid(),
    passengers: z
      .array(
        z
          .object({
            seatLabel: z.string().regex(/^[0-9]{1,2}[A-D]$/),
            name: z
              .string()
              .trim()
              .min(2)
              .max(100)
              .refine((v) => !/[\p{Cc}\p{Cs}]/u.test(v)),
          })
          .strict(),
      )
      .min(1)
      .max(4)
      .refine((v) => new Set(v.map((p) => p.seatLabel)).size === v.length),
    contactPhone: z
      .string()
      .regex(/^[+][1-9][0-9]{6,14}$/)
      .nullable(),
  })
  .strict();
export type ReservationDetailsInput = z.infer<typeof reservationDetailsInput>;
export type ReservationReview = {
  wasConfirmed: boolean;
  tripCancelled: boolean;
  cancellation: {
    source: 'CUSTOMER' | 'TRIP';
    acceptedAt: string;
    refundMinor: number;
  } | null;
  confirmationEmail:
    | 'QUEUED'
    | 'RUNNING'
    | 'SENT'
    | 'NEEDS_REVIEW'
    | 'SKIPPED'
    | null;
  id: string;
  tripId: string;
  reference: string;
  version: number;
  status: 'HELD' | 'PAYMENT_PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
  serverTime: string;
  totalMinor: number;
  currency: string;
  seatLabels: string[];
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  operatorName: string;
  vehicleLabel: string;
  pickupStopId: string | null;
  dropStopId: string | null;
  contactEmail: string;
  contactPhone: string | null;
  passengers: { seatLabel: string; fareMinor: number; name: string | null }[];
  stops: TripStop[];
  complete: boolean;
};

export type CancellationPreview = {
  id: string;
  status: ReservationReview['status'];
  version: number;
  policyVersion: number;
  cutoffAt: string;
  serverTime: string;
  eligible: boolean;
  refundableMinor: number;
  source: 'CUSTOMER' | 'TRIP' | null;
};
