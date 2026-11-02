// Pilot System v3.1 — Sprint 3 smoke tests for the ONE staff-only
// operations panel. The panel renders from an explicit fixture passed
// as a prop (labelled here as a test fixture, never as real data).
// No backend is contacted by these tests: without apiBaseUrl, form
// submissions send nothing.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// This Vitest setup does not auto-clean the DOM between tests, so
// unmount explicitly: otherwise nav buttons from earlier renders
// make role queries ambiguous.
afterEach(() => {
  cleanup();
});
import App from './App';
import type { PanelTransaction } from './App';

const fixture: PanelTransaction = {
  id: 'tx-fixture-1',
  state: 'DELIVERED',
  amount: 1200,
  currency: 'USD',
  productDescription: 'Test figurine set',
  quantity: 2,
  deliveryPoint: "Sana'a pickup point",
  contractVersions: [
    { versionNumber: 1, contentHash: 'a'.repeat(64) },
  ],
  evidences: [
    {
      channel: 'bank transfer',
      senderName: 'Buyer Name',
      beneficiaryNameAsShown: 'Seller Name',
      amount: 1200,
      currency: 'USD',
      externalPaymentReference: 'EXT-FIXTURE-1',
      status: 'PAYMENT_EVIDENCE_SUBMITTED',
    },
  ],
  coordination: [
    {
      contactMethod: 'manual phone call',
      institutionResponse: 'Deposit booked',
      depositReference: 'DEP-FIXTURE-1',
      settlementReference: null,
      institutionConfirmed: true,
    },
  ],
  deliveryEvents: [
    { eventType: 'SELLER_ARRIVED_AT_DELIVERY_POINT', note: 'arrived' },
  ],
  disputes: [],
  settlementSummaries: [],
  audit: [
    {
      action: 'PRODUCT_ARRIVED_AT_DELIVERY_POINT',
      previousState: 'IN_FULFILMENT',
      newState: 'DELIVERED',
      actorRole: 'STAFF',
    },
  ],
  messages: [
    {
      id: 'msg-1',
      direction: 'OUTBOUND',
      templateName: 'utility_ok',
      localApproval: 'APPROVED',
      metaApproval: 'APPROVED',
      rejectionReason: null,
      status: 'QUEUED',
      isDryRun: true,
    },
  ],
  templates: [
    {
      name: 'utility_blocked',
      localApproval: 'APPROVED',
      metaApproval: 'REJECTED',
      rejectionReason: 'Meta rejected: category mismatch',
    },
    {
      name: 'utility_ok',
      localApproval: 'APPROVED',
      metaApproval: 'APPROVED',
      rejectionReason: null,
    },
  ],
  users: [
    { id: 'user-1', whatsappNumber: '+967700000001', status: 'APPROVED' },
  ],
};

const FORBIDDEN_TEXTS = [
  'Move money',
  'Create wallet',
  'Override institution outcome',
  'Impose acceptance',
  'Close on behalf',
  'Amend after shipping',
  'Change beneficiary from WhatsApp',
];

const TABS = [
  'Lifecycle',
  'Evidence',
  'Verification',
  'Institution',
  'Settlement',
  'Disputes',
  'Handover',
  'Messages',
  'Audit',
  'Users',
];

describe('operations panel (Sprint 3)', () => {
  it('renders the staff-only panel heading and the empty state without a transaction', () => {
    render(<App />);
    expect(
      screen.getByText('Pilot System v3.1 — Operations panel (staff only)'),
    ).not.toBeNull();
    expect(screen.getByText(/No transaction loaded/)).not.toBeNull();
  });

  it('renders the lifecycle with the current state marked, and evidence as submitted-only', () => {
    render(<App initialTransaction={fixture} />);
    expect(screen.getByText(/current state: DELIVERED/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Evidence' }));
    expect(screen.getByText(/Payment Evidence Submitted/)).not.toBeNull();
    expect(
      screen.getByText(/never counts as funding confirmation/),
    ).not.toBeNull();
  });

  it('shows the Sold-as-Seen handover in the exact 6-step order, including the product-absent exception', () => {
    const { container } = render(<App initialTransaction={fixture} />);
    fireEvent.click(screen.getByRole('button', { name: 'Handover' }));
    const steps = [...container.querySelectorAll('ol li')].map((li) =>
      (li.textContent ?? '').trim(),
    );
    expect(steps).toHaveLength(6);
    expect(steps[0]).toContain('Seller confirms the product has arrived');
    expect(steps[1]).toContain('readiness notification');
    expect(steps[2]).toContain('BUYER_ARRIVED_AT_HANDOVER');
    expect(steps[3]).toContain('product is NOT there');
    expect(steps[3]).toContain('State stays DELIVERED');
    expect(steps[4]).toContain('HANDOVER_INSPECTION_COMPLETED');
    expect(steps[5]).toContain('EXPLICITLY chooses: ACCEPT or REJECT');
  });

  it('shows local and Meta template approval separately, with the Meta rejection reason and un-sendable state', () => {
    render(<App initialTransaction={fixture} />);
    fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
    expect(screen.getByText('Meta rejected: category mismatch')).not.toBeNull();
    expect(screen.getAllByText('Un-sendable').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/dry-run/).length).toBeGreaterThanOrEqual(2);
  });

  it('institution confirmation cannot be recorded without a reference and a confirmation check', () => {
    render(<App initialTransaction={fixture} />);
    fireEvent.click(screen.getByRole('button', { name: 'Institution' }));
    const button = screen.getByRole('button', {
      name: 'Record institution confirmation',
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('no forbidden action is offered on any tab', () => {
    render(<App initialTransaction={fixture} />);
    for (const tab of TABS) {
      fireEvent.click(screen.getByRole('button', { name: tab }));
      for (const forbidden of FORBIDDEN_TEXTS) {
        // Substring match (regex): a forbidden phrase hidden inside a
        // longer label must still fail this test.
        expect(
          screen.queryByText(new RegExp(forbidden, 'i')),
        ).toBeNull();
      }
    }
  });

  it('audit view states it is append-only with no edit or delete action', () => {
    render(<App initialTransaction={fixture} />);
    fireEvent.click(screen.getByRole('button', { name: 'Audit' }));
    expect(screen.getByText(/no edit or delete action/)).not.toBeNull();
    expect(
      screen.getByText(/PRODUCT_ARRIVED_AT_DELIVERY_POINT/),
    ).not.toBeNull();
  });
});
