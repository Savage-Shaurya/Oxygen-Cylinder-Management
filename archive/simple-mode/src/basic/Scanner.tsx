import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import {
  CameraSlash,
  Flashlight,
  Image as ImageIcon,
  Keyboard,
  ListBullets,
} from '@phosphor-icons/react';
import { t } from '../i18n';
import { readCodeFromImage } from '../qr-image';
import { Sheet } from './components';
import { scanReject } from './feedback';
import { breathe } from './motion';

export type PickOption = { code: string; label: string; note?: string };

type CameraState = 'starting' | 'live' | 'blocked' | 'none';

/**
 * A camera that stays open and keeps reading codes until the screen closes.
 * The same code is ignored for two seconds so one cylinder is not counted twice.
 * Handheld Bluetooth scanners that "type" a code and press Enter also work, and a photo or
 * screenshot of the QR can be picked from the gallery and read automatically.
 */
export default function Scanner({
  onCode,
  options = [],
  paused = false,
  readImage = readCodeFromImage,
}: {
  onCode: (code: string) => void;
  options?: PickOption[];
  paused?: boolean;
  /** Reads a code from a picked photo; replaceable in tests. */
  readImage?: (file: Blob) => Promise<string | null>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const corners = useRef<HTMLDivElement>(null);
  const callback = useRef(onCode);
  callback.current = onCode;
  const recent = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const hasCamera =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
  const [camera, setCamera] = useState<CameraState>(hasCamera ? 'starting' : 'none');
  const [torch, setTorch] = useState(false);
  const [torchReady, setTorchReady] = useState(false);
  const [sheet, setSheet] = useState<'type' | 'list' | null>(null);
  const [typed, setTyped] = useState('');
  const [photo, setPhoto] = useState<'idle' | 'reading' | 'failed'>('idle');
  const picker = useRef<HTMLInputElement>(null);

  async function readPhoto(file: File | undefined) {
    if (!file) return;
    setPhoto('reading');
    let code: string | null = null;
    try {
      code = await readImage(file);
    } catch {
      code = null;
    }
    if (picker.current) picker.current.value = '';
    if (!code) {
      setPhoto('failed');
      scanReject(t('scan.photoFailed'));
      return;
    }
    setPhoto('idle');
    recent.current = { code: '', at: 0 };
    deliver(code);
  }
  const pickPhoto = () => picker.current?.click();

  function deliver(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (recent.current.code === code && now - recent.current.at < 2000) return;
    recent.current = { code, at: now };
    callback.current(code);
  }

  useEffect(() => {
    if (!hasCamera || paused || !video.current) return;
    let cancelled = false;
    setCamera('starting');
    import('@zxing/browser')
      .then(async ({ BrowserMultiFormatReader }) => {
        if (cancelled || !video.current) return;
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 120,
          delayBetweenScanSuccess: 600,
        });
        try {
          const live = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' } }, audio: false },
            video.current,
            (result) => {
              if (result && !cancelled) deliver(result.getText());
            },
          );
          if (cancelled) {
            live.stop();
            return;
          }
          controls.current = live;
          setTorchReady(typeof live.switchTorch === 'function');
          setCamera('live');
        } catch (failure) {
          if (!cancelled)
            setCamera(
              failure instanceof Error && failure.name === 'NotAllowedError' ? 'blocked' : 'none',
            );
        }
      })
      .catch(() => {
        if (!cancelled) setCamera('none');
      });
    return () => {
      cancelled = true;
      controls.current?.stop();
      controls.current = null;
      setTorch(false);
    };
  }, [hasCamera, paused]);

  useEffect(() => {
    const animation = breathe(corners.current ? Array.from(corners.current.children) : []);
    return () => animation.pause();
  }, [camera]);

  // Keyboard-wedge scanners type fast and end with Enter.
  useEffect(() => {
    let buffer = '';
    let last = 0;
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const now = Date.now();
      if (now - last > 80) buffer = '';
      last = now;
      if (event.key === 'Enter') {
        if (buffer.length >= 3) deliver(buffer);
        buffer = '';
      } else if (event.key.length === 1) buffer += event.key;
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  async function toggleTorch() {
    try {
      await controls.current?.switchTorch?.(!torch);
      setTorch(!torch);
    } catch {
      setTorchReady(false);
    }
  }

  return (
    <div className="b-scanner">
      <div className={`b-camera ${camera}`}>
        {hasCamera && camera !== 'blocked' && camera !== 'none' && (
          <video ref={video} muted playsInline aria-label={t('scan.camera')} />
        )}
        {(camera === 'blocked' || camera === 'none') && (
          <div className="b-camera-off">
            <CameraSlash size={46} weight="duotone" />
            <p>{t(camera === 'blocked' ? 'scan.blocked' : 'scan.noCamera')}</p>
            <button className="b-big solid tone-purple b-photo-main" onClick={pickPhoto}>
              <ImageIcon size={30} weight="fill" /> {t('scan.photoPick')}
            </button>
          </div>
        )}
        {camera === 'starting' && <div className="b-camera-wait">{t('scan.starting')}</div>}
        {(camera === 'live' || camera === 'starting') && (
          <div className="b-corners" ref={corners} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        aria-label={t('scan.photoPick')}
        onChange={(event) => void readPhoto(event.target.files?.[0])}
      />
      {photo !== 'idle' && (
        <div className={`b-photo-state ${photo}`} role={photo === 'failed' ? 'alert' : 'status'}>
          {photo === 'reading' ? (
            <>
              <span className="b-spinner" aria-hidden="true" /> {t('scan.photoReading')}
            </>
          ) : (
            t('scan.photoFailed')
          )}
        </div>
      )}
      <div className="b-scan-tools">
        {(camera === 'live' || camera === 'starting') && (
          <button className="b-tool" onClick={pickPhoto}>
            <ImageIcon size={24} />
            <span>{t('scan.photo')}</span>
          </button>
        )}
        {torchReady && (
          <button
            className={`b-tool ${torch ? 'on' : ''}`}
            aria-pressed={torch}
            onClick={() => void toggleTorch()}
          >
            <Flashlight size={24} weight={torch ? 'fill' : 'regular'} />
            <span>{t('scan.light')}</span>
          </button>
        )}
        <button className="b-tool" onClick={() => setSheet('type')}>
          <Keyboard size={24} />
          <span>{t('scan.type')}</span>
        </button>
        {options.length > 0 && (
          <button className="b-tool" onClick={() => setSheet('list')}>
            <ListBullets size={24} />
            <span>{t('scan.list')}</span>
          </button>
        )}
      </div>
      {sheet === 'type' && (
        <Sheet title={t('scan.type')} onClose={() => setSheet(null)}>
          <form
            className="b-type-form"
            onSubmit={(event) => {
              event.preventDefault();
              const code = typed.trim();
              if (!code) return;
              recent.current = { code: '', at: 0 };
              deliver(code);
              setTyped('');
              setSheet(null);
            }}
          >
            <label className="b-field">
              <span>{t('scan.codeLabel')}</span>
              <input
                autoFocus
                value={typed}
                onChange={(event) => setTyped(event.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button className="b-big solid tone-green" type="submit" disabled={!typed.trim()}>
              {t('scan.add')}
            </button>
          </form>
        </Sheet>
      )}
      {sheet === 'list' && (
        <Sheet title={t('scan.list')} onClose={() => setSheet(null)}>
          <div className="b-pick-list">
            {options.map((option) => (
              <button
                key={option.code}
                className="b-pick"
                onClick={() => {
                  recent.current = { code: '', at: 0 };
                  deliver(option.code);
                }}
              >
                <strong>{option.label}</strong>
                {option.note && <small>{option.note}</small>}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
