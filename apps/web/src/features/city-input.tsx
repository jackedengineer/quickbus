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
  cities: string[];
  onChoose: (city: string) => void;
}) {
  const id = useId(),
    [draft, setDraft] = useState(value),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  useEffect(() => setDraft(value), [value]);
  const matches = cities.filter(
    (city) =>
      draft === value ||
      city.toLocaleLowerCase().includes(draft.trim().toLocaleLowerCase()),
  );
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
            if (matches[active]) choose(matches[active]);
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
          {matches.length ? (
            matches.map((city, i) => (
              <button
                type="button"
                key={city}
                id={`${id}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={active === i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  choose(city);
                }}
              >
                <Icon name="pin" size={22} />
                <span>
                  {city}
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
