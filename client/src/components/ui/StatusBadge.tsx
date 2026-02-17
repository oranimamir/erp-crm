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
  // Production
  new_order: 'blue',
  stock_check: 'gray',
  sufficient_stock: 'green',
  lot_issued: 'purple',
  discussing_with_toller: 'yellow',
  supplying_toller: 'orange',
  in_production: 'yellow',
  production_complete: 'green',
  sample_testing: 'purple',
  to_warehousing: 'orange',
  coa_received: 'blue',
  // Wire Transfer
  approved: 'green',
  rejected: 'red',
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
  // Production
  new_order: 'New Order',
  stock_check: 'Stock Check',
  sufficient_stock: 'Sufficient Stock',
  lot_issued: 'Lot Issued',
  discussing_with_toller: 'Discussing with Toller',
  supplying_toller: 'Supplying Toller',
  in_production: 'In Production',
  production_complete: 'Production Complete',
  sample_testing: 'Sample Testing',
  to_warehousing: 'To Warehousing',
  coa_received: 'COA Received',
  // Wire Transfer
  approved: 'Approved',
  rejected: 'Rejected',
};

export default function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusColors[status] || 'gray'}>{statusLabels[status] || status}</Badge>;
}
