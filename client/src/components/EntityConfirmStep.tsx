import { AlertTriangle, Building2, Check, CheckCircle2 } from 'lucide-react';

/**
 * Customers that trade as several legal entities must never have one picked
 * silently — a Guatemala confirmation carrying Costa Rican tax details is a
 * real commercial error. So: when the system recognises the entity it asks the
 * user to confirm it; when it cannot, it asks them to choose. Either way the
 * document cannot be generated until this is settled.
 */

export interface EntityProfileOption {
  id: number;
  name: string;
  is_default: boolean;
}

interface Props {
  profiles: EntityProfileOption[];
  profileId: number | null;
  profileName: string | null;
  /** Why the system picked this entity, e.g. "destination Puerto Quetzal → Guatemala". */
  matchedBy: string;
  /** False when nothing in the order identified the entity. */
  confident: boolean;
  confirmed: boolean;
  /** User asked to change the entity — show the chooser even on a confident match. */
  chooseMode: boolean;
  /** Identity that differs between arms — shown so confirming is a real check. */
  identity: { client_code?: string; tax_id?: string; billing_address?: string };
  onConfirm: () => void;
  onChoose: (profileId: number) => void;
  onReopen: () => void;
  busy?: boolean;
}

export default function EntityConfirmStep({
  profiles, profileId, profileName, matchedBy, confident, confirmed, chooseMode, identity,
  onConfirm, onChoose, onReopen, busy,
}: Props) {
  // Nothing to disambiguate
  if (profiles.length < 2) return null;

  if (confirmed) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm">
        <CheckCircle2 size={15} className="text-green-600 flex-shrink-0" />
        <span className="text-green-800">Entity: <strong>{profileName}</strong></span>
        <button onClick={onReopen} className="ml-auto text-xs text-green-700 hover:text-green-900 underline">
          Change
        </button>
      </div>
    );
  }

  const summary = [
    identity.client_code,
    identity.tax_id ? `Tax ${identity.tax_id}` : '',
    String(identity.billing_address || '').split('\n')[0],
  ].filter(Boolean).join(' · ');

  // Recognised — ask for a confirmation
  if (confident && !chooseMode && profileId) {
    return (
      <div className="rounded-xl border border-primary-200 bg-primary-50 px-5 py-4">
        <div className="flex items-start gap-3">
          <Building2 size={18} className="text-primary-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900">
              This order looks like the <strong className="text-primary-700">{profileName}</strong> entity
            </p>
            {matchedBy && <p className="text-xs text-gray-600 mt-0.5">matched on {matchedBy}</p>}
            {summary && <p className="text-xs text-gray-500 mt-1.5 truncate">{summary}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onConfirm}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60"
            >
              <Check size={14} /> Confirm
            </button>
            <button onClick={onReopen} className="text-xs text-gray-600 hover:text-gray-800 underline whitespace-nowrap">
              Use a different one
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Not recognised, or the user asked to change it — make them choose
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900">Which entity is this order for?</p>
          <p className="text-xs text-amber-800 mt-0.5">
            {chooseMode
              ? 'Pick the entity to draft this document from.'
              : 'Nothing in this order identified it, so the details cannot be filled in automatically.'}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {profiles.map(p => (
              <button
                key={p.id}
                onClick={() => onChoose(p.id)}
                disabled={busy}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-60 ${
                  p.id === profileId
                    ? 'bg-white border-amber-400 text-amber-900'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-amber-400'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
