export type NamedField = {
  name: string;
  label?: string;
  type?: string;
  options?: { value: string }[] | ((values: Record<string, unknown>) => { value: string }[]);
  defaultOnChange?: {
    dependsOn: string[];
    value: (values: Record<string, unknown>) => unknown;
  };
};

export function updateFormValues(
  previous: Record<string, unknown>,
  name: string,
  value: unknown,
  fields: NamedField[],
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...previous,
    [name]: value,
    ...(['branchId', 'partyId', 'supplierId', 'gas'].includes(name) &&
    fields.some((field) => field.name === 'cylinderIds' && typeof field.options !== 'function')
      ? { cylinderIds: [] }
      : {}),
  };
  for (const field of fields) {
    if (field.defaultOnChange?.dependsOn.includes(name))
      next[field.name] = field.defaultOnChange.value(next);
  }
  for (const field of fields) {
    if (typeof field.options !== 'function') continue;
    const allowed = new Set(field.options(next).map((option) => option.value));
    const selected = next[field.name];
    if (typeof selected === 'string' && selected && !allowed.has(selected)) next[field.name] = '';
    if (Array.isArray(selected)) next[field.name] = selected.filter((value) => allowed.has(value));
  }
  return next;
}

// Only the displayed form's fields may reach a command, including forms already open during an update.
export function declaredFormValues(
  values: Record<string, unknown>,
  fields: NamedField[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      typeof values[field.name] === 'string' && field.type !== 'password'
        ? (values[field.name] as string).trim()
        : values[field.name],
    ]),
  );
}

export function friendlyFormError(message: string, fields: NamedField[]): string {
  const schema = message.match(/^Invalid [^:]+ payload: (.+)$/);
  if (!schema) return message;
  return schema[1]
    .split('; ')
    .map((issue) => {
      const match = issue.match(/^(?:(?:rows|cylinders)\.(\d+)\.)?([A-Za-z][\w]*): (.+)$/);
      if (!match) return issue;
      const label =
        fields.find((field) => field.name === match[2])?.label ||
        match[2]
          .replace(/Id$/, '')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/^./, (letter) => letter.toUpperCase());
      return `${match[1] === undefined ? '' : `Row ${Number(match[1]) + 1} · `}${label}: ${match[3]}`;
    })
    .join('; ');
}
