/**
 * Where a non-commercial operation stands (`non_commercial_operations.status`,
 * checked by the server). In order; colours for the status pill.
 */
export const NCO_STATUSES = [
  { value: 'requested', label: 'Requested', cls: 'bg-gray-100 text-gray-700' },
  { value: 'samples_in_preparation', label: 'Samples in preparation', cls: 'bg-amber-50 text-amber-700' },
  { value: 'samples_available', label: 'Samples available', cls: 'bg-lime-50 text-lime-700' },
  { value: 'shipment_in_preparation', label: 'Shipment in preparation', cls: 'bg-orange-50 text-orange-700' },
  { value: 'shipped', label: 'Shipped', cls: 'bg-sky-50 text-sky-700' },
  { value: 'delivered', label: 'Delivered', cls: 'bg-green-50 text-green-700' },
  { value: 'cancelled', label: 'Cancelled', cls: 'bg-red-50 text-red-600' },
] as const;

export type NcoStatus = typeof NCO_STATUSES[number]['value'];

export const ncoStatusOf = (value: string | null | undefined) =>
  NCO_STATUSES.find(s => s.value === value) ?? NCO_STATUSES[0];
