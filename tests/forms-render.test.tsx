import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { FormField } from '../src/components/ActionForm';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, 'HTMLElement', {
  value: dom.window.HTMLElement,
  configurable: true,
});

const React = await import('react');
const { render, fireEvent, screen, waitFor, cleanup } = await import('@testing-library/react');
const { ActionForm, recoverFormValues } = await import('../src/components/ActionForm');

test('refresh retains notes but removes choices no longer available', () => {
  const fields: FormField[] = [
    { name: 'notes', label: 'Notes', type: 'textarea' },
    { name: 'branchId', label: 'Branch', type: 'select', options: [{ value: 'b2', label: 'Other branch' }] },
    { name: 'cylinderIds', label: 'Cylinders', type: 'multiselect', options: [{ value: 'c2', label: 'C2' }] },
  ];
  assert.deepEqual(recoverFormValues({ notes: 'Original observation', branchId: 'b1', cylinderIds: ['c1', 'c2'] }, fields), {
    notes: 'Original observation', branchId: '', cylinderIds: ['c2'],
  });
});

test('stale form reloads latest fields and submission before saving', async () => {
  const { ApiError } = await import('../src/api');
  const attempts: string[] = [];
  try {
    const view = render(React.createElement(ActionForm, {
      title: 'Inspect cylinder',
      fields: [
        { name: 'notes', label: 'Notes' },
        { name: 'cylinderIds', label: 'Cylinders', type: 'multiselect', options: [{ value: 'old', label: 'OLD' }] },
      ],
      onClose: () => {},
      onSubmit: async () => { throw new ApiError('Cylinder version changed', 409); },
      onReloadLatest: async () => ({
        fields: [
          { name: 'notes', label: 'Notes' },
          { name: 'cylinderIds', label: 'Cylinders', type: 'multiselect', options: [{ value: 'new', label: 'NEW' }] },
        ],
        onSubmit: async (values) => { attempts.push(String(values.notes)); },
      }),
    }));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Keep this note' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'OLD' }));
    fireEvent.submit(view.container.querySelector('form')!);
    await screen.findByRole('button', { name: 'Reload latest form' });
    assert.equal((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled, true);
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest form' }));
    await waitFor(() => assert.equal((screen.getByLabelText('Notes') as HTMLInputElement).value, 'Keep this note'));
    assert.equal(screen.queryByRole('checkbox', { name: 'OLD' }), null);
    fireEvent.submit(view.container.querySelector('form')!);
    await waitFor(() => assert.deepEqual(attempts, ['Keep this note']));
  } finally { cleanup(); }
});

test('changing a supplier clears a branch selected for the previous supplier', async () => {
  const fields: FormField[] = [
    {
      name: 'supplierId',
      label: 'Supplier',
      type: 'select',
      options: [
        { value: 'supplier-a', label: 'Supplier A' },
        { value: 'supplier-b', label: 'Supplier B' },
      ],
    },
    {
      name: 'branchId',
      label: 'Branch',
      type: 'select',
      options: (values) =>
        values.supplierId === 'supplier-a'
          ? [{ value: 'branch-a', label: 'Branch A' }]
          : [{ value: 'branch-b', label: 'Branch B' }],
    },
  ];
  let submitted: Record<string, unknown> | undefined;
  try {
    const view = render(
      React.createElement(ActionForm, {
        title: 'Receive purchase',
        fields,
        onClose: () => {},
        onSubmit: async (values) => {
          submitted = values;
        },
      }),
    );
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'supplier-a' } });
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'branch-a' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'supplier-b' } });
    fireEvent.submit(view.container.querySelector('form')!);
    assert.equal(submitted?.branchId, '');
  } finally {
    cleanup();
  }
});

test('a failed submission keeps the entered values and can be retried', async () => {
  const submitted: Record<string, unknown>[] = [];
  let fail = true;
  try {
    const view = render(
      React.createElement(ActionForm, {
        title: 'Add customer',
        fields: [{ name: 'name', label: 'Customer name', required: true }],
        onClose: () => {},
        onSubmit: async (values) => {
          submitted.push(values);
          if (fail) throw new Error('State changed; refresh and retry');
        },
      }),
    );
    const name = screen.getByLabelText('Customer name *') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Test Clinic' } });
    screen.getByRole('button', { name: 'Save' }).focus();
    fireEvent.submit(view.container.querySelector('form')!);
    await screen.findByRole('alert');
    assert.equal(name.value, 'Test Clinic');
    assert.match(screen.getByRole('alert').textContent || '', /State changed/);
    assert.equal(document.activeElement, screen.getByRole('alert'));
    fail = false;
    fireEvent.submit(view.container.querySelector('form')!);
    await waitFor(() => assert.equal(submitted.length, 2));
    assert.deepEqual(submitted, [{ name: 'Test Clinic' }, { name: 'Test Clinic' }]);
  } finally {
    cleanup();
  }
});

test('handheld scanner commits one exact identifier on Enter and clears for the next scan', async () => {
  const accepted: string[] = [];
  const { default: ScannerInput } = await import('../src/ScannerInput');
  try {
    render(React.createElement(ScannerInput, { onScan: (value: string) => accepted.push(value) }));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'T-1' } });
    assert.deepEqual(accepted, []);
    fireEvent.change(input, { target: { value: 'T-10' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    assert.deepEqual(accepted, ['T-10']);
    assert.equal(input.value, '');
    fireEvent.change(input, { target: { value: 'T-1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    assert.deepEqual(accepted, ['T-10', 'T-1']);
  } finally {
    cleanup();
  }
});

test('form scanner accepts a cylinder by current tag, old tag or serial, and reports unknown codes', async () => {
  let submitted: Record<string, unknown> | undefined;
  try {
    const view = render(
      React.createElement(ActionForm, {
        title: 'Dispatch',
        fields: [
          {
            name: 'cylinderIds',
            label: 'Cylinders',
            type: 'multiselect',
            options: [
              { value: 'c-1', label: 'NEW-TAG · SER-1 · B · Delhi', aliases: ['OLD-TAG', 'SER-1'] },
              { value: 'c-2', label: 'OTHER · SER-2 · B · Delhi', aliases: ['SER-2'] },
            ],
          },
        ],
        onClose: () => {},
        onSubmit: async (values) => {
          submitted = values;
        },
      }),
    );
    const scan = (code: string) => {
      const input = screen.getByPlaceholderText('Scan or type a cylinder tag');
      fireEvent.change(input, { target: { value: code } });
      fireEvent.keyDown(input, { key: 'Enter' });
    };
    scan('old-tag');
    scan('SER-2');
    scan('MISSING-1');
    assert.match(screen.getByRole('alert').textContent ?? '', /No eligible cylinder matches .MISSING-1./);
    fireEvent.submit(view.container.querySelector('form')!);
    await waitFor(() => assert.deepEqual(submitted, { cylinderIds: ['c-1', 'c-2'] }));
  } finally {
    cleanup();
  }
});

test('device save remains available while the browser reports online', async () => {
  let saved = false;
  try {
    render(
      React.createElement(ActionForm, {
        title: 'Record delivery',
        fields: [{ name: 'recipient', label: 'Recipient' }],
        onClose: () => {},
        onSubmit: async () => {},
        alternate: {
          label: 'Save evidence on device',
          offlineOnly: true,
          onSubmit: async () => {
            saved = true;
          },
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save evidence on device' }));
    await waitFor(() => assert.equal(saved, true));
  } finally {
    cleanup();
  }
});

test('the primary submit button is disabled while a submission is in flight', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  try {
    const view = render(
      React.createElement(ActionForm, {
        title: 'Add customer',
        fields: [{ name: 'name', label: 'Customer name' }],
        onClose: () => {},
        onSubmit: () => pending,
      }),
    );
    fireEvent.submit(view.container.querySelector('form')!);
    assert.equal(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled,
      true,
    );
    finish();
    await waitFor(() =>
      assert.equal(
        (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled,
        false,
      ),
    );
  } finally {
    cleanup();
  }
});

test('a changed date is retained through another field update and submitted', async () => {
  let submitted: Record<string, unknown> | undefined;
  try {
    const view = render(
      React.createElement(ActionForm, {
        title: 'Register cylinder',
        fields: [
          { name: 'lastTest', label: 'Last test date', type: 'date', required: true },
          { name: 'certificate', label: 'Certificate', required: true },
        ],
        onClose: () => {},
        onSubmit: async (values) => {
          submitted = values;
        },
      }),
    );
    const date = screen.getByLabelText('Last test date *') as HTMLInputElement;
    fireEvent.change(date, { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Certificate *'), { target: { value: 'CERT-1' } });
    assert.equal(date.value, '2026-09-01');
    fireEvent.submit(view.container.querySelector('form')!);
    await waitFor(() => assert.ok(submitted));
    assert.equal(submitted?.lastTest, '2026-09-01');
  } finally {
    cleanup();
  }
});
