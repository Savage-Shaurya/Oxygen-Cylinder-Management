import { useState } from 'react';
import { ArrowRight, CheckCircle, PlayCircle } from '@phosphor-icons/react';
import type { AppState, User } from '../shared/types';
import { Modal, Button } from './components/UI';
import './DemoWalkthrough.css';

type View =
  | 'overview'
  | 'cylinders'
  | 'production'
  | 'orders'
  | 'customers'
  | 'suppliers'
  | 'billing'
  | 'safety'
  | 'reports'
  | 'settings';
const chapters: {
  title: string;
  view: View;
  role: string;
  story: string;
  actions: string[];
  proof: string;
}[] = [
  {
    title: 'One fleet. Every cylinder accounted for.',
    view: 'overview',
    role: 'Administrator',
    story: 'Start with the morning question: what can we supply today, and what needs attention?',
    actions: [
      'Compare plant, vehicle, customer and supplier positions.',
      'Open a cylinder and show its owner, custodian, test due date and movement history.',
    ],
    proof:
      'Ownership and physical location are separate. A full cylinder is not automatically safe to dispatch.',
  },
  {
    title: 'Prepare and release oxygen',
    view: 'production',
    role: 'Operations → Quality',
    story: 'Follow an empty, serviceable cylinder through filling and independent quality release.',
    actions: [
      'Create a fill batch using eligible empty stock, or open an awaiting-release sample batch.',
      'Sign in as Quality to record certificate reference and release. The filling actor cannot release their own batch.',
    ],
    proof: 'Awaiting-release and expired-test cylinders are blocked from dispatch.',
  },
  {
    title: 'Receive purchased filled stock',
    view: 'suppliers',
    role: 'Operations → Quality',
    story: 'The business also buys filled cylinders and sends its own empties for supplier refill.',
    actions: [
      'Show the supplier ledger and send/receive refill actions.',
      'Receive purchased cylinders with serial, owner and test references. Receipt creates an awaiting-release batch.',
    ],
    proof: 'Purchasing filled stock never bypasses the quality gate.',
  },
  {
    title: 'Dispatch a hospital order',
    view: 'orders',
    role: 'Operations',
    story: 'Promise a quantity, then load the exact physical cylinders.',
    actions: [
      'Create a two-cylinder medical oxygen order for Demo North Care Hospital, Delhi, size B.',
      'Select two eligible cylinder tags, assign Driver and enter a demonstration vehicle. Open the saved manifest.',
    ],
    proof:
      'Wrong branch, gas, size, custody, safety status or release state is rejected before stock moves.',
  },
  {
    title: 'Deliver exactly what was accepted',
    view: 'orders',
    role: 'Driver / Operations',
    story: 'The hospital accepts one cylinder. The second comes back on the vehicle.',
    actions: [
      'Record acceptance for one tag with a sample recipient name.',
      'Unload the remaining tag at the plant. Show the original quantity, accepted unit and unloaded unit.',
    ],
    proof:
      'A short delivery preserves the original manifest; the unused cylinder enters inspection. Driver offline evidence requires explicit reconciliation.',
  },
  {
    title: 'Bring the cylinder home',
    view: 'customers',
    role: 'Driver → Operations → Quality',
    story: 'Separate collection on the vehicle from physical receipt at the warehouse.',
    actions: [
      'Collect a customer-held cylinder on an assigned route, then record warehouse receipt.',
      'Show the closed custody interval and inspection hold. Use discrepancy intake for an unidentified return.',
    ],
    proof: 'An unknown or wrong-customer return cannot silently reduce another customer’s balance.',
  },
  {
    title: 'Reconcile the money',
    view: 'billing',
    role: 'Finance',
    story: 'Bill the accepted quantity, reconcile rental periods and keep deposits separate.',
    actions: [
      'Issue a gas invoice for the delivered quantity and record a sample payment reference.',
      'Show rental free days, the deposit ledger and full credit-note controls. Print a demonstration invoice.',
    ],
    proof:
      'Money uses integer paise. Duplicate non-cash references, excess receipts and excess deposit refunds are rejected.',
  },
  {
    title: 'Prove traceability under pressure',
    view: 'safety',
    role: 'Quality → Auditor',
    story: 'Finish with a recall: find affected cylinders even after they leave the plant.',
    actions: [
      'Recall a released sample batch with a demonstration reason; inspect affected cylinder holds and recovery exceptions.',
      'Open Reports & audit to review the actor, time and recorded changes.',
    ],
    proof:
      'A recall holds affected stock across custody locations. This is operational software, not a physical safety certificate.',
  },
];
export default function DemoWalkthrough({
  state,
  user,
  onNavigate,
}: {
  state: AppState;
  user: User;
  onNavigate: (view: View) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chapter, setChapter] = useState(0);
  const [shown, setShown] = useState<number[]>([]);
  const step = chapters[chapter];
  const canOpen = step.view !== 'billing' || ['admin', 'finance', 'auditor'].includes(user.role);
  return (
    <>
      <button className="demo-tour-trigger" onClick={() => setOpen(true)}>
        <PlayCircle size={18} /> Demo walkthrough
      </button>
      {open && (
        <Modal
          title="A cylinder’s complete journey"
          subtitle="Presenter guide · 15–20 minutes · synthetic records only"
          onClose={() => setOpen(false)}
          width="wide"
        >
          <div className="demo-tour-body">
            <div className="demo-tour-intro">
              <span>{state.cylinders.length} sample cylinders</span>
              <span>{state.branches.length} branches</span>
              <span>
                {shown.length} / {chapters.length} chapters presented
              </span>
            </div>
            <div className="demo-tour-layout">
              <nav aria-label="Walkthrough chapters">
                {chapters.map((item, index) => (
                  <button
                    key={item.title}
                    aria-current={chapter === index ? 'step' : undefined}
                    onClick={() => setChapter(index)}
                  >
                    <span>
                      {shown.includes(index) ? (
                        <CheckCircle size={19} />
                      ) : (
                        String(index + 1).padStart(2, '0')
                      )}
                    </span>
                    {item.title}
                  </button>
                ))}
              </nav>
              <article className="demo-tour-chapter">
                <div className="eyebrow">
                  Chapter {chapter + 1} · {step.role}
                </div>
                <h3>{step.title}</h3>
                <p>{step.story}</p>
                <ol>
                  {step.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ol>
                <aside>
                  <strong>What to demonstrate</strong>
                  <p>{step.proof}</p>
                </aside>
                <div className="demo-tour-actions">
                  <Button
                    disabled={!canOpen}
                    onClick={() => {
                      onNavigate(step.view);
                      setOpen(false);
                    }}
                  >
                    Open workspace <ArrowRight size={16} />
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShown((prior) => (prior.includes(chapter) ? prior : [...prior, chapter]));
                      setChapter(Math.min(chapter + 1, chapters.length - 1));
                    }}
                  >
                    Mark presented
                  </Button>
                </div>
                {!canOpen && (
                  <p className="muted">Sign in as Finance or Administrator for this chapter.</p>
                )}
                <p className="demo-tour-note">
                  This guide navigates real screens. “Mark presented” tracks your presentation only;
                  it does not perform or certify a business action.
                </p>
              </article>
            </div>
            <div className="demo-tour-boundary">
              Connected in this demo: inventory, custody, quality, delivery, billing and audit.
              External accounting, WhatsApp, payments, official e-invoices and hardware integrations
              require setup and are not connected.
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
