// Pilot System v3.1 — Sprint 4 (PB-13). WhatsApp inbox triptych:
// list | chat | details, full height, no cards inside the workspace.
//
// WHAT THIS IS: a staff-only view over the backend inbox read
// endpoints (GET /api/whatsapp/inbox, GET /api/whatsapp/messages,
// GET /api/whatsapp/templates). It never moves money, never confirms
// funding, never settles, never accepts, and never sends without the
// backend's window + template gates (the composer POSTs to
// /api/whatsapp/messages and reports a backend refusal as a refusal).
//
// INTERNAL NOTES are rendered as centred system notices inside the
// chat pane. They are never sent: the note form POSTs only to the
// inbox metadata endpoint (/api/whatsapp/inbox/:id/notes), which
// creates no MessageLog row, and without a backend base URL notes
// stay local to this view and are labelled as such.
//
// PHONE vs DESKTOP: layout="desktop" shows all three panes at once;
// layout="phone" shows list -> chat -> drawer, one pane at a time
// with back buttons. The panel passes layout="desktop" by default;
// a phone host passes layout="phone".
import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

export type InboxMessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type TriageValue = 'open' | 'attention' | 'resolved';

export interface InboxMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string | null;
  templateName: string | null;
  mediaKind: 'image' | 'document' | null;
  mediaLabel: string | null;
  status: InboxMessageStatus;
  isDryRun: boolean;
  /** YYYY-MM-DD for date separators; empty means no separator is drawn. */
  date: string;
}

export interface InboxNote {
  id: string;
  text: string;
  author: string;
}

export interface InboxConversation {
  id: string;
  transactionId: string | null;
  transactionState: string | null;
  channel: string;
  assignedTo: string | null;
  tags: string[];
  triage: TriageValue;
  notes: InboxNote[];
  messages: InboxMessage[];
}

export interface InboxProps {
  conversations: InboxConversation[];
  layout?: 'desktop' | 'phone';
  apiBaseUrl?: string;
  authToken?: string;
}

function messageTicks(status: InboxMessageStatus, isDryRun: boolean): string {
  if (isDryRun) return 'dry-run';
  switch (status) {
    case 'QUEUED':
      return 'sending…';
    case 'SENT':
      return '✓ sent';
    case 'DELIVERED':
      return '✓✓ delivered';
    case 'READ':
      return '✓✓ read';
    case 'FAILED':
      return 'failed';
    default:
      return status;
  }
}

type PhoneView = 'list' | 'chat' | 'details';

export default function Inbox(props: InboxProps) {
  const layout = props.layout ?? 'desktop';
  const base = props.apiBaseUrl ?? '';
  const [items, setItems] = useState<InboxConversation[]>(props.conversations);
  const [selectedId, setSelectedId] = useState<string | null>(
    props.conversations[0]?.id ?? null,
  );
  const [phoneView, setPhoneView] = useState<PhoneView>('list');
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [triageFilter, setTriageFilter] = useState<'all' | TriageValue>('all');
  const [notice, setNotice] = useState('');
  const [quotedId, setQuotedId] = useState<string | null>(null);
  const [assignValue, setAssignValue] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [noteValue, setNoteValue] = useState('');

  const selected = items.find((c) => c.id === selectedId) ?? null;
  const quoted = selected?.messages.find((m) => m.id === quotedId) ?? null;

  const allTags = useMemo(
    () => [...new Set(items.flatMap((c) => c.tags))],
    [items],
  );
  const allAgents = useMemo(
    () => [...new Set(items.map((c) => c.assignedTo).filter((a): a is string => a !== null))],
    [items],
  );

  const filtered = items.filter((conv) => {
    if (search) {
      const hay = `${conv.id} ${conv.transactionId ?? ''} ${conv.messages
        .map((m) => `${m.text ?? ''} ${m.templateName ?? ''}`)
        .join(' ')}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    if (channelFilter !== 'all' && conv.channel !== channelFilter) return false;
    if (tagFilter !== 'all' && !conv.tags.includes(tagFilter)) return false;
    if (agentFilter === 'unassigned' && conv.assignedTo !== null) return false;
    if (agentFilter !== 'all' && agentFilter !== 'unassigned' && conv.assignedTo !== agentFilter) return false;
    if (triageFilter !== 'all' && conv.triage !== triageFilter) return false;
    return true;
  });

  function select(id: string): void {
    setSelectedId(id);
    setQuotedId(null);
    setNotice('');
    if (layout === 'phone') setPhoneView('chat');
  }

  function updateSelected(patch: Partial<InboxConversation>): void {
    if (!selected) return;
    setItems((prev) =>
      prev.map((c) => (c.id === selected.id ? { ...c, ...patch } : c)),
    );
  }

  async function postMeta(path: string, body: Record<string, unknown>): Promise<boolean> {
    if (!base || !selected) {
      setNotice('Backend not connected — changes are local to this view only.');
      return false;
    }
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(props.authToken ? { Authorization: `Bearer ${props.authToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setNotice(`Backend refused the record (HTTP ${res.status}). Nothing was assumed.`);
        return false;
      }
      return true;
    } catch {
      setNotice('Backend request failed. Nothing was assumed.');
      return false;
    }
  }

  async function onAssign(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !assignValue) return;
    // Without a backend the change is local-only and applied
    // synchronously, labelled as such — never presented as saved.
    if (!base) {
      updateSelected({ assignedTo: assignValue });
      setNotice('Backend not connected — changes are local to this view only.');
      setAssignValue('');
      return;
    }
    const ok = await postMeta(`/api/whatsapp/inbox/${encodeURIComponent(selected.id)}/assign`, {
      assignedTo: assignValue,
    });
    if (ok) updateSelected({ assignedTo: assignValue });
    setAssignValue('');
  }

  async function onAddTag(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !tagValue) return;
    const nextTags = [...selected.tags, tagValue];
    if (!base) {
      updateSelected({ tags: nextTags });
      setNotice('Backend not connected — changes are local to this view only.');
      setTagValue('');
      return;
    }
    const ok = await postMeta(`/api/whatsapp/inbox/${encodeURIComponent(selected.id)}/tags`, {
      tags: nextTags,
    });
    if (ok) updateSelected({ tags: nextTags });
    setTagValue('');
  }

  async function onAddNote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !noteValue) return;
    const note: InboxNote = { id: `local-note-${Date.now()}`, text: noteValue, author: 'staff' };
    if (!base) {
      updateSelected({ notes: [...selected.notes, note] });
      setNotice('Backend not connected — changes are local to this view only.');
      setNoteValue('');
      return;
    }
    const ok = await postMeta(`/api/whatsapp/inbox/${encodeURIComponent(selected.id)}/notes`, {
      text: noteValue,
      author: 'staff',
    });
    if (ok) updateSelected({ notes: [...selected.notes, note] });
    setNoteValue('');
  }

  async function onSend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const text = String(data.get('message') ?? '');
    if (!text) return;
    if (!base) {
      setNotice('Backend not connected — configure VITE_API_BASE_URL. Nothing was sent.');
      return;
    }
    try {
      const res = await fetch(`${base}/api/whatsapp/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(props.authToken ? { Authorization: `Bearer ${props.authToken}` } : {}),
        },
        body: JSON.stringify({
          transactionId: selected.transactionId,
          to: selected.id,
          kind: 'text',
          text,
        }),
      });
      setNotice(
        res.ok
          ? 'Recorded on the backend.'
          : `Backend refused the message (HTTP ${res.status}). Nothing was assumed.`,
      );
    } catch {
      setNotice('Backend request failed. Nothing was assumed.');
    }
  }

  const listPane = (
    <section aria-label="Conversation list">
      <h2>Conversations</h2>
      <label>
        Search conversations
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by conversation, transaction, or message"
        />
      </label>
      <label>
        Channel
        <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
          <option value="all">All channels</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
      </label>
      <label>
        Tag
        <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
          <option value="all">All tags</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      </label>
      <label>
        Agent
        <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
          <option value="all">All agents</option>
          <option value="unassigned">Unassigned</option>
          {allAgents.map((agent) => (
            <option key={agent} value={agent}>{agent}</option>
          ))}
        </select>
      </label>
      <div role="group" aria-label="Triage">
        {(['all', 'open', 'attention', 'resolved'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={triageFilter === value}
            onClick={() => setTriageFilter(value)}
          >
            {value === 'all' ? 'All triage' : `Triage: ${value}`}
          </button>
        ))}
      </div>
      <ul>
        {filtered.map((conv) => {
          const last = conv.messages[conv.messages.length - 1];
          return (
            <li key={conv.id}>
              <button type="button" aria-pressed={selectedId === conv.id} onClick={() => select(conv.id)}>
                {conv.id} — Triage: {conv.triage} — Agent: {conv.assignedTo ?? 'Unassigned'}
                {last ? ` — Last: ${last.text ?? last.templateName ?? 'message'}` : ' — No messages yet'}
              </button>
            </li>
          );
        })}
      </ul>
      {filtered.length === 0 ? <p>No conversations match these filters.</p> : null}
    </section>
  );

  const chatPane = selected ? (
    <section aria-label="Chat">
      {layout === 'phone' ? (
        <button type="button" onClick={() => setPhoneView('list')}>Back to list</button>
      ) : null}
      <h2>Chat — {selected.id}</h2>
      <p>Channel: {selected.channel}</p>
      {layout === 'phone' ? (
        <button type="button" onClick={() => setPhoneView('details')}>Open details</button>
      ) : null}
      <div>
        {(() => {
          let lastDate = '';
          const rows: ReactNode[] = [];
          for (const message of selected.messages) {
            if (message.date && message.date !== lastDate) {
              lastDate = message.date;
              rows.push(<p key={`date-${message.date}`}>— {message.date} —</p>);
            }
            rows.push(
              <div
                key={message.id}
                className={
                  message.direction === 'OUTBOUND'
                    ? 'wa-msg wa-out'
                    : 'wa-msg wa-in'
                }
              >
                <p>
                  {message.direction === 'INBOUND' ? 'Customer' : 'Staff'}
                  {message.isDryRun ? ' — dry-run' : ''}
                </p>
                {message.templateName ? (
                  <button type="button">{message.templateName}</button>
                ) : null}
                {message.mediaKind ? (
                  <p>Media: {message.mediaKind} — {message.mediaLabel ?? 'attachment'}</p>
                ) : null}
                {message.text ? <p>{message.text}</p> : null}
                <p>
                  {messageTicks(message.status, message.isDryRun)}
                </p>
                <button type="button" onClick={() => setQuotedId(message.id)}>
                  Reply to this message
                </button>
              </div>,
            );
          }
          return rows;
        })()}
      </div>
      <div>
        <p>Internal notes — never sent</p>
        {selected.notes.map((note) => (
          <p key={note.id} style={{ textAlign: 'center' }}>
            Internal note — never sent: {note.text} (by {note.author})
          </p>
        ))}
        {selected.notes.length === 0 ? <p>No internal notes yet.</p> : null}
      </div>
      <form onSubmit={(event) => void onSend(event)}>
        {quoted ? (
          <p>
            Quoting: {quoted.text ?? quoted.templateName ?? quoted.id}{' '}
            <button type="button" onClick={() => setQuotedId(null)}>Clear quote</button>
          </p>
        ) : null}
        <label>
          Message
          <textarea name="message" required />
        </label>
        <button type="submit">Send message</button>
      </form>
    </section>
  ) : (
    <section aria-label="Chat">
      <p>Select a conversation to open its chat.</p>
    </section>
  );

  const detailsPane = selected ? (
    <section aria-label="Details">
      {layout === 'phone' ? (
        <button type="button" onClick={() => setPhoneView('chat')}>Back to chat</button>
      ) : null}
      <h2>Details</h2>
      <p>Linked contract: {selected.transactionId ?? 'No linked transaction'}</p>
      <p>Transaction state: {selected.transactionState ?? 'No linked transaction'}</p>
      <p>Channel: {selected.channel}</p>
      <p>Triage: {selected.triage}</p>
      <p>Assigned agent: {selected.assignedTo ?? 'Unassigned'}</p>
      <form onSubmit={(event) => void onAssign(event)}>
        <label>
          Assign to agent
          <input value={assignValue} onChange={(event) => setAssignValue(event.target.value)} required />
        </label>
        <button type="submit">Assign conversation</button>
      </form>
      <form onSubmit={(event) => void onAddTag(event)}>
        <label>
          Add tag
          <input value={tagValue} onChange={(event) => setTagValue(event.target.value)} required />
        </label>
        <button type="submit">Add tag</button>
      </form>
      <ul>
        {selected.tags.map((tag) => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>
      <form onSubmit={(event) => void onAddNote(event)}>
        <label>
          Internal note (never sent)
          <textarea value={noteValue} onChange={(event) => setNoteValue(event.target.value)} required />
        </label>
        <button type="submit">Add internal note</button>
      </form>
    </section>
  ) : (
    <section aria-label="Details">
      <p>Select a conversation to see its details.</p>
    </section>
  );

  return (
    <div>
      <h2>WhatsApp inbox (staff only)</h2>
      <p>
        Staff-only inbox. Internal notes are never sent to customers.
        Messages labelled dry-run were not delivered.
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      {layout === 'desktop' ? (
        <div>
          {listPane}
          {chatPane}
          {detailsPane}
        </div>
      ) : phoneView === 'list' ? (
        listPane
      ) : phoneView === 'chat' ? (
        chatPane
      ) : (
        detailsPane
      )}
    </div>
  );
}
