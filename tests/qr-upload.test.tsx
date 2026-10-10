import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// "Scan from gallery": a picked photo is read and treated exactly like a camera scan.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
for (const key of ['window', 'document', 'navigator', 'HTMLElement'] as const)
  Object.defineProperty(globalThis, key, {
    value: key === 'window' ? dom.window : dom.window[key],
    configurable: true,
  });

const React = await import('react');
const { render, fireEvent, screen, waitFor, cleanup } = await import('@testing-library/react');
const { default: ScannerInput } = await import('../src/ScannerInput');

const photo = () => new dom.window.File(['fake image bytes'], 'qr.png', { type: 'image/png' });

test('office scanner reads an uploaded QR image like a scan', async () => {
  const scanned: string[] = [];
  try {
    render(
      React.createElement(ScannerInput, {
        onScan: (code: string) => scanned.push(code),
        readImage: async () => 'DEMO-TAG-00004',
      }),
    );
    assert.ok(screen.getByRole('button', { name: 'Upload a QR image' }));
    fireEvent.change(screen.getByLabelText('QR image file'), { target: { files: [photo()] } });
    await waitFor(() => assert.deepEqual(scanned, ['DEMO-TAG-00004']));
  } finally {
    cleanup();
  }
});

test('office scanner explains when an image has no code', async () => {
  const scanned: string[] = [];
  try {
    render(
      React.createElement(ScannerInput, {
        onScan: (code: string) => scanned.push(code),
        readImage: async () => null,
      }),
    );
    fireEvent.change(screen.getByLabelText('QR image file'), { target: { files: [photo()] } });
    await screen.findByText(/No QR or barcode was found/);
    assert.equal(scanned.length, 0);
  } finally {
    cleanup();
  }
});
