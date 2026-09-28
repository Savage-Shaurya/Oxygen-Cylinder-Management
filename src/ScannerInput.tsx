import { useEffect, useRef, useState } from 'react';
import { Barcode, Camera, X } from '@phosphor-icons/react';
import type { IScannerControls } from '@zxing/browser';

export default function ScannerInput({
  onScan,
  placeholder = 'Scan or enter a cylinder ID',
}: {
  onScan: (value: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const callback = useRef(onScan);
  callback.current = onScan;
  useEffect(() => {
    if (!active || !video.current) return;
    let cancelled = false;
    import('@zxing/browser')
      .then(async ({ BrowserMultiFormatReader }) => {
        if (cancelled || !video.current) return;
        const reader = new BrowserMultiFormatReader();
        try {
          const camera = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' } }, audio: false },
            video.current,
            (result, _error, control) => {
              if (result && !cancelled) {
                const text = result.getText().trim();
                if (!text) return;
                control.stop();
                setValue(text);
                callback.current(text);
                setActive(false);
              }
            },
          );
          if (cancelled) camera.stop();
          else controls.current = camera;
        } catch (failure) {
          if (!cancelled) {
            setError(
              failure instanceof Error && failure.name === 'NotAllowedError'
                ? 'Camera permission was declined. Enter the identifier or use a handheld scanner.'
                : 'Camera unavailable. Use an identifier or a handheld scanner instead.',
            );
            setActive(false);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Camera scanner could not load. Enter the identifier below.');
          setActive(false);
        }
      });
    return () => {
      cancelled = true;
      controls.current?.stop();
      controls.current = null;
    };
  }, [active]);
  return (
    <div className="scanner-input">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Barcode size={20} aria-hidden="true" />
        <input
          aria-label={placeholder}
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            callback.current(event.target.value.trim());
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              callback.current(value.trim());
            }
          }}
          autoComplete="off"
          style={{ minWidth: 0, flex: 1 }}
        />
        <button
          className="btn button"
          type="button"
          aria-label={active ? 'Stop camera scanner' : 'Scan with camera'}
          onClick={() => {
            setError('');
            setActive(!active);
          }}
        >
          {active ? <X size={18} /> : <Camera size={18} />}
        </button>
      </div>
      {active && (
        <div style={{ marginTop: 12 }}>
          <video
            ref={video}
            muted
            playsInline
            style={{
              width: '100%',
              maxHeight: 300,
              borderRadius: 12,
              objectFit: 'cover',
              background: '#192d26',
            }}
          />
          <p style={{ fontSize: 13 }}>Point the camera at the cylinder’s QR or barcode.</p>
        </div>
      )}
      {error && (
        <p role="alert" style={{ fontSize: 13, color: '#9e452b', marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
