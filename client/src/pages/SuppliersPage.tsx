import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { useCategories } from '../lib/categories';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { Plus, Truck, Eye, Pencil, Trash2, BarChart3, Beaker, Check, X, GitMerge, Loader2 } from 'lucide-react';

const CHART_COLORS = [
  'bg-purple-500', 'bg-blue-500', 'bg-orange-400', 'bg-teal-500',
  'bg-red-400', 'bg-green-500', 'bg-pink-400', 'bg-indigo-500',
];
const DOT_COLORS = [
  'bg-purple-500', 'bg-blue-500', 'bg-orange-400', 'bg-teal-500',
  'bg-red-400', 'bg-green-500', 'bg-pink-400', 'bg-indigo-500',
];

const DEMO_CAT_COLORS: Record<string, string> = {
  'Salaries': '#6366f1', 'Cars': '#8b5cf6', 'Overhead': '#3b82f6', 'Consumables': '#f59e0b',
  'Materials': '#10b981', 'Utilities and Maintenance': '#ef4444', 'Feedstock': '#14b8a6',
  'Subcontractors and Consultants': '#ec4899', 'Regulatory': '#f97316', 'Equipment': '#0ea5e9',
  'Couriers': '#84cc16', 'Other': '#6b7280',
};

const SALES_CAT_COLORS: Record<string, string> = {
  'Raw Materials': '#f59e0b', 'Logistics': '#3b82f6', 'Blenders': '#8b5cf6', 'Shipping': '#10b981',
};

// Display label → DB enum value (inverse of server SALES_CAT_DB_MAP). Used when
// PATCHing the standalone /suppliers table from the unified Sales tab table.
const SALES_DISPLAY_TO_DB: Record<string, string> = {
  'Logistics': 'logistics',
  'Blenders': 'blenders',
  'Raw Materials': 'raw_materials',
  'Shipping': 'shipping',
};

type RowSource = 'user-mapping' | 'suppliers-table' | 'hardcoded';
type SupplierRow = { rowKey: string; id?: number; name: string; category: string; source: RowSource };

function DomainSuppliersTab({ domain }: { domain: 'demo' | 'sales' }) {
  const { addToast } = useToast();
  const { demoCategories, salesCategories, addCategory, customCategories, removeCategory } = useCategories();
  const categories = domain === 'demo' ? demoCategories : salesCategories;
  const colorMap = domain === 'demo' ? DEMO_CAT_COLORS : SALES_CAT_COLORS;
  const defaultCategory = domain === 'demo' ? 'Other' : (salesCategories[0] || 'Logistics');
  const domainLabel = domain === 'demo' ? 'Demo Expenses' : 'Sales Activities';
  const [data, setData] = useState<{ hardcoded: any[]; userDefined: any[] }>({ hardcoded: [], userDefined: [] });
  const [userMappings, setUserMappings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState(defaultCategory);
  const [sortKey, setSortKey] = useState<'name' | 'category'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; source: RowSource } | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editCat, setEditCat] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [dupLoading, setDupLoading] = useState(false);
  type DupSupplier = { name: string; count: number; invoiceIds: number[] };
  type DupGroup = { canonical: string; suppliers: DupSupplier[]; selected: string[] };
  const [dupGroups, setDupGroups] = useState<DupGroup[] | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [previewSupplier, setPreviewSupplier] = useState<string | null>(null);
  const [previewPdf, setPreviewPdf] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [manualCanonical, setManualCanonical] = useState('');
  const [manualMerging, setManualMerging] = useState(false);

  const fetchData = () => {
    Promise.all([
      api.get('/demo-expenses/demo-suppliers', { params: { domain } }),
      api.get('/demo-expenses/supplier-mappings', { params: { domain } }),
    ]).then(([d, m]) => {
      setData(d.data);
      setUserMappings(m.data);
      setSelectedRowKeys(new Set());
      setManualCanonical('');
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { setLoading(true); fetchData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [domain]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      await api.post('/demo-expenses/supplier-mappings', { supplierName: newName.trim(), category: newCategory, domain });
      addToast(`Supplier "${newName.trim()}" added`, 'success');
      setShowAdd(false);
      setNewName('');
      setNewCategory(defaultCategory);
      fetchData();
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to add supplier', 'error');
    }
  };

  const handleDelete = async (target: { id: number; source: RowSource }) => {
    try {
      const url = target.source === 'suppliers-table'
        ? `/suppliers/${target.id}`
        : `/demo-expenses/supplier-mappings/${target.id}`;
      await api.delete(url);
      addToast('Supplier removed', 'success');
      setDeleteTarget(null);
      fetchData();
    } catch {
      addToast('Failed to delete', 'error');
    }
  };

  const handleUpdateCategory = async (row: SupplierRow) => {
    if (row.id == null) return;
    try {
      if (row.source === 'suppliers-table') {
        const dbCat = SALES_DISPLAY_TO_DB[editCat] || editCat;
        await api.patch(`/suppliers/${row.id}`, { category: dbCat });
        addToast('Category updated', 'success');
      } else {
        const res = await api.patch(`/demo-expenses/supplier-mappings/${row.id}`, { category: editCat });
        const cascaded = res.data?.cascadedInvoices || 0;
        addToast(cascaded > 0 ? `Category updated · ${cascaded} invoices reclassified` : 'Category updated', 'success');
      }
      setEditingKey(null);
      fetchData();
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to update', 'error');
    }
  };

  const handleFindDuplicates = async () => {
    setDupLoading(true);
    setDupGroups(null);
    setPreviewSupplier(null);
    setPreviewPdf(null);
    try {
      const res = await api.get('/demo-expenses/supplier-duplicates', { params: { domain } });
      const groups: DupGroup[] = (res.data?.groups || []).map((g: any) => ({
        canonical: g.canonical,
        suppliers: g.suppliers,
        selected: g.suppliers.map((s: any) => s.name),
      }));
      setDupGroups(groups);
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to find duplicates', 'error');
    } finally {
      setDupLoading(false);
    }
  };

  const handleMergeGroup = async (groupKey: string) => {
    const group = (dupGroups || []).find(g => g.suppliers[0]?.name === groupKey);
    if (!group) return;
    const canonical = group.canonical.trim();
    if (!canonical) { addToast('Enter a name for the consolidated supplier', 'error'); return; }
    if (group.selected.length < 2) { addToast('Select at least 2 suppliers to merge', 'error'); return; }
    setMerging(groupKey);
    try {
      const res = await api.post('/demo-expenses/supplier-merge', { canonicalName: canonical, names: group.selected, domain });
      addToast(`Merged into "${canonical}" · ${res.data?.updatedInvoices || 0} invoices renamed`, 'success');
      setDupGroups(prev => (prev || []).filter(g => g.suppliers[0]?.name !== groupKey));
      fetchData();
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to merge', 'error');
    } finally {
      setMerging(null);
    }
  };

  const updateGroup = (groupKey: string, patch: Partial<DupGroup>) => {
    setDupGroups(prev => (prev || []).map(g => g.suppliers[0]?.name === groupKey ? { ...g, ...patch } : g));
  };

  const toggleRowSelected = (rowKey: string, name: string) => {
    setSelectedRowKeys(prev => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      if (next.size === 1 && !manualCanonical.trim()) setManualCanonical(name);
      if (next.size === 0) setManualCanonical('');
      return next;
    });
  };

  const handleManualMerge = async (rows: SupplierRow[]) => {
    const names = rows.filter(r => selectedRowKeys.has(r.rowKey)).map(r => r.name);
    if (names.length < 2) { addToast('Pick at least 2 suppliers', 'error'); return; }
    const canonical = manualCanonical.trim();
    if (!canonical) { addToast('Canonical name required', 'error'); return; }
    setManualMerging(true);
    try {
      const res = await api.post('/demo-expenses/supplier-merge', { canonicalName: canonical, names, domain });
      addToast(`Merged into "${canonical}" · ${res.data?.updatedInvoices || 0} invoices renamed`, 'success');
      fetchData();
    } catch (err: any) {
      addToast(err?.response?.data?.error || 'Failed to merge', 'error');
    } finally {
      setManualMerging(false);
    }
  };

  const toggleDupSelected = (groupKey: string, name: string) => {
    setDupGroups(prev => (prev || []).map(g => {
      if (g.suppliers[0]?.name !== groupKey) return g;
      const has = g.selected.includes(name);
      return { ...g, selected: has ? g.selected.filter(n => n !== name) : [...g.selected, name] };
    }));
  };

  const togglePreview = async (supplierName: string, invoiceIds: number[]) => {
    if (previewSupplier === supplierName) {
      setPreviewSupplier(null);
      setPreviewPdf(null);
      return;
    }
    setPreviewSupplier(supplierName);
    setPreviewPdf(null);
    if (invoiceIds.length === 0) return;
    setLoadingPreview(true);
    try {
      // Try invoice ids in order until one has an embedded PDF
      for (const id of invoiceIds) {
        const res = await api.get(`/demo-expenses/invoices/${id}`);
        if (res.data?.embedded_pdf) {
          setPreviewPdf(res.data.embedded_pdf);
          break;
        }
      }
    } catch {
      addToast('Failed to load invoice preview', 'error');
    } finally {
      setLoadingPreview(false);
    }
  };

  const closeDupModal = () => {
    setDupGroups(null);
    setPreviewSupplier(null);
    setPreviewPdf(null);
  };

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>;

  // Build unified row list: user-defined mappings + hardcoded entries (which for
  // sales come from the standalone suppliers table and have an id, for demo come
  // from the built-in DEMO_SUPPLIER_MAP and are read-only).
  const allRows: SupplierRow[] = [
    ...userMappings.map((m: any): SupplierRow => ({
      rowKey: `mapping-${m.id}`,
      id: m.id,
      name: m.display_name || m.supplier_pattern,
      category: m.category,
      source: 'user-mapping',
    })),
    ...data.hardcoded.map((h: any): SupplierRow => ({
      rowKey: h.source === 'suppliers-table' ? `suppliers-${h.id}` : `hardcoded-${h.pattern}`,
      id: h.id,
      name: h.pattern,
      category: h.category,
      source: h.source === 'suppliers-table' ? 'suppliers-table' : 'hardcoded',
    })),
  ];

  // Group by category for the chip grid (keeps both user and hardcoded)
  const byCategory: Record<string, { name: string; source: string }[]> = {};
  for (const s of [...data.hardcoded, ...data.userDefined]) {
    if (!byCategory[s.category]) byCategory[s.category] = [];
    byCategory[s.category].push({ name: s.pattern, source: s.source });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {domainLabel} suppliers are used to automatically classify invoices into the {domainLabel} domain.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleFindDuplicates} disabled={dupLoading}>
            <GitMerge size={16} /> {dupLoading ? 'Scanning...' : 'Find Duplicates'}
          </Button>
          <Button onClick={() => setShowAdd(true)}><Plus size={16} /> Add Supplier</Button>
        </div>
      </div>

      {/* Add / manage categories */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Categories</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {categories.map(c => {
            const custom = customCategories.find(cc => cc.name === c && cc.domain === domain);
            return (
              <span key={c} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                <span className="w-2 h-2 rounded-sm" style={{ background: colorMap[c] || '#6b7280' }} />
                {c}
                {custom && (
                  <button onClick={async () => { await removeCategory(custom.id); addToast(`Removed "${c}"`, 'success'); }}
                    className="ml-0.5 text-gray-400 hover:text-red-500"><X size={12} /></button>
                )}
              </span>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
            placeholder="New category name..."
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            onKeyDown={e => { if (e.key === 'Enter' && newCatName.trim()) { addCategory(newCatName.trim(), domain); setNewCatName(''); addToast(`Added "${newCatName.trim()}"`, 'success'); } }} />
          <Button size="sm" onClick={() => { if (newCatName.trim()) { addCategory(newCatName.trim(), domain); setNewCatName(''); addToast(`Added "${newCatName.trim()}"`, 'success'); } }}
            disabled={!newCatName.trim()}>
            <Plus size={14} /> Add
          </Button>
        </div>
      </Card>

      {/* Unified suppliers table (user-defined + hardcoded for the active domain) */}
      {allRows.length > 0 && (() => {
        const toggleSort = (key: 'name' | 'category') => {
          if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
          else { setSortKey(key); setSortDir('asc'); }
        };
        const sortIndicator = (key: 'name' | 'category') => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
        const sortedRows = [...allRows].sort((a, b) => {
          const av = (sortKey === 'name' ? a.name : a.category).toLowerCase();
          const bv = (sortKey === 'name' ? b.name : b.category).toLowerCase();
          if (av < bv) return sortDir === 'asc' ? -1 : 1;
          if (av > bv) return sortDir === 'asc' ? 1 : -1;
          return 0;
        });
        const visibleRowKeys = sortedRows.map(r => r.rowKey);
        const allSelected = visibleRowKeys.length > 0 && visibleRowKeys.every(k => selectedRowKeys.has(k));
        const someSelected = visibleRowKeys.some(k => selectedRowKeys.has(k));
        const toggleSelectAll = () => {
          setSelectedRowKeys(prev => {
            if (allSelected) return new Set();
            const next = new Set(prev);
            for (const k of visibleRowKeys) next.add(k);
            return next;
          });
          if (allSelected) setManualCanonical('');
          else {
            const firstRow = sortedRows[0];
            if (firstRow && !manualCanonical.trim()) setManualCanonical(firstRow.name);
          }
        };
        return (
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900">Suppliers ({allRows.length})</h3>
            {selectedRowKeys.size >= 2 && (
              <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-xl">
                <span className="text-xs text-gray-500 shrink-0">{selectedRowKeys.size} selected →</span>
                <input
                  type="text"
                  value={manualCanonical}
                  onChange={e => setManualCanonical(e.target.value)}
                  placeholder="Canonical name"
                  className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1 text-xs focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <Button size="sm" onClick={() => handleManualMerge(sortedRows)} disabled={manualMerging || !manualCanonical.trim()}>
                  {manualMerging ? 'Merging...' : 'Merge Selected'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { setSelectedRowKeys(new Set()); setManualCanonical(''); }}>
                  Clear
                </Button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-3 py-2.5 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      title="Select all"
                    />
                  </th>
                  <th onClick={() => toggleSort('name')}
                    className="text-left px-4 py-2.5 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900">
                    Supplier Name{sortIndicator('name')}
                  </th>
                  <th onClick={() => toggleSort('category')}
                    className="text-left px-4 py-2.5 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900">
                    Category{sortIndicator('category')}
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600 w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedRows.map((row) => {
                  const isEditing = editingKey === row.rowKey;
                  const editable = row.source !== 'hardcoded' && row.id != null;
                  const isSelected = selectedRowKeys.has(row.rowKey);
                  return (
                  <tr key={row.rowKey} className={`hover:bg-gray-50 ${isSelected ? 'bg-primary-50/40' : ''}`}>
                    <td className="px-3 py-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRowSelected(row.rowKey, row.name)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Link to={`/supplier-invoices?supplier=${encodeURIComponent(row.name)}&tab=${domain}`}
                        className="text-primary-600 hover:text-primary-800 font-medium capitalize">
                        {row.name}
                      </Link>
                      {row.source === 'hardcoded' && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400 font-medium">built-in</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <select value={editCat} onChange={e => setEditCat(e.target.value)}
                          className="border border-gray-300 rounded px-2 py-0.5 text-xs bg-white focus:ring-2 focus:ring-primary-500"
                          autoFocus>
                          {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                          <span className="w-2 h-2 rounded-sm" style={{ background: colorMap[row.category] || '#6b7280' }} />
                          {row.category}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button onClick={() => handleUpdateCategory(row)} className="p-1 text-green-600 hover:text-green-700 rounded" title="Save"><Check size={14} /></button>
                            <button onClick={() => setEditingKey(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded" title="Cancel"><X size={14} /></button>
                          </>
                        ) : editable ? (
                          <>
                            <button onClick={() => { setEditingKey(row.rowKey); setEditCat(row.category); }} className="p-1 text-gray-400 hover:text-primary-600 rounded" title="Edit category"><Pencil size={14} /></button>
                            <button onClick={() => setDeleteTarget({ id: row.id!, source: row.source })} className="p-1 text-gray-400 hover:text-red-600 rounded" title="Delete"><Trash2 size={14} /></button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        );
      })()}

      {/* Hardcoded + user-defined grouped by category */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(byCategory).sort((a, b) => a[0].localeCompare(b[0])).map(([cat, suppliers]) => (
          <Card key={cat} className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-sm" style={{ background: colorMap[cat] || '#6b7280' }} />
              <h3 className="text-sm font-semibold text-gray-900">{cat}</h3>
              <span className="text-xs text-gray-400 ml-auto">{suppliers.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suppliers.map(s => (
                <Link key={s.name} to={`/supplier-invoices?supplier=${encodeURIComponent(s.name)}&tab=${domain}`}
                  className={`inline-block px-2 py-0.5 rounded text-xs capitalize cursor-pointer hover:ring-2 hover:ring-primary-300 transition-shadow ${s.source === 'user' ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'bg-gray-100 text-gray-700'}`}>
                  {s.name}
                </Link>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Add Supplier Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Add {domainLabel} Supplier</h2>
            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  autoFocus onKeyDown={e => { if (e.key === 'Enter' && newName.trim() && newCategory) handleAdd(); }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setShowAdd(false); setNewName(''); }}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!newName.trim()}>Add Supplier</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmDialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteTarget && handleDelete(deleteTarget)} title="Remove Supplier" message="Remove this supplier? Built-in entries cannot be removed." confirmLabel="Remove" />

      {/* Find Duplicates Modal */}
      {dupGroups !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Consolidate Similar Suppliers</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {dupGroups.length === 0
                    ? 'No similar suppliers found.'
                    : `Found ${dupGroups.length} group${dupGroups.length === 1 ? '' : 's'} of similar names. Pick a canonical name and merge.`}
                </p>
              </div>
              <button onClick={closeDupModal} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {dupGroups.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-500">No similar suppliers detected.</div>
              ) : (
                dupGroups.map((g) => {
                  const groupKey = g.suppliers[0]?.name;
                  const selectedSet = new Set(g.selected);
                  return (
                    <div key={groupKey} className="border border-gray-200 rounded-lg p-4">
                      <div className="space-y-1 mb-3">
                        {g.suppliers.map(s => {
                          const isSelected = selectedSet.has(s.name);
                          const isPreviewing = previewSupplier === s.name;
                          return (
                            <div key={s.name}>
                              <div className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={isSelected} onChange={() => toggleDupSelected(groupKey, s.name)}
                                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                                <span className={`flex-1 capitalize ${isSelected ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                                  {s.name}
                                </span>
                                <span className="text-xs text-gray-400">{s.count} invoice{s.count === 1 ? '' : 's'}</span>
                                <button
                                  onClick={() => togglePreview(s.name, s.invoiceIds || [])}
                                  className={`p-1 rounded hover:bg-gray-100 ${isPreviewing ? 'text-primary-600' : 'text-gray-400'}`}
                                  title="Preview invoice"
                                  disabled={!s.invoiceIds || s.invoiceIds.length === 0}
                                >
                                  {loadingPreview && isPreviewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                                </button>
                              </div>
                              {isPreviewing && (
                                <div className="mt-2 mb-2 ml-6 bg-gray-50 border border-gray-200 rounded-lg p-2">
                                  {loadingPreview ? (
                                    <div className="flex items-center justify-center py-8 text-gray-400 text-xs">
                                      <Loader2 size={16} className="animate-spin mr-2" /> Loading preview...
                                    </div>
                                  ) : previewPdf ? (
                                    <iframe src={`data:application/pdf;base64,${previewPdf}`} className="w-full h-[400px] rounded border border-gray-200 bg-white" title="Invoice preview" />
                                  ) : (
                                    <p className="text-center py-4 text-xs text-gray-400">No PDF preview available for this supplier</p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex items-end gap-2 pt-3 border-t border-gray-100">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Consolidated supplier name</label>
                          <input type="text" value={g.canonical}
                            onChange={e => updateGroup(groupKey, { canonical: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                        </div>
                        <Button size="sm" onClick={() => handleMergeGroup(groupKey)} disabled={merging === groupKey || g.selected.length < 2}>
                          {merging === groupKey ? 'Merging...' : 'Merge'}
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex justify-end px-6 py-3 border-t border-gray-100">
              <Button variant="secondary" onClick={closeDupModal}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuppliersPage() {
  const [activeTab, setActiveTab] = useState<'sales' | 'demo'>('sales');
  const [paymentData, setPaymentData] = useState<any[]>([]);

  useEffect(() => {
    api.get('/dashboard/supplier-payments').then(r => setPaymentData(r.data)).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('sales')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'sales' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-2"><Truck size={16} /> Sales Activities</span>
        </button>
        <button
          onClick={() => setActiveTab('demo')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'demo' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-2"><Beaker size={16} /> Demo Expenses</span>
        </button>
      </div>

      <DomainSuppliersTab domain={activeTab} />

      {/* Supplier Payments Chart (sales only) */}
      {activeTab === 'sales' && (() => {
        const months = [...new Set(paymentData.map((d: any) => d.month))].sort() as string[];
        const names = [...new Set(paymentData.map((d: any) => d.supplier_name))] as string[];
        if (months.length === 0) return null;
        const lookup: Record<string, Record<string, number>> = {};
        paymentData.forEach((d: any) => {
          if (!lookup[d.month]) lookup[d.month] = {};
          lookup[d.month][d.supplier_name] = d.total;
        });
        const monthTotals = months.map(m => Object.values(lookup[m] || {}).reduce((s: number, v: any) => s + v, 0));
        const maxTotal = Math.max(...monthTotals, 1);
        return (
          <Card>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <BarChart3 size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Payments to Suppliers (Last 6 Months)</h2>
            </div>
            <div className="p-5">
              {/* Legend */}
              <div className="flex flex-wrap gap-3 mb-4">
                {names.map((name, i) => (
                  <span key={name} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className={`w-3 h-3 rounded ${DOT_COLORS[i % DOT_COLORS.length]}`} />
                    {name}
                  </span>
                ))}
              </div>
              {/* Stacked bar chart */}
              <div className="flex items-end gap-2" style={{ height: '200px' }}>
                {months.map(m => {
                  const monthData = lookup[m] || {};
                  const monthTotal = monthTotals[months.indexOf(m)];
                  return (
                    <div key={m} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                      <span className="text-xs text-gray-500 font-medium mb-1">
                        ${monthTotal > 0 ? (monthTotal >= 1000 ? `${(monthTotal/1000).toFixed(0)}k` : monthTotal.toFixed(0)) : ''}
                      </span>
                      <div
                        className="w-full flex flex-col-reverse rounded-t overflow-hidden"
                        style={{ height: `${Math.max((monthTotal / maxTotal) * 155, monthTotal > 0 ? 4 : 0)}px` }}
                      >
                        {names.map((name, i) => {
                          const val = monthData[name] || 0;
                          const pct = monthTotal > 0 ? (val / monthTotal) * 100 : 0;
                          return pct > 0 ? (
                            <div
                              key={name}
                              className={`w-full ${CHART_COLORS[i % CHART_COLORS.length]}`}
                              style={{ height: `${pct}%` }}
                              title={`${name}: $${val.toLocaleString()}`}
                            />
                          ) : null;
                        })}
                      </div>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">
                        {new Date(m + '-01').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
