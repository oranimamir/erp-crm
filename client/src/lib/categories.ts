import { useState, useEffect, useCallback } from 'react';
import api from './api';

export const DEMO_CATEGORIES = [
  'Salaries', 'Cars', 'Overhead', 'Consumables', 'Materials',
  'Utilities and Maintenance', 'Feedstock', 'Subcontractors and Consultants',
  'Regulatory', 'Equipment', 'Couriers', 'Other',
];

export const SALES_CATEGORIES = [
  'Raw Materials', 'Logistics', 'Blenders', 'Shipping',
];

export function useCategories() {
  const [customCategories, setCustomCategories] = useState<{ id: number; name: string; domain: string }[]>([]);

  const fetchCustom = useCallback(async () => {
    try {
      const res = await api.get('/demo-expenses/categories');
      setCustomCategories(res.data.custom || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchCustom(); }, [fetchCustom]);

  const demoCategories = [
    ...DEMO_CATEGORIES,
    ...customCategories.filter(c => c.domain === 'demo').map(c => c.name),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const salesCategories = [
    ...SALES_CATEGORIES,
    ...customCategories.filter(c => c.domain === 'sales').map(c => c.name),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const allCategories = [...demoCategories, ...salesCategories].filter((v, i, a) => a.indexOf(v) === i);

  const addCategory = async (name: string, domain: 'demo' | 'sales') => {
    await api.post('/demo-expenses/categories', { name, domain });
    await fetchCustom();
  };

  const removeCategory = async (id: number) => {
    await api.delete(`/demo-expenses/categories/${id}`);
    await fetchCustom();
  };

  return {
    demoCategories,
    salesCategories,
    allCategories,
    customCategories,
    addCategory,
    removeCategory,
    refetchCategories: fetchCustom,
  };
}
