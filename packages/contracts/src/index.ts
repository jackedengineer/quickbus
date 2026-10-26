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
