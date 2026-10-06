import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Briefcase,
  CloudArrowUp,
  Drop,
  HandPalm,
  HandPointing,
  Hospital,
  List,
  QrCode,
  SealCheck,
  SignOut,
  SpeakerHigh,
  SpeakerSlash,
  Truck,
  Warehouse,
} from '@phosphor-icons/react';
import type { ActionResult, Bootstrap, Role } from '../../shared/types';
import { LANGS, setLang, t, useLang, type TextKey } from '../i18n';
import { Badge, BigButton, Dots, Sheet, type Tone } from './components';
import { setVoiceOn, speak, success, failure, tap, useVoiceOn } from './feedback';
import { driverOrders, pendingIds } from './model';
import { pointAt, preloadMotion, press, tilesIn } from './motion';
import { CylinderPic } from './pictures';
import { readSetting, writeSetting } from './storage';
import { useQueue } from './useQueue';
import CameBack from './jobs/CameBack';
import Check from './jobs/Check';
import Filled from './jobs/Filled';
import Give from './jobs/Give';
import LoadTruck from './jobs/LoadTruck';
import Look from './jobs/Look';
import MyTruck from './jobs/MyTruck';
import Problem from './jobs/Problem';
import TakeBack from './jobs/TakeBack';
import type { JobId, JobProps } from './jobs/shared';
import './basic.css';

export type AppMode = 'basic' | 'office';

/** Drivers only ever see Basic mode; office-only roles never do. */
export function modeFor(role: Role, chosen: AppMode | null): AppMode {
  if (role === 'driver') return 'basic';
  if (role === 'finance' || role === 'auditor') return 'office';
  if (chosen) return chosen;
  return role === 'operations' ? 'basic' : 'office';
}

export const canSwitchMode = (role: Role) => ['operations', 'quality', 'admin'].includes(role);
export const storedMode = (userId: string): AppMode | null => {
  const value = readSetting(`cylvero-mode:${userId}`);
  return value === 'basic' || value === 'office' ? value : null;
};
export const storeMode = (userId: string, mode: AppMode) =>
  writeSetting(`cylvero-mode:${userId}`, mode);

const jobs: Record<JobId, (props: JobProps) => ReactNode> = {
  give: Give,
  take: TakeBack,
  truck: MyTruck,
  look: Look,
  problem: Problem,
  back: CameBack,
  load: LoadTruck,
  fill: Filled,
  check: Check,
};

type TileSpec = { job: JobId; label: TextKey; tone: Tone; art: ReactNode; extra?: ReactNode };

export default function BasicApp({
  session,
  run,
  refresh,
  signOut,
  toOffice,
}: {
  session: Bootstrap;
  run: (type: string, payload: Record<string, unknown>) => Promise<ActionResult>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  toOffice?: () => void;
}) {
  const language = useLang();
  const voice = useVoiceOn();
  const [screen, setScreen] = useState<{ job: JobId; params?: Record<string, string> } | null>(
    null,
  );
  const [menu, setMenu] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [hint, setHint] = useState(false);
  const queue = useQueue(session.user, refresh);
  const { state, user } = session;

  useEffect(() => {
    preloadMotion();
  }, []);
  useEffect(() => {
    document.documentElement.lang = language ?? 'en';
    document.body.classList.add('basic-body');
    return () => document.body.classList.remove('basic-body');
  }, [language]);

  // The phone's back button returns to the home tiles.
  useEffect(() => {
    const back = () => setScreen(null);
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  function open(job: JobId, params?: Record<string, string>) {
    try {
      history.pushState({ basicJob: job }, '');
    } catch {
      /* History is optional. */
    }
    window.scrollTo?.(0, 0);
    setScreen({ job, params });
  }
  function home() {
    setScreen(null);
    try {
      if (history.state?.basicJob) history.back();
    } catch {
      /* History is optional. */
    }
    window.scrollTo?.(0, 0);
  }

  const header = (
    <header className="b-top">
      <div className="b-hello">
        <Badge name={user.name} size={46} />
        <div>
          <small>{t('hello', { name: '' }).replace(/[,،]\s*$/, '')}</small>
          <strong>{user.name}</strong>
        </div>
      </div>
      <div className="b-top-actions">
        {queue.pending + queue.conflicts > 0 && (
          <button
            className="b-cloud"
            disabled={queue.busy || !queue.online || !queue.pending}
            aria-label={`${t('offline.waiting', { n: queue.pending })}. ${t('offline.send')}`}
            onClick={async () => {
              try {
                const result = await queue.sync();
                const words = [
                  t('offline.sent', { n: result.accepted }),
                  result.conflicts ? t('offline.needsOffice', { n: result.conflicts }) : '',
                ].join(' ');
                if (result.conflicts) failure(words);
                else success(words);
              } catch {
                failure(t('error.offline'));
              }
            }}
          >
            <CloudArrowUp size={26} weight="fill" />
            <span>{queue.pending || queue.conflicts}</span>
          </button>
        )}
        {toOffice && (
          <button className="b-office" onClick={toOffice} aria-label={t('menu.office')}>
            <Briefcase size={22} weight="duotone" />
            <span>{t('menu.office')}</span>
          </button>
        )}
        <button className="b-round" aria-label={t('common.menu')} onClick={() => setMenu(true)}>
          <List size={28} weight="bold" />
        </button>
      </div>
    </header>
  );

  const menuSheet = menu && (
    <Sheet
      title={t('common.menu')}
      onClose={() => {
        setMenu(false);
        setConfirmExit(false);
      }}
    >
      <div className="b-menu">
        <button className="b-menu-row" onClick={() => setVoiceOn(!voice)}>
          {voice ? (
            <SpeakerHigh size={30} weight="fill" />
          ) : (
            <SpeakerSlash size={30} weight="fill" />
          )}
          <span>{t(voice ? 'menu.voiceOn' : 'menu.voiceOff')}</span>
          <span className={`b-switch ${voice ? 'on' : ''}`} aria-hidden="true" />
        </button>
        <div className="b-menu-langs" role="group" aria-label={t('menu.language')}>
          {LANGS.map((item) => (
            <button
              key={item.id}
              className={`b-lang-chip ${language === item.id ? 'on' : ''}`}
              aria-pressed={language === item.id}
              onClick={() => setLang(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <button
          className="b-menu-row"
          onClick={() => {
            setMenu(false);
            setScreen(null);
            setHint(true);
            speak(t('home.say'), true);
          }}
        >
          <HandPointing size={30} weight="duotone" />
          <span>{t('menu.howTo')}</span>
        </button>
        {toOffice && (
          <button className="b-menu-row" onClick={toOffice}>
            <Briefcase size={30} weight="duotone" />
            <span>{t('menu.office')}</span>
          </button>
        )}
        {confirmExit ? (
          <div className="b-confirm">
            <p>{t('menu.signOutSure')}</p>
            <div className="b-row">
              <BigButton tone="red" onClick={() => void signOut()}>
                <SignOut size={28} weight="bold" /> {t('menu.signOut')}
              </BigButton>
              <BigButton tone="teal" variant="soft" onClick={() => setConfirmExit(false)}>
                {t('common.back')}
              </BigButton>
            </div>
          </div>
        ) : (
          <button className="b-menu-row danger" onClick={() => setConfirmExit(true)}>
            <SignOut size={30} weight="bold" />
            <span>{t('menu.signOut')}</span>
          </button>
        )}
      </div>
    </Sheet>
  );

  if (!language)
    return (
      <div className="basic-app">
        {header}
        <LanguagePicker />
        {menuSheet}
      </div>
    );

  const Job = screen ? jobs[screen.job] : null;
  return (
    <div className="basic-app">
      {header}
      <main className="b-main">
        {Job && screen ? (
          <Job
            key={`${screen.job}:${JSON.stringify(screen.params ?? {})}`}
            state={state}
            user={user}
            users={session.users}
            run={run}
            home={home}
            open={open}
            params={screen.params}
          />
        ) : (
          <Home
            role={user.role}
            session={session}
            open={open}
            hint={hint}
            onHintDone={() => setHint(false)}
          />
        )}
      </main>
      {menuSheet}
    </div>
  );
}

function LanguagePicker() {
  useEffect(() => {
    // Both languages, because we do not know yet which one the person understands.
    speak(`${t('lang.say', {}, 'hi')} ${t('lang.say', {}, 'en')}`);
  }, []);
  return (
    <main className="b-main">
      <section className="b-lang" aria-label="भाषा / Language">
        <div className="b-lang-logo" aria-hidden="true">
          <CylinderPic look="full" size={84} />
        </div>
        <h1>भाषा चुनें · Choose language</h1>
        {LANGS.map((item) => (
          <button
            key={item.id}
            className="b-lang-button"
            lang={item.id}
            onClick={() => {
              tap();
              setLang(item.id);
              speak(t('home.say', {}, item.id), true);
            }}
          >
            <span>{item.name}</span>
            <SpeakerHigh size={28} weight="fill" aria-hidden="true" />
          </button>
        ))}
      </section>
    </main>
  );
}

function Home({
  role,
  session,
  open,
  hint,
  onHintDone,
}: {
  role: Role;
  session: Bootstrap;
  open: (job: JobId) => void;
  hint: boolean;
  onHintDone: () => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const hand = useRef<HTMLSpanElement>(null);
  const { state, user } = session;
  const [showHand, setShowHand] = useState(() => {
    const seen = Number(readSetting('cylvero-hint-seen') || 0);
    return seen < 3;
  });

  useEffect(() => {
    tilesIn(grid.current ? Array.from(grid.current.children) : []);
  }, []);
  useEffect(() => {
    if (hint) setShowHand(true);
  }, [hint]);
  useEffect(() => {
    if (!showHand) return;
    writeSetting('cylvero-hint-seen', String(Number(readSetting('cylvero-hint-seen') || 0) + 1));
    const animation = pointAt(hand.current);
    const timer = setTimeout(() => {
      setShowHand(false);
      onHintDone();
    }, 4200);
    return () => {
      animation.pause();
      clearTimeout(timer);
    };
  }, [showHand]);

  const toGive = driverOrders(state, user).reduce((sum, o) => sum + pendingIds(o).length, 0);
  const openOrders = state.orders.filter((o) => o.status === 'open').length;
  const tiles: TileSpec[] =
    role === 'driver'
      ? [
          {
            job: 'give',
            label: 'tile.give',
            tone: 'green',
            art: (
              <>
                <CylinderPic look="full" size={60} />
                <ArrowRight size={30} weight="bold" />
                <Hospital size={54} weight="duotone" />
              </>
            ),
            extra: toGive > 0 ? <Dots total={toGive} filled={0} max={8} /> : undefined,
          },
          {
            job: 'take',
            label: 'tile.takeBack',
            tone: 'blue',
            art: (
              <>
                <Hospital size={54} weight="duotone" />
                <ArrowRight size={30} weight="bold" />
                <CylinderPic look="empty" size={60} />
              </>
            ),
          },
          {
            job: 'truck',
            label: 'tile.myTruck',
            tone: 'orange',
            art: <Truck size={70} weight="duotone" />,
          },
          {
            job: 'look',
            label: 'tile.scan',
            tone: 'purple',
            art: <QrCode size={70} weight="duotone" />,
          },
        ]
      : role === 'quality'
        ? [
            {
              job: 'look',
              label: 'tile.scan',
              tone: 'purple',
              art: <QrCode size={70} weight="duotone" />,
            },
            {
              job: 'check',
              label: 'tile.check',
              tone: 'teal',
              art: <SealCheck size={70} weight="duotone" />,
            },
          ]
        : [
            {
              job: 'back',
              label: 'tile.cameBack',
              tone: 'blue',
              art: (
                <>
                  <Truck size={54} weight="duotone" />
                  <ArrowRight size={30} weight="bold" />
                  <Warehouse size={54} weight="duotone" />
                </>
              ),
            },
            {
              job: 'load',
              label: 'tile.loadTruck',
              tone: 'orange',
              art: (
                <>
                  <Warehouse size={54} weight="duotone" />
                  <ArrowRight size={30} weight="bold" />
                  <Truck size={54} weight="duotone" />
                </>
              ),
              extra:
                openOrders > 0 ? <span className="b-tile-count">{openOrders}</span> : undefined,
            },
            {
              job: 'look',
              label: 'tile.scan',
              tone: 'purple',
              art: <QrCode size={70} weight="duotone" />,
            },
            {
              job: 'fill',
              label: 'tile.filled',
              tone: 'green',
              art: (
                <>
                  <Drop size={44} weight="duotone" />
                  <ArrowRight size={26} weight="bold" />
                  <CylinderPic look="full" size={60} />
                </>
              ),
            },
          ];
  const showProblem = role === 'driver' || role === 'operations' || role === 'admin';

  return (
    <section className="b-home" aria-label={t('common.home')}>
      <div className="b-tiles" ref={grid}>
        {tiles.map((tile, index) => (
          <Tile key={tile.job} spec={tile} onOpen={() => open(tile.job)}>
            {index === 0 && showHand && (
              <span className="b-hand" ref={hand} aria-hidden="true">
                <HandPointing size={64} weight="fill" />
              </span>
            )}
          </Tile>
        ))}
      </div>
      {showProblem && (
        <button className="b-problem" onClick={() => open('problem')}>
          <HandPalm size={28} weight="fill" />
          {t('tile.problem')}
        </button>
      )}
    </section>
  );
}

function Tile({
  spec,
  onOpen,
  children,
}: {
  spec: TileSpec;
  onOpen: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      className={`b-tile tone-${spec.tone}`}
      onClick={() => {
        tap();
        press(ref.current);
        onOpen();
      }}
    >
      <span className="b-tile-art">{spec.art}</span>
      <span className="b-tile-label">{t(spec.label)}</span>
      {spec.extra && <span className="b-tile-extra">{spec.extra}</span>}
      {children}
    </button>
  );
}
