export type NamedField = { name: string };

export function updateFormValues(
  previous: Record<string, unknown>,
  name: string,
  value: unknown,
  fields: NamedField[],
): Record<string, unknown> {
  return {
    ...previous,
    [name]: value,
    ...(['branchId', 'partyId', 'supplierId', 'gas'].includes(name) &&
    fields.some((field) => field.name === 'cylinderIds')
      ? { cylinderIds: [] }
      : {}),
  };
}

// Only the displayed form's fields may reach a command, including forms already open during an update.
export function declaredFormValues(
  values: Record<string, unknown>,
  fields: NamedField[],
): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.name, values[field.name]]));
}
