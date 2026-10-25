import type { CSSProperties } from 'react';

type Name =
  | 'pin'
  | 'calendar'
  | 'user'
  | 'chevron'
  | 'swap'
  | 'bus'
  | 'shield'
  | 'ticket'
  | 'map'
  | 'seat'
  | 'close'
  | 'check'
  | 'clock'
  | 'menu';
const paths: Record<Name, string> = {
  pin: 'M12 22s7-8 7-13A7 7 0 0 0 5 9c0 5 7 13 7 13Z M15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  calendar:
    'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM3 10h18M7 2v6M17 2v6M7 14h2M13 14h2M7 17h2',
  user: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 18c1-5 13-5 14 0',
  chevron: 'm9 5 7 7-7 7',
  swap: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
  bus: 'M5 4h14v14H5ZM5 11h14M8 2h8M5 18v3h3v-3M16 18v3h3v-3M8 15h1M15 15h1',
  shield: 'm12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6l9-4ZM12 7v10M7 12h10',
  ticket: 'M4 4h16v6a2 2 0 0 0 0 4v6H4v-6a2 2 0 0 0 0-4V4ZM12 5v3m0 3v2m0 3v3',
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6ZM9 3v15M15 6v15',
  seat: 'M7 4v11h11M4 9v10h13M17 15l4 6M10 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  close: 'm6 6 12 12M18 6 6 18',
  check: 'm4 12 5 5L20 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 6v6l4 2',
  menu: 'M3 6h18M3 12h18M3 18h18',
};
export function Icon({
  name,
  size = 24,
  style,
}: {
  name: Name;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
