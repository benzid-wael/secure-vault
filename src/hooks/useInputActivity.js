import { useEffect } from 'react';

/** Input is reported to main at most this often (Task 13, New-42). */
export const ACTIVITY_REPORT_MS = 15 * 1000;
const INPUT_EVENTS = ['keydown', 'pointerdown', 'wheel', 'touchstart'];

/**
 * Call `report` on input in the window (keys, clicks, scrolling, touch), at
 * most every `ACTIVITY_REPORT_MS`, so main can keep an unlocked vault from
 * idling out. Nothing is reported while `report` is null, and nothing but
 * input ever is: calls the page makes on its own never count.
 *
 * @param {(() => void) | null} report Keep it stable (useCallback).
 */
export function useInputActivity(report) {
  useEffect(() => {
    if (!report) return undefined;
    let last = -Infinity;
    const onInput = () => {
      const now = Date.now();
      if (now - last < ACTIVITY_REPORT_MS) return;
      last = now;
      report();
    };
    const options = { capture: true, passive: true };
    for (const type of INPUT_EVENTS) {
      window.addEventListener(type, onInput, options);
    }
    return () => {
      for (const type of INPUT_EVENTS) {
        window.removeEventListener(type, onInput, options);
      }
    };
  }, [report]);
}
