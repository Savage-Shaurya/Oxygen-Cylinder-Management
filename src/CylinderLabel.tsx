import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer } from '@phosphor-icons/react';
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
        <button className="btn button" type="button" disabled={!url} onClick={print}>
          <Printer size={16} /> Print label
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
