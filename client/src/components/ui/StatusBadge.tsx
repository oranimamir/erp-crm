import Badge from './Badge';

const statusColors: Record<string, 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange'> = {
  // Invoice
  draft: 'gray',
  sent: 'blue',
  paid: 'green',
  overdue: 'red',
  cancelled: 'red',
  // Order
  order_placed: 'blue',
  confirmed: 'purple',
  processing: 'yellow',
  shipped: 'orange',
  delivered: 'green',
  completed: 'green',
  // Shipment
  pending: 'gray',
  picked_up: 'blue',
  in_transit: 'yellow',
  out_for_delivery: 'orange',
  returned: 'red',
  failed: 'red',
};

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
  order_placed: 'Order Placed',
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  pending: 'Pending',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  returned: 'Returned',
  failed: 'Failed',
};

export default function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusColors[status] || 'gray'}>{statusLabels[status] || status}</Badge>;
}
