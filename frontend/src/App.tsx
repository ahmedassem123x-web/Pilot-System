// Pilot System v3.1 — Sprint 3 (PB-15, PB-21). ONE lightweight,
// staff-only operations panel.
//
// WHAT THIS PANEL DOES: lifecycle view, contract/evidence review,
// payment-evidence review, verification request + manual
// communication record, institution confirmation + deposit reference
// record, manual settlement summary, settlement/refund outcome AFTER
// external confirmation, dispute/exception follow-up, audit view,
// user approve/suspend, Sold-as-Seen handover recording, templates
// and messages (dry-run labelled).
//
// WHAT THIS PANEL NEVER OFFERS (and no endpoint behind it offers
// either — see the backend forbidden-endpoints spec): it never moves
// or executes money, never confirms funding without institution
// confirmation, never overrides an institution outcome, never creates
// a financial account, never changes a beneficiary from a message,
// never imposes acceptance, never closes on behalf of a buyer, and
// never amends a contract after shipping. If a button for such an
// action appears here, it is a defect.
//
// BACKEND CONNECTION: pass apiBaseUrl (Vite env VITE_API_BASE_URL)
// and authToken to actually record. Without a base URL, forms show a
// "backend not connected" notice and SEND NOTHING — they never fake
// a success. Transaction amounts shown here are DESCRIPTIVE ONLY.
import { useState } from 'react';
import type { FormEvent } from 'react';
import Inbox from './Inbox';

export interface PanelMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  templateName: string | null;
  localApproval: string | null;
  metaApproval: string | null;
  rejectionReason: string | null;
  status: string;
  isDryRun: boolean;
}

export interface PanelTemplate {
  name: string;
  localApproval: string;
  metaApproval: string;
  rejectionReason: string | null;
}

export interface PanelTransaction {
  id: string;
  state: string;
  amount: number;
  currency: string;
  productDescription: string;
  quantity: number;
  deliveryPoint: string;
  contractVersions: Array<{ versionNumber: number; contentHash: string }>;
  evidences: Array<{
    channel: string;
    senderName: string;
    beneficiaryNameAsShown: string | null;
    amount: number;
    currency: string;
    externalPaymentReference: string;
    status: string;
  }>;
  coordination: Array<{
    contactMethod: string;
    institutionResponse: string | null;
    depositReference: string | null;
    settlementReference: string | null;
    institutionConfirmed: boolean;
  }>;
  deliveryEvents: Array<{ eventType: string; note: string | null }>;
  disputes: Array<{
    reason: string;
    status: string;
    resolution: string | null;
    resolutionOutcome: string | null;
  }>;
  settlementSummaries: Array<{
    id: string;
    depositReference: string;
    settlementReference: string;
    amount: number;
    currency: string;
    beneficiaryName: string;
  }>;
  audit: Array<{
    action: string;
    previousState: string | null;
    newState: string | null;
    actorRole: string;
  }>;
  messages: PanelMessage[];
  templates: PanelTemplate[];
  users: Array<{ id: string; whatsappNumber: string; status: string }>;
}

export interface OperationsPanelProps {
  initialTransaction?: PanelTransaction | null;
  apiBaseUrl?: string;
  authToken?: string;
}

const STATES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACCEPTED',
  'AWAITING_FUNDING_CONFIRMATION',
  'FUNDED_CONFIRMED',
  'IN_FULFILMENT',
  'DELIVERED',
  'RECEIPT_CONFIRMED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'DISPUTED',
  'REFUND_PENDING',
  'REFUNDED',
  'COMPLETED',
  'CANCELLED',
];

const TABS = [
  'Lifecycle',
  'Evidence',
  'Verification',
  'Institution',
  'Settlement',
  'Disputes',
  'Handover',
  'Inbox',
  'Messages',
  'Audit',
  'Users',
] as const;

type Tab = (typeof TABS)[number];

// Sold-as-Seen handover, exact sequence (CORE PROMPT §9). Step 4 is
// the product-absent exception: state stays DELIVERED, and no
// accept/reject is available until staff resolve it and a real
// handover occurs.
const HANDOVER_STEPS = [
  'Seller confirms the product has arrived at the agreed delivery point.',
  'System sends a readiness notification to the buyer.',
  'Record BUYER_ARRIVED_AT_HANDOVER when the buyer actually arrives.',
  'If the buyer arrives and the product is NOT there: record an operational exception, notify operations staff, and do NOT treat the product as received or accepted. State stays DELIVERED; no accept or reject until the exception is resolved and a real handover occurs.',
  'Record HANDOVER_INSPECTION_COMPLETED after inspection.',
  'Buyer EXPLICITLY chooses: ACCEPT or REJECT.',
];

export default function App(props: OperationsPanelProps) {
  const [tab, setTab] = useState<Tab>('Lifecycle');
  const [notice, setNotice] = useState<string>('');
  const [depositReference, setDepositReference] = useState('');
  const [institutionConfirmed, setInstitutionConfirmed] = useState(false);
  const [outcomeReference, setOutcomeReference] = useState('');
  const [outcomeDate, setOutcomeDate] = useState('');
  const [outcomeDocument, setOutcomeDocument] = useState('');

  const tx = props.initialTransaction ?? null;
  const base = props.apiBaseUrl ?? '';

  async function post(path: string, body: Record<string, unknown>): Promise<void> {
    if (!base) {
      setNotice(
        'Backend not connected — configure VITE_API_BASE_URL. Nothing was sent.',
      );
      return;
    }
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(props.authToken
            ? { Authorization: `Bearer ${props.authToken}` }
            : {}),
        },
        body: JSON.stringify(body),
      });
      setNotice(
        res.ok
          ? 'Recorded on the backend.'
          : `Backend refused the record (HTTP ${res.status}). Nothing was assumed.`,
      );
    } catch {
      setNotice('Backend request failed. Nothing was assumed.');
    }
  }

  function onSubmit(
    path: string,
    map: (data: FormData) => Record<string, unknown>,
  ): (event: FormEvent<HTMLFormElement>) => void {
    return (event) => {
      event.preventDefault();
      void post(path, map(new FormData(event.currentTarget)));
    };
  }

  return (
    <main>
      <h1>Pilot System v3.1 — Operations panel (staff only)</h1>
      <p>
        Money stays with the external financial institution. This panel
        records and reviews only — it never executes a transfer,
        settlement, or refund.
      </p>
      <nav aria-label="Operations sections">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={tab === name}
            onClick={() => {
              setTab(name);
              setNotice('');
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      {notice ? <p role="status">{notice}</p> : null}
      {!tx ? (
        <p>
          No transaction loaded. Connect the panel to the backend
          (VITE_API_BASE_URL) and open a transaction to work it.
        </p>
      ) : (
        <section>
          {tab === 'Lifecycle' && (
            <div>
              <h2>Transaction lifecycle</h2>
              <p>
                Transaction {tx.id} — current state: {tx.state}
              </p>
              <p>
                Amount (descriptive only): {tx.amount} {tx.currency} —{' '}
                {tx.productDescription} × {tx.quantity} — delivery point:{' '}
                {tx.deliveryPoint}
              </p>
              <ol>
                {STATES.map((state) => (
                  <li key={state}>
                    {state}
                    {state === tx.state ? ' (current)' : ''}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {tab === 'Evidence' && (
            <div>
              <h2>Contract and evidence review</h2>
              <h3>Contract versions (SHA-256 fingerprint, never overwritten)</h3>
              <ul>
                {tx.contractVersions.map((version) => (
                  <li key={version.versionNumber}>
                    Version {version.versionNumber}: {version.contentHash}
                  </li>
                ))}
              </ul>
              <h3>Payment evidence</h3>
              <p>
                Evidence is recorded ONLY as Payment Evidence Submitted.
                It never counts as funding confirmation and never
                permits shipping.
              </p>
              <ul>
                {tx.evidences.map((evidence, index) => (
                  <li key={index}>
                    {evidence.channel} — {evidence.senderName} —{' '}
                    {evidence.amount} {evidence.currency} — external
                    payment reference {evidence.externalPaymentReference} —
                    status: {evidence.status}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'Verification' && (
            <div>
              <h2>Verification request and manual communication record</h2>
              <p>
                Manual path, in order: review the evidence, contact the
                institution manually, send the information it accepts,
                request verification, record the response and reference.
              </p>
              <form
                onSubmit={onSubmit(
                  `/api/transactions/${tx.id}/coordination`,
                  (data) => ({
                    contactMethod: String(data.get('contactMethod') ?? ''),
                    messageSent: String(data.get('messageSent') ?? ''),
                  }),
                )}
              >
                <label>
                  Contact method
                  <input name="contactMethod" required />
                </label>
                <label>
                  Message sent to the institution
                  <textarea name="messageSent" />
                </label>
                <button type="submit">Record verification request</button>
              </form>
              <ul>
                {tx.coordination.map((record, index) => (
                  <li key={index}>
                    {record.contactMethod} — response:{' '}
                    {record.institutionResponse ?? 'awaited'} — deposit
                    reference: {record.depositReference ?? 'none yet'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'Institution' && (
            <div>
              <h2>Institution confirmation and deposit reference record</h2>
              <p>
                Funding confirmation requires BOTH: the institution has
                confirmed, AND a Financial Institution Deposit Reference
                is recorded. Either missing means no confirmation.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void post(`/api/transactions/${tx.id}/coordination`, {
                    contactMethod: 'manual institution confirmation',
                    depositReference,
                    institutionConfirmed,
                  });
                }}
              >
                <label>
                  Financial Institution Deposit Reference
                  <input
                    value={depositReference}
                    onChange={(event) => setDepositReference(event.target.value)}
                    required
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={institutionConfirmed}
                    onChange={(event) =>
                      setInstitutionConfirmed(event.target.checked)
                    }
                  />
                  Institution confirmed this deposit
                </label>
                <button
                  type="submit"
                  disabled={!depositReference || !institutionConfirmed}
                >
                  Record institution confirmation
                </button>
              </form>
            </div>
          )}
          {tab === 'Settlement' && (
            <div>
              <h2>Manual settlement summary and outcome</h2>
              <p>
                The summary is prepared manually by staff. Settlement or
                refund is recorded as executed ONLY after institution
                confirmation, with its settlement/refund reference.
              </p>
              <form
                onSubmit={onSubmit(
                  `/api/transactions/${tx.id}/transition`,
                  (data) => ({
                    to: 'SETTLEMENT_PENDING',
                    settlementSummary: {
                      deposit_reference: String(data.get('depositReference') ?? ''),
                      amount: Number(data.get('amount') ?? 0),
                      currency: String(data.get('currency') ?? ''),
                      beneficiary_name: String(data.get('beneficiaryName') ?? ''),
                      delivery_proof_or_dispute_outcome: String(
                        data.get('deliveryProof') ?? '',
                      ),
                    },
                  }),
                )}
              >
                <label>
                  Deposit reference
                  <input name="depositReference" required />
                </label>
                <label>
                  Amount
                  <input name="amount" type="number" required />
                </label>
                <label>
                  Currency
                  <input name="currency" required />
                </label>
                <label>
                  Beneficiary name
                  <input name="beneficiaryName" required />
                </label>
                <label>
                  Delivery proof or dispute outcome
                  <input name="deliveryProof" required />
                </label>
                <button type="submit">Prepare settlement summary</button>
              </form>
              <h3>Settlement or refund outcome after external confirmation</h3>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const summary = tx.settlementSummaries[0];
                  if (!summary) {
                    setNotice('Prepare a settlement summary first.');
                    return;
                  }
                  void post(`/api/transactions/${tx.id}/settlement-confirmation`, {
                    settlementSummaryId: summary.id,
                    settlementReference: outcomeReference,
                    confirmationAt: outcomeDate,
                  });
                }}
              >
                <label>
                  Settlement or refund reference
                  <input
                    value={outcomeReference}
                    onChange={(event) => setOutcomeReference(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Execution date
                  <input
                    type="date"
                    value={outcomeDate}
                    onChange={(event) => setOutcomeDate(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Confirmation document or notice
                  <input
                    value={outcomeDocument}
                    onChange={(event) => setOutcomeDocument(event.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  disabled={!outcomeReference || !outcomeDate || !outcomeDocument}
                >
                  Record outcome after external confirmation
                </button>
              </form>
              <ul>
                {tx.settlementSummaries.map((summary, index) => (
                  <li key={index}>
                    Deposit {summary.depositReference} — settlement{' '}
                    {summary.settlementReference || 'awaited'} —{' '}
                    {summary.amount} {summary.currency} — beneficiary{' '}
                    {summary.beneficiaryName}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'Disputes' && (
            <div>
              <h2>Dispute and exception follow-up</h2>
              <p>
                An open dispute freezes closure and settlement. Only a
                human resolves it; resolution selects the next allowed
                step, and execution still requires institution
                confirmation.
              </p>
              <ul>
                {tx.disputes.map((dispute, index) => (
                  <li key={index}>
                    {dispute.reason} — status: {dispute.status} — outcome:{' '}
                    {dispute.resolutionOutcome ?? 'unresolved'} —{' '}
                    {dispute.resolution ?? ''}
                  </li>
                ))}
              </ul>
              <form
                onSubmit={onSubmit(
                  `/api/transactions/${tx.id}/dispute-resolution`,
                  (data) => ({
                    outcome: String(data.get('outcome') ?? ''),
                    resolution: String(data.get('resolution') ?? ''),
                  }),
                )}
              >
                <label>
                  Resolution outcome
                  <select name="outcome" required defaultValue="">
                    <option value="" disabled>
                      Choose an outcome
                    </option>
                    <option value="PROCEED">Proceed</option>
                    <option value="REFUND">Refund</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </label>
                <label>
                  Resolution text
                  <textarea name="resolution" required />
                </label>
                <button type="submit">Record human resolution</button>
              </form>
            </div>
          )}
          {tab === 'Handover' && (
            <div>
              <h2>Sold as Seen handover — final acceptance at first actual handover</h2>
              <p>
                Acceptance happens only by the buyer&apos;s explicit
                choice at handover, after actual inspection. Silence or
                elapsed time never counts as acceptance, and no
                scheduled step accepts on the buyer&apos;s behalf.
              </p>
              <ol>
                {HANDOVER_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <h3>Recorded handover events</h3>
              <ul>
                {tx.deliveryEvents.map((event, index) => (
                  <li key={index}>
                    {event.eventType}
                    {event.note ? ` — ${event.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'Inbox' && (
            <div>
              <Inbox
                layout="desktop"
                apiBaseUrl={base || undefined}
                authToken={props.authToken}
                conversations={[
                  {
                    id: tx.id,
                    transactionId: tx.id,
                    transactionState: tx.state,
                    channel: 'whatsapp',
                    assignedTo: null,
                    tags: [],
                    triage: 'open',
                    notes: [],
                    messages: tx.messages.map((message) => ({
                      id: message.id,
                      direction: message.direction,
                      text: null,
                      templateName: message.templateName,
                      mediaKind: null,
                      mediaLabel: null,
                      status: message.status as
                        | 'QUEUED'
                        | 'SENT'
                        | 'DELIVERED'
                        | 'READ'
                        | 'FAILED',
                      isDryRun: message.isDryRun,
                      date: '',
                    })),
                  },
                ]}
              />
            </div>
          )}
          {tab === 'Messages' && (
            <div>
              <h2>Templates and messages</h2>
              <p>
                Local approval and Meta approval are shown separately.
                A locally-approved but Meta-rejected template is
                un-sendable, and its rejection reason is shown.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Local approval</th>
                    <th>Meta approval</th>
                    <th>Sendable</th>
                    <th>Rejection reason</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.templates.map((template) => (
                    <tr key={template.name}>
                      <td>{template.name}</td>
                      <td>{template.localApproval}</td>
                      <td>{template.metaApproval}</td>
                      <td>
                        {template.localApproval === 'APPROVED' &&
                        template.metaApproval === 'APPROVED'
                          ? 'Yes'
                          : 'Un-sendable'}
                      </td>
                      <td>{template.rejectionReason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Messages (dry-run rows are labelled dry-run)</h3>
              <ul>
                {tx.messages.map((message) => (
                  <li key={message.id}>
                    {message.direction} — {message.status}
                    {message.isDryRun ? ' — dry-run' : ''} — template:{' '}
                    {message.templateName ?? 'free text'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'Audit' && (
            <div>
              <h2>Audit view (append-only)</h2>
              <p>
                This view has no edit or delete action. Every state
                change, evidence submission, coordination record, and
                rejected attempt is recorded here.
              </p>
              <ul>
                {tx.audit.map((event, index) => (
                  <li key={index}>
                    {event.action} — {event.previousState ?? '—'} →{' '}
                    {event.newState ?? '—'} — role: {event.actorRole}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'Users' && (
            <div>
              <h2>User approve and suspend</h2>
              <ul>
                {tx.users.map((user) => (
                  <li key={user.id}>
                    {user.whatsappNumber} — status: {user.status}{' '}
                    <button
                      type="button"
                      onClick={() =>
                        void post(`/api/users/${user.id}/approve`, {})
                      }
                    >
                      Approve user
                    </button>{' '}
                    <button
                      type="button"
                      onClick={() =>
                        void post(`/api/users/${user.id}/suspend`, {})
                      }
                    >
                      Suspend user
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
