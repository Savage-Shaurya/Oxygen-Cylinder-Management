import { useState } from 'react';
import { Button, Field, Modal } from './components/UI';

type LedgerKey =
  | 'salesGas'
  | 'salesRental'
  | 'cgst'
  | 'sgst'
  | 'igst'
  | 'cash'
  | 'bank'
  | 'upi'
  | 'deposits'
  | 'creditNotes';

// Same defaults as server/tally.ts; UPI empty means "use the bank ledger".
const LEDGERS: { key: LedgerKey; label: string; fallback: string; hint?: string }[] = [
  { key: 'salesGas', label: 'Gas sales ledger', fallback: 'Sales - Medical Oxygen' },
  { key: 'salesRental', label: 'Rental income ledger', fallback: 'Cylinder Rental Income' },
  { key: 'cgst', label: 'Output CGST ledger', fallback: 'Output CGST' },
  { key: 'sgst', label: 'Output SGST ledger', fallback: 'Output SGST' },
  { key: 'igst', label: 'Output IGST ledger', fallback: 'Output IGST' },
  { key: 'cash', label: 'Cash ledger', fallback: 'Cash' },
  { key: 'bank', label: 'Bank ledger', fallback: 'Bank Account' },
  {
    key: 'upi',
    label: 'UPI ledger',
    fallback: '',
    hint: 'Leave empty to post UPI to the bank ledger.',
  },
  {
    key: 'deposits',
    label: 'Security deposits ledger',
    fallback: 'Cylinder Security Deposits',
    hint: 'A liability ledger.',
  },
  { key: 'creditNotes', label: 'Sales returns ledger', fallback: 'Sales Returns' },
];
const STORAGE_KEY = 'cylvero.tallyExport.v1';
type Contents = 'both' | 'masters' | 'vouchers';
type Saved = {
  company?: string;
  contents?: Contents;
  ledgers?: Partial<Record<LedgerKey, string>>;
};

function loadSaved(): Saved {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : {};
    return value && typeof value === 'object' ? (value as Saved) : {};
  } catch {
    return {};
  }
}
function save(value: Saved) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* Storage blocked: the form still works for this visit. */
  }
}
function indiaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function TallyExportDialog({
  onClose,
  defaultCompany,
}: {
  onClose: () => void;
  defaultCompany: string;
}) {
  const [saved] = useState(loadSaved);
  const today = indiaToday();
  const [company, setCompany] = useState(
    typeof saved.company === 'string' && saved.company ? saved.company : defaultCompany,
  );
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [contents, setContents] = useState<Contents>(
    saved.contents === 'masters' || saved.contents === 'vouchers' ? saved.contents : 'both',
  );
  const [ledgers, setLedgers] = useState<Record<LedgerKey, string>>(
    () =>
      Object.fromEntries(
        LEDGERS.map(({ key, fallback }) => {
          const value = saved.ledgers?.[key];
          return [key, typeof value === 'string' ? value : fallback];
        }),
      ) as Record<LedgerKey, string>,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function download() {
    setError('');
    setDone('');
    if (!company.trim()) return setError('Enter the Tally company name.');
    if (!from || !to) return setError('Choose both dates.');
    if (from > to) return setError('The from date must not be after the to date.');
    save({ company: company.trim(), contents, ledgers });
    const params = new URLSearchParams({ company: company.trim(), from, to });
    for (const { key } of LEDGERS) if (ledgers[key].trim()) params.set(key, ledgers[key].trim());
    if (contents === 'masters') params.set('vouchers', '0');
    if (contents === 'vouchers') params.set('masters', '0');
    setBusy(true);
    try {
      const response = await fetch(`/api/export/tally?${params}`, {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        let message = `Export failed (${response.status}).`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          /* Not JSON; keep the status message. */
        }
        setError(message);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cylvero-tally-${from}-${to}.xml`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const skipped = Number(response.headers.get('X-Tally-Skipped') ?? 0);
      setDone(
        `Downloaded cylvero-tally-${from}-${to}.xml.${skipped > 0 ? ` ${skipped} record(s) were not exported: credit allocations, which do not change any ledger balance, or records that need correcting in Cylvero.` : ''}`,
      );
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Export to Tally"
      subtitle="Customer ledgers and accounting vouchers for TallyPrime"
      onClose={onClose}
      width="wide"
    >
      <form
        className="action-form"
        onSubmit={(event) => {
          event.preventDefault();
          void download();
        }}
      >
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="form-warning" role="status">
            {done}
          </p>
        )}
        <div className="form-grid">
          <Field label="Tally company name" required hint="Exactly as it appears in TallyPrime.">
            <input
              value={company}
              maxLength={100}
              onChange={(e) => setCompany(e.target.value)}
              className="field-full"
            />
          </Field>
          <Field label="From (India date)" required>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To (India date)" required>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="What to include">
            <select value={contents} onChange={(e) => setContents(e.target.value as Contents)}>
              <option value="both">Ledgers and vouchers</option>
              <option value="masters">Ledgers only (masters)</option>
              <option value="vouchers">Vouchers only (transactions)</option>
            </select>
          </Field>
          {LEDGERS.map(({ key, label, hint, fallback }) => (
            <Field key={key} label={label} hint={hint}>
              <input
                value={ledgers[key]}
                maxLength={100}
                placeholder={fallback || 'Same as bank ledger'}
                onChange={(e) => setLedgers((current) => ({ ...current, [key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <p className="form-warning" style={{ marginTop: 17 }}>
          Check the ledger names match your Tally company before importing.
        </p>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
          <strong>How to import into TallyPrime</strong>
          <ol style={{ paddingLeft: 18, margin: '6px 0 0' }}>
            <li>Open the company in TallyPrime and take a backup.</li>
            <li>
              Gateway of Tally → Import (Alt+O) → <strong>Masters</strong>. Choose this file. If a
              ledger already exists, pick “Ignore duplicates” to keep your Tally setup, or “Modify
              with new data” to update customer details.
            </li>
            <li>
              Then Import → <strong>Transactions</strong> and choose the same file.
            </li>
            <li>
              Vouchers carry a fixed ID, so importing the same file again replaces them instead of
              adding copies when “Overwrite vouchers during import” is Yes (F12 configuration).
            </li>
            <li>Check the Day Book and the import exceptions report afterwards.</li>
          </ol>
        </div>
        <div className="form-actions">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button type="submit" loading={busy}>
            Download Tally XML
          </Button>
        </div>
      </form>
    </Modal>
  );
}
