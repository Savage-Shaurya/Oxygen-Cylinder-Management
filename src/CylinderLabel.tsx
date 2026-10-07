import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { DownloadSimple, Printer } from '@phosphor-icons/react';
import type { Cylinder } from '../shared/types';

export default function CylinderLabel({ cylinder }: { cylinder: Cylinder }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    QRCode.toDataURL(cylinder.tag, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'H',
    })
      .then((value) => {
        if (current) setUrl(value);
      })
      .catch(() => {
        if (current) setError('The QR label could not be generated. Try again.');
      });
    return () => {
      current = false;
    };
  }, [cylinder.tag]);
  /** A PNG of the label (QR, tag and details) to save, share on WhatsApp or print later. */
  async function download() {
    setError('');
    try {
      const qr = document.createElement('canvas');
      await QRCode.toCanvas(qr, cylinder.tag, { width: 520, margin: 2, errorCorrectionLevel: 'H' });
      const card = document.createElement('canvas');
      card.width = 600;
      card.height = 780;
      const ctx = card.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, card.width, card.height);
      ctx.drawImage(qr, 40, 30, 520, 520);
      ctx.fillStyle = '#182a25';
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px monospace';
      ctx.fillText(cylinder.tag, 300, 600);
      ctx.font = '24px Arial, sans-serif';
      ctx.fillText(`Serial ${cylinder.serial}`, 300, 648);
      ctx.fillText(`${cylinder.gas} · size ${cylinder.size}`, 300, 684);
      ctx.fillStyle = '#64716a';
      ctx.font = '18px Arial, sans-serif';
      ctx.fillText(`${cylinder.manufacturer} · Cylvero`, 300, 730);
      const blob = await new Promise<Blob | null>((resolve) => card.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Image unavailable');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `cylinder-qr-${cylinder.tag.replace(/[^\w-]+/g, '_')}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch {
      setError('The QR image could not be created. Use Print label instead.');
    }
  }
  function print() {
    const page = window.open('', '_blank', 'width=560,height=680');
    if (!page) {
      setError('Allow the print window, then select Print label again.');
      return;
    }
    page.opener = null;
    page.document.title = `Cylinder label ${cylinder.serial}`;
    const style = page.document.createElement('style');
    style.textContent =
      'body{font-family:Arial,sans-serif;text-align:center;color:#182a25;padding:24px}h1{font-size:20px}img{width:220px;height:220px}.tag{font:16px monospace}p{font-size:13px}@media print{@page{size:80mm 110mm;margin:4mm}body{padding:0}img{width:55mm;height:55mm}}';
    page.document.head.append(style);
    const heading = page.document.createElement('h1');
    heading.textContent = cylinder.serial;
    const image = page.document.createElement('img');
    image.src = url;
    image.alt = `QR identifier ${cylinder.tag}`;
    const tag = page.document.createElement('p');
    tag.className = 'tag';
    tag.textContent = cylinder.tag;
    const info = page.document.createElement('p');
    info.textContent = `${cylinder.manufacturer} · ${cylinder.gas} · ${cylinder.size}`;
    const note = page.document.createElement('p');
    note.textContent =
      'Digital identity label. Does not certify test status or gas quality. Fitment must follow the approved procedure.';
    page.document.body.append(heading, image, tag, info, note);
    image.onload = () => {
      page.focus();
      page.print();
    };
  }
  return (
    <div
      className="cylinder-label"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '16px 0',
      }}
    >
      {url ? (
        <img
          src={url}
          width={112}
          height={112}
          alt={`QR identifier for ${cylinder.serial}`}
          style={{ border: '1px solid #e1e6e3', borderRadius: 8 }}
        />
      ) : (
        <div
          style={{
            width: 112,
            height: 112,
            background: '#eef1ef',
            borderRadius: 8,
          }}
          aria-label="Generating QR label"
        />
      )}
      <div>
        <strong style={{ display: 'block', marginBottom: 6 }}>Cylinder identity</strong>
        <code>{cylinder.tag}</code>
        <p style={{ color: '#64716a', fontSize: 13, margin: '6px 0 10px' }}>
          QR contains only this identifier.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn button"
            type="button"
            disabled={!url}
            onClick={() => void download()}
          >
            <DownloadSimple size={16} /> Download QR
          </button>
          <button className="btn button" type="button" disabled={!url} onClick={print}>
            <Printer size={16} /> Print label
          </button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/**
 * Opens a printable sheet of QR labels (3 per row) for the given cylinders, e.g. after a CSV
 * import. The browser's print dialog can also save it as a PDF.
 */
export function printLabelSheet(cylinders: Cylinder[]): string | null {
  if (!cylinders.length) return 'No cylinders in this list to label.';
  // Open the window first, while the tap still counts as a user action, then fill it in.
  const page = window.open('', '_blank', 'width=900,height=900');
  if (!page) return 'Allow pop-ups for this site, then choose Print QR labels again.';
  page.opener = null;
  page.document.title = `QR labels (${cylinders.length})`;
  const style = page.document.createElement('style');
  style.textContent =
    'body{font-family:Arial,sans-serif;color:#182a25;margin:16px}p.note{font-size:12px;color:#64716a}' +
    '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}' +
    '.label{border:1px dashed #b9c4bd;border-radius:8px;padding:10px;text-align:center;break-inside:avoid}' +
    '.label img{width:150px;height:150px}.tag{font:bold 15px monospace;margin:4px 0}.info{font-size:11px;color:#4f5f55}' +
    '@media print{p.note{display:none}body{margin:6mm}.label{border-color:#999}}';
  page.document.head.append(style);
  const note = page.document.createElement('p');
  note.className = 'note';
  note.textContent = `Preparing ${cylinders.length} labels…`;
  const grid = page.document.createElement('div');
  grid.className = 'grid';
  page.document.body.append(note, grid);
  void Promise.all(
    cylinders.map((c) =>
      QRCode.toDataURL(c.tag, { width: 300, margin: 2, errorCorrectionLevel: 'H' }),
    ),
  )
    .then((urls) => {
      cylinders.forEach((c, i) => {
        const card = page.document.createElement('div');
        card.className = 'label';
        const image = page.document.createElement('img');
        image.src = urls[i];
        image.alt = `QR ${c.tag}`;
        const tag = page.document.createElement('div');
        tag.className = 'tag';
        tag.textContent = c.tag;
        const info = page.document.createElement('div');
        info.className = 'info';
        info.textContent = `${c.serial} · ${c.gas} · ${c.size}`;
        card.append(image, tag, info);
        grid.append(card);
      });
      note.textContent = `${cylinders.length} labels. Use Print, or choose "Save as PDF" as the printer.`;
      page.focus();
      setTimeout(() => page.print(), 400);
    })
    .catch(() => {
      note.textContent = 'The labels could not be created. Close this window and try again.';
    });
  return null;
}
