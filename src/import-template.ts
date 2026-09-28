/** The cylinder import schema, distinct from the stock-report export columns. */
export const CYLINDER_IMPORT_COLUMNS = [
  'serial', 'tag', 'manufacturer', 'gas', 'size', 'ownerId', 'branchId',
  'testDue', 'lastTest', 'certificate',
] as const;

export function downloadCylinderImportTemplate(): void {
  const contents = `${CYLINDER_IMPORT_COLUMNS.join(',')}\n`;
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cylinder-import-template.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
