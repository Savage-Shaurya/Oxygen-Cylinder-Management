import { useEffect, useRef, useState, type FormEvent } from 'react';
import ScannerInput from '../ScannerInput';
import { ApiError } from '../api';
import { updateFormValues, declaredFormValues, friendlyFormError } from './form-values';
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
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
  value?: string | number | string[];
  span?: 'full';
  defaultOnChange?: {
    dependsOn: string[];
    value: (values: Record<string, unknown>) => unknown;
  };
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
  onReloadLatest?: (values: Record<string, unknown>) => Promise<ReloadedForm>;
}

export type ReloadedForm = {
  fields: FormField[];
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  initial?: Record<string, unknown>;
  title?: string;
  subtitle?: string;
  warning?: string;
  alternate?: Props['alternate'];
  resetValues?: boolean;
};

export function recoverFormValues(
  previous: Record<string, unknown>,
  fields: FormField[],
  initial: Record<string, unknown> = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = Object.fromEntries(
    fields.map((field) => [
      field.name,
      previous[field.name] ?? initial[field.name] ?? field.value ??
        (field.type === 'multiselect' ? [] : ''),
    ]),
  );
  // Dynamic choices can depend on another field, so check all choices after carrying values over.
  for (let pass = 0; pass < fields.length; pass++) {
    let changed = false;
    for (const field of fields) {
      if (field.type !== 'select' && field.type !== 'multiselect') continue;
      const choices = typeof field.options === 'function' ? field.options(next) : field.options;
      const allowed = new Set((choices || []).filter((choice) => !choice.disabled).map((choice) => choice.value));
      const current = next[field.name];
      if (field.type === 'multiselect') {
        const kept = Array.isArray(current) ? current.filter((value) => allowed.has(String(value))) : [];
        if (!Array.isArray(current) || kept.length !== current.length) {
          next[field.name] = kept;
          changed = true;
        }
      } else if (typeof current !== 'string' || (current && !allowed.has(current))) {
        next[field.name] = '';
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
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
  onReloadLatest,
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
  const [stale, setStale] = useState(false);
  const [reloaded, setReloaded] = useState<ReloadedForm | null>(null);
  const activeFields = reloaded?.fields ?? fields;
  const activeSubmit = reloaded?.onSubmit ?? onSubmit;
  const activeAlternate = reloaded?.alternate ?? alternate;
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function set(name: string, value: unknown) {
    setValues((previous) => updateFormValues(previous, name, value, activeFields));
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await activeSubmit(declaredFormValues(values, activeFields));
      onClose();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      setStale(!!onReloadLatest && failure instanceof ApiError && failure.status === 409);
      setError(
        failure instanceof Error
          ? friendlyFormError(message, activeFields)
          : 'Could not save. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function submitAlternate() {
    setError('');
    setBusy(true);
    try {
      await activeAlternate?.onSubmit(declaredFormValues(values, activeFields));
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? friendlyFormError(failure.message, activeFields)
          : 'Could not save on this device.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function reloadLatest() {
    if (!onReloadLatest) return;
    setBusy(true);
    try {
      const latest = await onReloadLatest(declaredFormValues(values, activeFields));
      setValues(latest.resetValues
        ? recoverFormValues({}, latest.fields, latest.initial)
        : recoverFormValues(values, latest.fields, latest.initial));
      setReloaded(latest);
      setStale(false);
      setError(latest.resetValues
        ? 'Latest saved values loaded. Review them before saving your changes again.'
        : 'Review the refreshed choices before saving. Any unavailable selections were cleared.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not reload the latest form.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={reloaded?.title ?? title} subtitle={reloaded?.subtitle ?? subtitle} onClose={onClose} width="wide">
      <form onSubmit={submit} className="action-form">
        {(reloaded?.warning ?? warning) && <div className="form-warning">{reloaded?.warning ?? warning}</div>}
        <div className="form-grid">
          {activeFields.map((field) => {
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
                      minLength={field.minLength}
                      maxLength={field.maxLength}
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
                      minLength={field.minLength}
                      maxLength={field.maxLength}
                      onChange={(event) => set(field.name, event.target.value)}
                    />
                  )}
                </div>
              </Field>
            );
          })}
        </div>
        {error && (
          <div className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
            {error}
          </div>
        )}
        {stale && onReloadLatest && (
          <button type="button" className="button btn" disabled={busy} onClick={() => void reloadLatest()}>
            Reload latest form
          </button>
        )}
        <div className="form-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {activeAlternate && (
            <Button variant="secondary" onClick={submitAlternate} loading={busy} disabled={stale}>
              {activeAlternate.label}
            </Button>
          )}
          <Button type="submit" loading={busy} disabled={stale}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
