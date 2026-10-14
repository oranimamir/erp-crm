import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';

/**
 * A customer order to start / compare a purchase operation's PO with:
 * searchable dropdown of the customer orders, newest first. `null` = none.
 */

export interface PickedOrder { id: number; order_number: string; customer_name: string | null; created_at: string }

export default function CustomerOrderPicker({ value, onChange, noneLabel = 'No order — from scratch', className = '' }: {
  value: number | null;
  onChange: (order: PickedOrder | null) => void;
  noneLabel?: string;
  className?: string;
}) {
  const [orders, setOrders] = useState<PickedOrder[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.get('/orders', { params: { type: 'customer', limit: 10000 } })
      .then(res => setOrders(res.data.data || []))
      .catch(() => setOrders([]));
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? orders.filter(o => `${o.order_number} ${o.customer_name || ''}`.toLowerCase().includes(q)) : orders;
    // The chosen order stays listed while filtering
    const chosen = value ? orders.find(o => o.id === value) : null;
    return chosen && !list.includes(chosen) ? [chosen, ...list] : list;
  }, [orders, filter, value]);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative">
        <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find order…"
          className="w-32 rounded-md border border-gray-300 bg-white pl-7 pr-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500" />
      </div>
      <select value={value ?? ''} onChange={e => onChange(orders.find(o => o.id === Number(e.target.value)) || null)}
        className="min-w-0 max-w-xs rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500">
        <option value="">{noneLabel}</option>
        {shown.map(o => (
          <option key={o.id} value={o.id}>
            {o.order_number}{o.customer_name ? ` — ${o.customer_name}` : ''}{o.created_at ? ` (${formatDate(o.created_at)})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
