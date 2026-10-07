import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ClipboardText,
  CurrencyInr,
  Eye,
  EyeSlash,
  SealCheck,
  Truck,
  UserGear,
  Warehouse,
} from '@phosphor-icons/react';
import type { Role } from '../shared/types';
import { readSetting, writeSetting } from './basic/storage';
import { Button } from './components/UI';

const DEMO_PASSWORD = 'OxygenDemo!2026';
const LAST_EMAIL = 'cylvero-last-email';

// One big picture card per demo account, so anyone can sign in with one tap.
const demoCards: {
  role: Role;
  icon: typeof Truck;
  hindi: string;
  english: string;
  sees: string;
}[] = [
  { role: 'driver', icon: Truck, hindi: 'ड्राइवर', english: 'Driver', sees: 'Deliveries' },
  {
    role: 'operations',
    icon: Warehouse,
    hindi: 'गोदाम',
    english: 'Godown',
    sees: 'Load and return',
  },
  {
    role: 'quality',
    icon: SealCheck,
    hindi: 'जाँच',
    english: 'Quality',
    sees: 'Checks and release',
  },
  { role: 'admin', icon: UserGear, hindi: 'एडमिन', english: 'Admin', sees: 'Everything' },
  {
    role: 'finance',
    icon: CurrencyInr,
    hindi: 'हिसाब',
    english: 'Finance',
    sees: 'Bills and payments',
  },
  {
    role: 'auditor',
    icon: ClipboardText,
    hindi: 'ऑडिटर',
    english: 'Auditor',
    sees: 'Read-only reports',
  },
];

export default function LoginScreen({
  mode,
  onSubmit,
  error,
}: {
  mode: 'demo' | 'live';
  onSubmit: (email: string, password: string) => Promise<void>;
  error: string;
}) {
  // Members added in Settings, or a live workspace, sign in with a typed email.
  const [typed, setTyped] = useState(mode !== 'demo');
  const [email, setEmail] = useState(() => (mode === 'demo' ? '' : readSetting(LAST_EMAIL) || ''));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setTyped(mode !== 'demo');
  }, [mode]);

  async function submit(address: string, secret: string) {
    setBusy(address);
    try {
      // Only the email is remembered, on this phone, so the next shift starts with it filled in.
      if (mode !== 'demo') writeSetting(LAST_EMAIL, address.trim());
      await onSubmit(address, secret);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-panel">
        <div className="login-brand">
          <div className="brand-symbol">C</div>
          <span>Cylvero</span>
        </div>
        <div className="login-copy">
          <div className="eyebrow">Operations workspace</div>
          <h1>
            Every cylinder.
            <br />
            Accounted for.
          </h1>
          <p>
            One place to manage stock, dispatch, quality and billing with a clear record of each
            movement.
          </p>
        </div>
        <div className="login-footer">
          {mode === 'demo'
            ? 'Local demonstration · Synthetic data only'
            : 'Cylvero · Cylinder operations'}
        </div>
      </div>
      <div className="login-form-wrap">
        <div className="login-card">
          {mode === 'demo' && !typed ? (
            <>
              <div className="eyebrow">Demo · डेमो</div>
              <h2>
                <span lang="hi">आप कौन हैं?</span> Who are you?
              </h2>
              <p>Tap a picture to sign in. Each one shows what that person sees.</p>
              <div className="login-roles">
                {demoCards.map(({ role, icon: Icon, hindi, english, sees }) => (
                  <button
                    key={role}
                    type="button"
                    className={`login-role role-${role}`}
                    disabled={!!busy}
                    aria-label={`Sign in as ${english} (${role}@batra.demo)`}
                    onClick={() => void submit(`${role}@batra.demo`, DEMO_PASSWORD)}
                  >
                    <Icon size={40} weight="duotone" aria-hidden="true" />
                    <strong lang="hi">{hindi}</strong>
                    <span>{busy === `${role}@batra.demo` ? 'Signing in…' : english}</span>
                    <small>{sees}</small>
                  </button>
                ))}
              </div>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <button
                type="button"
                className="login-back"
                onClick={() => {
                  setTyped(true);
                  setEmail('');
                }}
              >
                Other account (type an email) →
              </button>
              <div className="demo-hint">
                <strong>Demo access</strong>
                <span>Password: {DEMO_PASSWORD}</span>
                <span>Accounts are role scoped. No live business data is used.</span>
              </div>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit(email, password);
              }}
            >
              <div className="eyebrow">Welcome back</div>
              <h2>Sign in to your workspace</h2>
              <p>Enter your assigned account credentials.</p>
              <label className="field">
                <span className="field-label">Email address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  inputMode="email"
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Password</span>
                <span className="password-wrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    autoFocus={!!email}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}
                  </button>
                </span>
              </label>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <Button type="submit" loading={!!busy} className="login-submit">
                Sign in <ArrowRight size={17} />
              </Button>
              {mode === 'demo' && (
                <button type="button" className="login-back" onClick={() => setTyped(false)}>
                  ← Back to demo pictures
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
