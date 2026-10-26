import { useEffect, useState } from 'react';
// Server time anchors each read. A user's wall-clock adjustment cannot extend it.
export function useRemaining(expiresAt: string, serverTime: string) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const start = performance.now(),
      initial = Date.parse(expiresAt) - Date.parse(serverTime);
    const tick = () =>
      setRemaining(
        Math.max(0, Math.ceil((initial - (performance.now() - start)) / 1000)),
      );
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, serverTime]);
  return remaining;
}
