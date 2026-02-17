import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import { ArrowLeft } from 'lucide-react';

const statusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'returned', label: 'Returned' },
  { value: 'failed', label: 'Failed' },
];

export default function ShipmentFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const isEdit = Boolean(id);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [form, setForm] = useState({
    type: 'customer', customer_id: '', supplier_id: '', order_id: '',
    tracking_number: '', carrier: '', status: 'pending', estimated_delivery: '', notes: '',
  });

  useEffect(() => {
    Promise.all([
      api.get('/customers', { params: { limit: 100 } }),
      api.get('/suppliers', { params: { limit: 100 } }),
      api.get('/orders', { params: { limit: 100 } }),
    ]).then(([c, s, o]) => {
      setCustomers(c.data.data);
      setSuppliers(s.data.data);
      setOrders(o.data.data);
    });

    if (isEdit) {
      api.get(`/shipments/${id}`).then(res => {
        const s = res.data;
        setForm({
          type: s.type, customer_id: s.customer_id?.toString() || '',
          supplier_id: s.supplier_id?.toString() || '', order_id: s.order_id?.toString() || '',
          tracking_number: s.tracking_number || '', carrier: s.carrier || '',
          status: s.status, estimated_delivery: s.estimated_delivery || '', notes: s.notes || '',
        });
      }).finally(() => setLoading(false));
    }
  }, [id]);

  const handleSubmit = async () => {
    setSaving(true);
    const body = {
      ...form,
      customer_id: form.type === 'customer' ? (form.customer_id || null) : null,
      supplier_id: form.type === 'supplier' ? (form.supplier_id || null) : null,
      order_id: form.order_id || null,
    };
    try {
      if (isEdit) {
        await api.put(`/shipments/${id}`, body);
        addToast('Shipment updated', 'success');
      } else {
        await api.post('/shipments', body);
        addToast('Shipment created', 'success');
      }
      navigate('/shipments');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>;

  const entityOptions = form.type === 'customer'
    ? customers.map(c => ({ value: c.id.toString(), label: c.name }))
    : suppliers.map(s => ({ value: s.id.toString(), label: s.name }));

  const orderOptions = orders.map(o => ({ value: o.id.toString(), label: `${o.order_number}` }));

  return (
    <div className="space-y-4 max-w-2xl">
      <button onClick={() => navigate('/shipments')} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} /> Back to Shipping</button>
      <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Shipment' : 'New Shipment'}</h1>

      <Card className="p-6">
        <div className="space-y-4">
          <Select label="Type *" value={form.type} onChange={e => setForm({ ...form, type: e.target.value, customer_id: '', supplier_id: '' })} options={[{ value: 'customer', label: 'Customer' }, { value: 'supplier', label: 'Supplier' }]} />
          <Select label={form.type === 'customer' ? 'Customer *' : 'Supplier *'} value={form.type === 'customer' ? form.customer_id : form.supplier_id} onChange={e => form.type === 'customer' ? setForm({ ...form, customer_id: e.target.value }) : setForm({ ...form, supplier_id: e.target.value })} options={entityOptions} placeholder="Select..." />
          <Select label="Linked Order" value={form.order_id} onChange={e => setForm({ ...form, order_id: e.target.value })} options={orderOptions} placeholder="None" />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Tracking Number" value={form.tracking_number} onChange={e => setForm({ ...form, tracking_number: e.target.value })} />
            <Input label="Carrier" value={form.carrier} onChange={e => setForm({ ...form, carrier: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} options={statusOptions} />
            <Input label="Estimated Delivery" type="date" value={form.estimated_delivery} onChange={e => setForm({ ...form, estimated_delivery: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => navigate('/shipments')}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
