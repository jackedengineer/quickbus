import type { City } from '@kwikbus/contracts';
import { useEffect, useId, useState } from 'react';
import { Icon } from './icon';
export function CityInput({
  label,
  value,
  cities,
  onChoose,
}: {
  label: string;
  value: string;
  cities: City[];
  onChoose: (city: string) => void;
}) {
  const id = useId(),
    [draft, setDraft] = useState(value),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  useEffect(() => setDraft(value), [value]);
  const [matches, setMatches] = useState(cities);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setMatches([]);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/v1/cities?q=${encodeURIComponent(draft === value ? '' : draft.trim())}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error('City lookup unavailable.');
        const result = (await response.json()) as { cities: City[] };
        if (!controller.signal.aborted) {
          setMatches(result.cities);
          setActive(0);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('City lookup unavailable. Try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [draft, value, open]);
  const choose = (city: string) => {
    setDraft(city);
    setOpen(false);
    onChoose(city);
  };
  return (
    <>
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-autocomplete="list"
        aria-activedescendant={
          open && matches[active] ? `${id}-${active}` : undefined
        }
        autoComplete="off"
        value={draft}
        onFocus={(e) => {
          setOpen(true);
          setActive(0);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setOpen(false);
          setDraft(value);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setActive((i) =>
              Math.max(
                0,
                Math.min(
                  matches.length - 1,
                  i + (e.key === 'ArrowDown' ? 1 : -1),
                ),
              ),
            );
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            if (matches[active]) choose(matches[active].name);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            setDraft(value);
          }
        }}
      />
      {open && (
        <div
          className="city-options"
          id={`${id}-options`}
          role="listbox"
          aria-label={`${label} cities`}
        >
          {loading || error ? (
            <p role="status">{error || 'Loading cities…'}</p>
          ) : matches.length ? (
            matches.map((city, i) => (
              <button
                type="button"
                key={city.id}
                id={`${id}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={active === i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  choose(city.name);
                }}
              >
                <Icon name="pin" size={22} />
                <span>
                  {city.name}
                  <small>India</small>
                </span>
              </button>
            ))
          ) : (
            <p role="status">
              No matching cities. Choose from the available journeys.
            </p>
          )}
        </div>
      )}
    </>
  );
}
