import { useEffect, useState } from 'react';
import api from './api';

export interface EntityBankOption { bank_name: string; eur_account: string; usd_account: string }

export interface CompanyEntityOption {
  code: string;
  company_name: string;
  /** The entity's banks (TripleW Details) and which one documents use by default */
  banks: EntityBankOption[];
  default_bank: number;
}

/** The TripleW entities a document can be issued by, default first. */
export function useCompanyEntities(): CompanyEntityOption[] {
  const [entities, setEntities] = useState<CompanyEntityOption[]>([]);
  useEffect(() => {
    api.get('/company-entities')
      .then(({ data }) => setEntities((data || []).map((e: any) => ({
        code: e.code, company_name: e.company_name,
        banks: (e.banks || []).map((b: any) => ({ bank_name: b.bank_name || '', eur_account: b.eur_account || '', usd_account: b.usd_account || '' })),
        default_bank: Number(e.default_bank) || 0,
      }))))
      .catch(() => setEntities([]));
  }, []);
  return entities;
}
