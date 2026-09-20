import { useEffect, useState } from 'react';

/**
 * Returns `value`, delayed by `delayMs` after it last changed.
 *
 * Used for the search box only — status/sort changes stay instant since
 * they're deliberate clicks, not a stream of keystrokes.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}