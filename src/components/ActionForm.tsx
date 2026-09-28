import { useEffect, useState, type FormEvent } from 'react';
import ScannerInput from '../ScannerInput';
import { updateFormValues, declaredFormValues } from './form-values';
import { Button, Field, Modal } from './UI';

export type Option = { value: string; label: string; disabled?: boolean };
export type FormField = {
  name: string;
  label: string;
  type?:
    | 'text'
    | 'number'
    | 'date'
    | 'datetime-local'
    | 'select'
    | 'textarea'
    | 'multiselect'
    | 'email'
    | 'tel'
    | 'password'
    | 'file';
  required?: boolean;
  hint?: string;
  options?: Option[] | ((values: Record<string, unknown>) => Option[]);
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  value?: string | number | string[];
  span?: 'full';
};

interface Props {
  title: string;
  subtitle?: string;
  fields: FormField[];
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  initial?: Record<string, unknown>;
  warning?: string;
  alternate?: {
    label: string;
    onSubmit: (values: Record<string, unknown>) => Promise<void>;
    offlineOnly?: boolean;
  };
}

export function ActionForm({
  title,
  subtitle,
  fields,
  submitLabel = 'Save',
  onClose,
  onSubmit,
  initial = {},
  warning,
  alternate,
}: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.name,
        initial[f.name] ?? f.value ?? (f.type === 'multiselect' ? [] : ''),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  function set(name: string, value: unknown) {
    setValues((previous) => updateFormValues(previous, name, value, fields));
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit(declaredFormValues(values, fields));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function submitAlternate() {
    setError('');
    setBusy(true);
    try {
      await alternate?.onSubmit(declaredFormValues(values, fields));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save on this device.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} width="wide">
      <form onSubmit={submit} className="action-form">
        {warning && <div className="form-warning">{warning}</div>}
        <div className="form-grid">
          {fields.map((field) => {
            const options =
              typeof field.options === 'function' ? field.options(values) : field.options;
            const selected = (values[field.name] as string[]) || [];
            return (
              <Field
                key={field.name}
                label={field.label}
                hint={field.hint}
                required={field.required}
              >
                <div className={field.span === 'full' ? 'field-full' : ''}>
                  {field.type === 'select' ? (
                    <select
                      value={String(values[field.name] ?? '')}
                      required={field.required}
                      onChange={(event) => set(field.name, event.target.value)}
                    >
                      <option value="">Select {field.label.toLowerCase()}</option>
                      {options?.map((option) => (
                        <option key={option.value} value={option.value} disabled={option.disabled}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'multiselect' ? (
                    <div className="multi-select-wrap">
                      {field.name === 'cylinderIds' && (
                        <ScannerInput
                          placeholder={`Scan ${field.label.toLowerCase()}`}
                          onScan={(value) => {
                            if (!value) return;
                            const match = options?.find(
                              (option) =>
                                option.value === value ||
                                option.label.split(' · ')[0].toLowerCase() === value.toLowerCase(),
                            );
                            if (!match) {
                              setError(
                                `No eligible cylinder matches “${value}”. Check the selected customer, branch and manifest.`,
                              );
                              return;
                            }
                            set(field.name, Array.from(new Set([...selected, match.value])));
                          }}
                        />
                      )}
                      <div className="multi-options" role="group" aria-label={field.label}>
                        {options?.length ? (
                          options.map((option) => (
                            <label
                              key={option.value}
                              className={`check-row ${option.disabled ? 'disabled' : ''}`}
                            >
                              <input
                                type="checkbox"
                                disabled={option.disabled}
                                checked={selected.includes(option.value)}
                                onChange={(event) =>
                                  set(
                                    field.name,
                                    event.target.checked
                                      ? [...selected, option.value]
                                      : selected.filter((value) => value !== option.value),
                                  )
                                }
                              />
                              <span>{option.label}</span>
                            </label>
                          ))
                        ) : (
                          <div className="muted pad">
                            Choose the customer, branch or gas first to see eligible cylinders.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : field.type === 'file' ? (
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) => set(field.name, event.target.files?.[0])}
                    />
                  ) : field.type === 'textarea' ? (
                    <textarea
                      rows={4}
                      required={field.required}
                      value={String(values[field.name] ?? '')}
                      placeholder={field.placeholder}
                      onChange={(event) => set(field.name, event.target.value)}
                    />
                  ) : (
                    <input
                      type={field.type || 'text'}
                      required={field.required}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      placeholder={field.placeholder}
                      value={String(values[field.name] ?? '')}
                      onChange={(event) => set(field.name, event.target.value)}
                    />
                  )}
                </div>
              </Field>
            );
          })}
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {alternate && (!alternate.offlineOnly || !online) && (
            <Button variant="secondary" onClick={submitAlternate} loading={busy}>
              {alternate.label}
            </Button>
          )}
          <Button type="submit" loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
