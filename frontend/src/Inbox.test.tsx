// Pilot System v3.1 — Sprint 4 tests for the WhatsApp inbox
// triptych (PB-13). Fixture data only, never real data. No backend
// is contacted: without apiBaseUrl the composer sends nothing and
// assignment/tags/notes stay local to the view (labelled as such).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
import Inbox from './Inbox';
import type { InboxConversation } from './Inbox';

const conversations: InboxConversation[] = [
  {
    id: 'conv-linked-1',
    transactionId: 'tx-inbox-1',
    transactionState: 'SETTLEMENT_PENDING',
    channel: 'whatsapp',
    assignedTo: 'agent-ops',
    tags: ['funding-question'],
    triage: 'attention',
    notes: [{ id: 'note-1', text: 'Called buyer, awaiting receipt photo', author: 'agent-ops' }],
    messages: [
      {
        id: 'm1', direction: 'INBOUND', text: 'Where is my order?', templateName: null,
        mediaKind: null, mediaLabel: null, status: 'READ', isDryRun: false, date: '2026-11-01',
      },
      {
        id: 'm2', direction: 'OUTBOUND', text: null, templateName: 'handover_readiness',
        mediaKind: null, mediaLabel: null, status: 'DELIVERED', isDryRun: false, date: '2026-11-01',
      },
      {
        id: 'm3', direction: 'INBOUND', text: null, templateName: null,
        mediaKind: 'image', mediaLabel: 'receipt.jpg', status: 'READ', isDryRun: false, date: '2026-11-02',
      },
      {
        id: 'm4', direction: 'OUTBOUND', text: 'Draft reply preview', templateName: null,
        mediaKind: null, mediaLabel: null, status: 'QUEUED', isDryRun: true, date: '2026-11-02',
      },
      {
        id: 'm5', direction: 'OUTBOUND', text: 'Delivery update', templateName: null,
        mediaKind: null, mediaLabel: null, status: 'FAILED', isDryRun: false, date: '2026-11-02',
      },
    ],
  },
  {
    id: 'conv-unlinked-1',
    transactionId: null,
    transactionState: null,
    channel: 'whatsapp',
    assignedTo: null,
    tags: [],
    triage: 'open',
    notes: [],
    messages: [
      {
        id: 'm9', direction: 'INBOUND', text: 'Hello, I have a question', templateName: null,
        mediaKind: null, mediaLabel: null, status: 'READ', isDryRun: false, date: '2026-11-02',
      },
    ],
  },
];

describe('inbox triptych (Sprint 4, PB-13)', () => {
  it('desktop shows list, chat, and details at once with linked contract and state', () => {
    render(<Inbox conversations={conversations} layout="desktop" />);
    expect(screen.getByLabelText('Conversation list')).not.toBeNull();
    expect(screen.getByLabelText('Chat')).not.toBeNull();
    expect(screen.getByLabelText('Details')).not.toBeNull();
    expect(screen.getByText(/Linked contract: tx-inbox-1/)).not.toBeNull();
    expect(screen.getByText(/Transaction state: SETTLEMENT_PENDING/)).not.toBeNull();
  });

  it('search filters conversations, and triage chips filter by triage', () => {
    render(<Inbox conversations={conversations} layout="desktop" />);
    const search = screen.getByLabelText(/Search conversations/);
    fireEvent.change(search, { target: { value: 'unlinked' } });
    expect(screen.queryByText(/conv-linked-1 —/)).toBeNull();
    expect(screen.getByText(/conv-unlinked-1 —/)).not.toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Triage: attention' }));
    expect(screen.queryByText(/conv-unlinked-1 —/)).toBeNull();
    expect(screen.getByText(/conv-linked-1 —/)).not.toBeNull();
  });

  it('renders date separators, ticks for every status, dry-run labels, template buttons, and media bubbles', () => {
    render(<Inbox conversations={conversations} layout="desktop" />);
    expect(screen.getByText(/— 2026-11-01 —/)).not.toBeNull();
    expect(screen.getByText(/— 2026-11-02 —/)).not.toBeNull();
    expect(screen.getAllByText('✓✓ read').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('✓✓ delivered')).not.toBeNull();
    expect(screen.getByText('failed')).not.toBeNull();
    expect(screen.getAllByText('dry-run').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'handover_readiness' })).not.toBeNull();
    expect(screen.getByText(/Media: image — receipt.jpg/)).not.toBeNull();
  });

  it('reply sets a quote shown above the single composer', () => {
    render(<Inbox conversations={conversations} layout="desktop" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Reply to this message' })[0]);
    expect(screen.getByText(/Quoting: Where is my order\?/)).not.toBeNull();
    expect(screen.getAllByLabelText('Message')).toHaveLength(1);
  });

  it('internal notes render as centred system notices marked never sent', () => {
    const { container } = render(<Inbox conversations={conversations} layout="desktop" />);
    const note = screen.getByText(/Internal note — never sent: Called buyer/);
    expect(note).not.toBeNull();
    expect((note as HTMLElement).style.textAlign).toBe('center');
    expect(container.textContent ?? '').toContain('Internal notes — never sent');
  });

  it('details assignment and tags update the conversation locally and say so without a backend', () => {
    render(<Inbox conversations={conversations} layout="desktop" />);
    fireEvent.change(screen.getByLabelText('Assign to agent'), { target: { value: 'agent-two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign conversation' }));
    expect(screen.getByText(/Assigned agent: agent-two/)).not.toBeNull();
    expect(screen.getByText(/local to this view only/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Add tag'), { target: { value: 'urgent-review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    // The tag appears both as a filter option and in the details list.
    expect(screen.getAllByText('urgent-review').length).toBeGreaterThanOrEqual(2);
  });

  it('phone layout walks list -> chat -> drawer with back buttons', () => {
    render(<Inbox conversations={conversations} layout="phone" />);
    expect(screen.getByLabelText('Conversation list')).not.toBeNull();
    expect(screen.queryByLabelText('Chat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /conv-linked-1 —/ }));
    expect(screen.getByLabelText('Chat')).not.toBeNull();
    expect(screen.queryByLabelText('Details')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
    expect(screen.getByLabelText('Details')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));
    expect(screen.getByLabelText('Chat')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
    expect(screen.getByLabelText('Conversation list')).not.toBeNull();
  });

  it('composer without a backend shows the not-connected notice and sends nothing', () => {
    render(<Inbox conversations={conversations} layout="desktop" />);
    const box = screen.getByLabelText('Message');
    fireEvent.change(box, { target: { value: 'Hello from staff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getByText(/Backend not connected/)).not.toBeNull();
  });
});
