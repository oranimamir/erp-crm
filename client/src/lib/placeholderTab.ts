import type { KeyboardEvent } from 'react';

/**
 * Tab on an empty field takes its grey example text as the value, then moves
 * on as usual. Shift+Tab only moves back.
 */
export function acceptPlaceholderOnTab(
  e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  value: string,
  placeholder: string | undefined,
  onChange: (v: string) => void,
) {
  if (e.key === 'Tab' && !e.shiftKey && !value && placeholder) onChange(placeholder);
}
