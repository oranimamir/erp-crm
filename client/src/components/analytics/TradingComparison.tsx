import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import Card from '../ui/Card';
import { StatTile } from '../charts/Panels';
import { formatDate } from '../../lib/dates';
import { AlertTriangle, ArrowLeftRight, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

// Trading operations: the customer's order (what we sell) set against the
// supplier's order (what we buy), per operation and line by line.

interface Line {
  product: string;
  sale_quantity: number | null; sale_unit: string; sale_price: number | null; sale_currency: string;
  purchase_quantity: number | null; purchase_unit: string | null; purchase_price: number | null; purchase_currency: string | null;
  unit_margin_eur: number | null;
}

interface TradeOp {
  operation_id: number;
  operation_number: string;
  status: string;
  order_number: string | null;
  order_date: string | null;
  customer_name: string | null;
  supplier_name: string | null;
  source: 'purchase_order' | 'supplier_invoice' | null;
  sale_currency: string;
  sale_total: number;
  sale_eur: number;
  purchase_currency: string | null;
  purchase_total: number | null;
  purchase_eur: number | null;
  unpriced: boolean;
  margin_eur: number | null;
  margin_pct: number | null;
  sale_mt: number | null;
  purchase_mt: number | null;
  quantity_mismatch: boolean;
  lines: Line[];
}

interface TradingData {
  totals: {
    operations: number; compared: number; missing_supplier: number; unpriced: number;
    sale_eur: number; purchase_eur: number; margin_eur: number;
  };
  operations: TradeOp[];
}

const eurFmt = (n: number) => `€${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const money = (n: number | null, cur?: string | null) =>
  n == null ? '—' : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ''}`;
const qty = (n: number | null, unit?: string | null) =>
  n == null ? '—' : `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;

function marginClass(v: number | null) {
  if (v == null) return 'text-gray-400';
  return v < 0 ? 'text-red-600' : 'text-green-700';
}

export default function TradingComparison({ year, monthFrom, monthTo, customerId }: {
  year: string; monthFrom: string; monthTo: string; customerId: string;
}) {
  const [data, setData] = useState<TradingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.get('/analytics/trading', {
      params: { year, month_from: monthFrom, month_to: monthTo, customer_id: customerId || undefined },
    })
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to load trading operations'))
      .finally(() => setLoading(false));
  }, [year, monthFrom, monthTo, customerId]);

  const toggle = (id: number) => setOpen(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  if (loading) return <Card className="p-10 flex justify-center"><Loader2 className="animate-spin text-primary-600" size={22} /></Card>;
  if (error) return <Card className="p-6 text-sm text-red-600">{error}</Card>;
  if (!data || !data.operations.length) {
    return (
      <Card className="p-10 text-center text-sm text-gray-500">
        <ArrowLeftRight size={28} className="mx-auto mb-2 text-gray-300" />
        No trading operations in this period. Set an operation's category to <strong>Trading</strong> on its page to include it here.
      </Card>
    );
  }

  const { totals, operations } = data;
  const marginPct = totals.sale_eur ? (totals.margin_eur / totals.sale_eur) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Sold to customers" value={eurFmt(totals.sale_eur)} hint={`${totals.compared} of ${totals.operations} operations compared`} />
        <StatTile label="Bought from suppliers" value={eurFmt(totals.purchase_eur)} hint="Supplier POs, or supplier invoices when no PO" />
        <StatTile label="Gross margin" value={eurFmt(totals.margin_eur)} hint="Sale minus purchase, same operations" />
        <StatTile label="Margin %" value={`${marginPct.toFixed(1)}%`} hint="EUR at today's rates" />
      </div>

      {(totals.missing_supplier > 0 || totals.unpriced > 0) && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            {totals.missing_supplier > 0 && <>{totals.missing_supplier} operation{totals.missing_supplier > 1 ? 's have' : ' has'} no supplier order or invoice yet. </>}
            {totals.unpriced > 0 && <>{totals.unpriced} purchase order{totals.unpriced > 1 ? 's are' : ' is'} missing prices. </>}
            These are left out of the totals.
          </span>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="w-8" />
                <th className="text-left px-3 py-2.5 font-medium">Operation</th>
                <th className="text-left px-3 py-2.5 font-medium">Customer</th>
                <th className="text-left px-3 py-2.5 font-medium">Supplier</th>
                <th className="text-right px-3 py-2.5 font-medium">Customer order</th>
                <th className="text-right px-3 py-2.5 font-medium">Supplier order</th>
                <th className="text-right px-3 py-2.5 font-medium">Margin (EUR)</th>
                <th className="text-right px-3 py-2.5 font-medium">Margin %</th>
                <th className="text-right px-3 py-2.5 font-medium">Quantity (MT)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {operations.map(op => {
                const isOpen = open.has(op.operation_id);
                return (
                  <Fragment key={op.operation_id}>
                    <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => toggle(op.operation_id)}>
                      <td className="pl-3 text-gray-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="px-3 py-2.5">
                        <Link to={`/operations/${op.operation_id}`} onClick={e => e.stopPropagation()} className="font-semibold text-primary-700 hover:underline">
                          {op.operation_number}
                        </Link>
                        <div className="text-[11px] text-gray-400">{formatDate(op.order_date) || ''}{op.order_number ? ` · ${op.order_number}` : ''}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700">{op.customer_name || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-700">
                        {op.supplier_name || (op.source ? '—' : <span className="text-amber-600">No supplier order</span>)}
                        {op.source === 'supplier_invoice' && <div className="text-[11px] text-gray-400">from supplier invoices</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="font-medium text-gray-900">{money(op.sale_total, op.sale_currency)}</div>
                        {op.sale_currency !== 'EUR' && <div className="text-[11px] text-gray-400">{eurFmt(op.sale_eur)}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {op.unpriced
                          ? <span className="text-amber-600 text-xs">Prices missing</span>
                          : <>
                              <div className="font-medium text-gray-900">{money(op.purchase_total, op.purchase_currency)}</div>
                              {op.purchase_eur != null && op.purchase_currency !== 'EUR' && <div className="text-[11px] text-gray-400">{eurFmt(op.purchase_eur)}</div>}
                            </>}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${marginClass(op.margin_eur)}`}>
                        {op.margin_eur == null ? '—' : eurFmt(op.margin_eur)}
                      </td>
                      <td className={`px-3 py-2.5 text-right ${marginClass(op.margin_pct)}`}>
                        {op.margin_pct == null ? '—' : `${op.margin_pct.toFixed(1)}%`}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-700">
                        {qty(op.sale_mt)}
                        {op.quantity_mismatch && (
                          <div className="flex items-center justify-end gap-1 text-[11px] text-amber-600" title="The supplier order is for a different quantity than the customer order">
                            <AlertTriangle size={11} /> bought {qty(op.purchase_mt)}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/60">
                        <td />
                        <td colSpan={8} className="px-3 pb-3 pt-1">
                          {op.lines.length ? (
                            <table className="w-full text-xs">
                              <thead className="text-gray-400">
                                <tr>
                                  <th className="text-left py-1.5 font-medium">Product</th>
                                  <th className="text-right py-1.5 font-medium">Qty sold</th>
                                  <th className="text-right py-1.5 font-medium">Qty bought</th>
                                  <th className="text-right py-1.5 font-medium">Sale price</th>
                                  <th className="text-right py-1.5 font-medium">Purchase price</th>
                                  <th className="text-right py-1.5 font-medium">Margin / unit (EUR)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {op.lines.map((l, i) => (
                                  <tr key={i}>
                                    <td className="py-1.5 text-gray-700">{l.product || '—'}</td>
                                    <td className="py-1.5 text-right">{qty(l.sale_quantity, l.sale_unit)}</td>
                                    <td className={`py-1.5 text-right ${l.sale_quantity != null && l.purchase_quantity != null && l.sale_quantity !== l.purchase_quantity ? 'text-amber-600 font-medium' : ''}`}>
                                      {qty(l.purchase_quantity, l.purchase_unit)}
                                    </td>
                                    <td className="py-1.5 text-right">{money(l.sale_price, l.sale_currency)}</td>
                                    <td className="py-1.5 text-right">{money(l.purchase_price, l.purchase_currency)}</td>
                                    <td className={`py-1.5 text-right font-medium ${marginClass(l.unit_margin_eur)}`}>
                                      {l.unit_margin_eur == null ? '—' : l.unit_margin_eur.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-xs text-gray-400 py-2">No order lines on this operation.</p>
                          )}
                          {op.source === 'supplier_invoice' && (
                            <p className="text-[11px] text-gray-400 mt-1">No supplier purchase order was generated, so the cost is the supplier invoices recorded on the operation (no per-line prices).</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
