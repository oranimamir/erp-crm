/** Where a technology operation stands — same list as TO_STATUSES in server routes/technology-operations.ts. */
export const TO_STATUSES = [
  { value: 'open', label: 'Open', cls: 'bg-sky-50 text-sky-700' },
  { value: 'completed', label: 'Completed', cls: 'bg-green-50 text-green-700' },
  { value: 'cancelled', label: 'Cancelled', cls: 'bg-gray-100 text-gray-500' },
] as const;

export const toStatusOf = (value: string | null | undefined) =>
  TO_STATUSES.find(s => s.value === value) ?? TO_STATUSES[0];
