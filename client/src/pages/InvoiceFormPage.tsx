import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import FileUpload from '../components/ui/FileUpload';
import { ArrowLeft, Loader2 } from 'lucide-react';

const typeOptions = [
  { value: 'customer', label: 'Customer' },
  { value: 'supplier', label: 'Supplier' },
];

const currencyOptions = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
];

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

interface InvoiceForm {
  invoice_number: string;
  type: string;
  customer_id: string;
  supplier_id: string;
  amount: string;
  currency: string;
  status: string;
  invoice_date: string;
  due_date: string;
  payment_date: string;
  notes: string;
}

const emptyForm: InvoiceForm = {
  invoice_number: '',
  type: 'customer',
  customer_id: '',
  supplier_id: '',
  amount: '',
  currency: 'USD',
  status: 'draft',
  invoice_date: '',
  due_date: '',
  payment_date: '',
  notes: '',
};

export default function InvoiceFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<InvoiceForm>({ ...emptyForm });
  const [file, setFile] = useState<File | null>(null);
  const [currentFile, setCurrentFile] = useState<{ name: string; path?: string } | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [customersRes, suppliersRes] = await Promise.all([
          api.get('/customers', { params: { limit: 1000 } }),
          api.get('/suppliers', { params: { limit: 1000 } }),
        ]);
        setCustomers(customersRes.data.data || customersRes.data);
        setSuppliers(suppliersRes.data.data || suppliersRes.data);

        if (id) {
          const res = await api.get(`/invoices/${id}`);
          const inv = res.data;
          setForm({
            invoice_number: inv.invoice_number || '',
            type: inv.type || 'customer',
            customer_id: inv.customer_id ? String(inv.customer_id) : '',
            supplier_id: inv.supplier_id ? String(inv.supplier_id) : '',
            amount: inv.amount != null ? String(inv.amount) : '',
            currency: inv.currency || 'USD',
            status: inv.status || 'draft',
            invoice_date: inv.invoice_date ? inv.invoice_date.slice(0, 10) : '',
            due_date: inv.due_date ? inv.due_date.slice(0, 10) : '',
            payment_date: inv.payment_date ? inv.payment_date.slice(0, 10) : '',
            notes: inv.notes || '',
          });
          if (inv.file_path) {
            const filename = inv.file_path.split('/').pop() || inv.file_path;
            setCurrentFile({ name: filename, path: inv.file_path });
          }
        }
      } catch (err: any) {
        addToast(err.response?.data?.error || 'Failed to load data', 'error');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id]);

  const updateField = (field: keyof InvoiceForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const scanFile = async (uploadedFile: File) => {
    setScanning(true);
    try {
      const scanData = new FormData();
      scanData.append('file', uploadedFile);
      const res = await api.post('/invoices/scan', scanData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const data = res.data;

      setForm(prev => {
        const updated = { ...prev };
        if (data.invoice_number && !prev.invoice_number) updated.invoice_number = data.invoice_number;
        if (data.amount != null && !prev.amount) updated.amount = String(data.amount);
        if (data.currency && prev.currency === 'USD') updated.currency = data.currency;
        if (data.invoice_date && !prev.invoice_date) updated.invoice_date = data.invoice_date;
        if (data.due_date && !prev.due_date) updated.due_date = data.due_date;
        if (data.notes && !prev.notes) updated.notes = data.notes;
        if (data.type) {
          updated.type = data.type;
          if (data.customer_id) updated.customer_id = String(data.customer_id);
          if (data.supplier_id) updated.supplier_id = String(data.supplier_id);
        }
        return updated;
      });

      addToast('Invoice scanned and fields auto-filled', 'success');
    } catch (err: any) {
      const detail = err.response?.data?.error || 'Could not auto-scan invoice';
      addToast(`${detail}. You can fill in the fields manually.`, 'info');
    } finally {
      setScanning(false);
    }
  };

  const handleFileSelect = (selectedFile: File | null) => {
    setFile(selectedFile);
    if (selectedFile && !isEdit) {
      scanFile(selectedFile);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.invoice_number.trim()) {
      addToast('Invoice number is required', 'error');
      return;
    }
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      addToast('Please enter a valid amount', 'error');
      return;
    }
    if (form.type === 'customer' && !form.customer_id) {
      addToast('Please select a customer', 'error');
      return;
    }
    if (form.type === 'supplier' && !form.supplier_id) {
      addToast('Please select a supplier', 'error');
      return;
    }

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('invoice_number', form.invoice_number);
      formData.append('type', form.type);
      if (form.type === 'customer') {
        formData.append('customer_id', form.customer_id);
      } else {
        formData.append('supplier_id', form.supplier_id);
      }
      formData.append('amount', form.amount);
      formData.append('currency', form.currency);
      formData.append('status', form.status);
      if (form.invoice_date) formData.append('invoice_date', form.invoice_date);
      if (form.due_date) formData.append('due_date', form.due_date);
      if (form.payment_date) formData.append('payment_date', form.payment_date);
      if (form.notes) formData.append('notes', form.notes);
      if (file) formData.append('file', file);

      if (isEdit) {
        await api.put(`/invoices/${id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        addToast('Invoice updated', 'success');
      } else {
        await api.post('/invoices', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        addToast('Invoice created', 'success');
      }
      navigate('/invoices');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to save invoice', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
      </div>
    );
  }

  const entityOptions = form.type === 'customer'
    ? customers.map(c => ({ value: String(c.id), label: c.name }))
    : suppliers.map(s => ({ value: String(s.id), label: s.name }));

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/invoices')}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={16} /> Back to Invoices
      </button>

      <h1 className="text-2xl font-bold text-gray-900">
        {isEdit ? 'Edit Invoice' : 'New Invoice'}
      </h1>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Invoice Number *"
              value={form.invoice_number}
              onChange={e => updateField('invoice_number', e.target.value)}
              placeholder="INV-001"
            />
            <Select
              label="Type *"
              value={form.type}
              onChange={e => {
                updateField('type', e.target.value);
                updateField('customer_id', '');
                updateField('supplier_id', '');
              }}
              options={typeOptions}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label={form.type === 'customer' ? 'Customer *' : 'Supplier *'}
              value={form.type === 'customer' ? form.customer_id : form.supplier_id}
              onChange={e => {
                if (form.type === 'customer') {
                  updateField('customer_id', e.target.value);
                } else {
                  updateField('supplier_id', e.target.value);
                }
              }}
              options={entityOptions}
              placeholder={`Select ${form.type}...`}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={e => updateField('status', e.target.value)}
              options={statusOptions}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Amount *"
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={e => updateField('amount', e.target.value)}
              placeholder="0.00"
            />
            <Select
              label="Currency"
              value={form.currency}
              onChange={e => updateField('currency', e.target.value)}
              options={currencyOptions}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Invoice Date"
              type="date"
              value={form.invoice_date}
              onChange={e => updateField('invoice_date', e.target.value)}
            />
            <Input
              label="Due Date"
              type="date"
              value={form.due_date}
              onChange={e => updateField('due_date', e.target.value)}
            />
            <Input
              label="Payment Date"
              type="date"
              value={form.payment_date}
              onChange={e => updateField('payment_date', e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => updateField('notes', e.target.value)}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Optional notes..."
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Invoice File</label>
            <FileUpload
              onFileSelect={handleFileSelect}
              currentFile={currentFile}
            />
            {scanning && (
              <div className="flex items-center gap-2 text-sm text-primary-600 mt-2">
                <Loader2 size={16} className="animate-spin" />
                Scanning invoice with AI...
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="secondary" type="button" onClick={() => navigate('/invoices')}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Update Invoice' : 'Create Invoice'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
