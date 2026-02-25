import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import { ArrowLeft } from 'lucide-react';

const statusOptions = [
  { value: 'pre-ordered', label: 'Pre-ordered' },
  { value: 'ordered',     label: 'Ordered' },
  { value: 'shipped',     label: 'Shipped' },
  { value: 'delivered',   label: 'Delivered' },
];

const partyTypeOptions = [
  { value: 'none',     label: '— None (assign later) —' },
  { value: 'customer', label: 'Customer' },
  { value: 'supplier', label: 'Supplier' },
];

export default function OperationFormPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);

  const [form, setForm] = useState({
    operation_number: '',
    status: 'pre-ordered',
    partyType: 'none',
    customer_id: '',
    supplier_id: '',
    notes: '',
  });

  useEffect(() => {
    Promise.all([
      api.get('/customers', { params: { limit: 1000 } }),
      api.get('/suppliers', { params: { limit: 1000 } }),
    ]).then(([cRes, sRes]) => {
      setCustomers(cRes.data.data || cRes.data);
      setSuppliers(sRes.data.data || sRes.data);
    });
  }, []);

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.operation_number.trim()) {
      addToast('Operation number is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        operation_number: form.operation_number.trim(),
        status: form.status,
        notes: form.notes || null,
      };
      if (form.partyType === 'customer' && form.customer_id)
        payload.customer_id = Number(form.customer_id);
      if (form.partyType === 'supplier' && form.supplier_id)
        payload.supplier_id = Number(form.supplier_id);

      const { data } = await api.post('/operations', payload);
      addToast('Operation created', 'success');
      navigate(`/operations/${data.id}`);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to create operation', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/operations')}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={16} /> Back to Operations
      </button>

      <h1 className="text-2xl font-bold text-gray-900">New Operation</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Create an operation now and link an order later.
      </p>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Operation Number *"
              value={form.operation_number}
              onChange={e => set('operation_number', e.target.value)}
              placeholder="e.g. OP-2024-001"
              autoFocus
            />
            <Select
              label="Status"
              value={form.status}
              onChange={e => set('status', e.target.value)}
              options={statusOptions}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Party Type"
              value={form.partyType}
              onChange={e => set('partyType', e.target.value)}
              options={partyTypeOptions}
            />
            {form.partyType === 'customer' && (
              <Select
                label="Customer"
                value={form.customer_id}
                onChange={e => set('customer_id', e.target.value)}
                options={customers.map(c => ({ value: String(c.id), label: c.name }))}
                placeholder="Select customer..."
              />
            )}
            {form.partyType === 'supplier' && (
              <Select
                label="Supplier"
                value={form.supplier_id}
                onChange={e => set('supplier_id', e.target.value)}
                options={suppliers.map(s => ({ value: String(s.id), label: s.name }))}
                placeholder="Select supplier..."
              />
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Optional notes..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="secondary" type="button" onClick={() => navigate('/operations')}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating...' : 'Create Operation'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
