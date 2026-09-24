import { useEffect, useState } from 'react';
import api from './api';

export interface CompanyEntityOption {
  code: string;
  company_name: string;
}

/** The TripleW entities a document can be issued by, default first. */
export function useCompanyEntities(): CompanyEntityOption[] {
  const [entities, setEntities] = useState<CompanyEntityOption[]>([]);
  useEffect(() => {
    api.get('/company-entities')
      .then(({ data }) => setEntities((data || []).map((e: any) => ({ code: e.code, company_name: e.company_name }))))
      .catch(() => setEntities([]));
  }, []);
  return entities;
}
