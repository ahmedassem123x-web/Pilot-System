// Pilot System v3.1 — Sprint 4 (PB-13). Inbox read model + staff
// triage metadata for the WhatsApp inbox triptych.
//
// READ MODEL: conversations are DERIVED from MessageLog rows (the
// existing store) grouped by transaction_id; a MessageLog with no
// transaction is its own unlinked conversation. This service NEVER
// writes a MessageLog, NEVER calls the transaction service, NEVER
// performs a transition, and NEVER treats a message as institution
// confirmation — it only reads logs and holds staff triage metadata.
//
// INTERNAL NOTES are staff-only metadata held here. They are NEVER
// MessageLog OUTBOUND rows and are NEVER sent (the triptych renders
// them as centred system notices). Assignment, tags and triage are
// likewise metadata only: they change no transaction state, no
// permission, and no message status.
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { InMemoryStore } from '../store/in-memory.store';
import type { MessageLog, Store } from '../store/repository';

export type TriageValue = 'open' | 'attention' | 'resolved';

export interface InternalNote {
  id: string;
  text: string;
  author: string;
  createdAt: string;
}

export interface ConversationMeta {
  assignedTo: string | null;
  tags: string[];
  triage: TriageValue | null;
  notes: InternalNote[];
}

export interface Conversation {
  id: string;
  transactionId: string | null;
  channel: 'whatsapp';
  messages: MessageLog[];
  assignedTo: string | null;
  tags: string[];
  triage: TriageValue;
  notes: InternalNote[];
  lastMessage: MessageLog | null;
}

const TRIAGE_VALUES: TriageValue[] = ['open', 'attention', 'resolved'];

@Injectable()
export class InboxService {
  private readonly meta = new Map<string, ConversationMeta>();
  private noteCounter = 0;

  constructor(@Inject(InMemoryStore) private readonly store: Store) {}

  /** All MessageLog rows, in store order, optionally filtered. */
  listMessages(filter: {
    transactionId?: string;
    direction?: 'INBOUND' | 'OUTBOUND';
    status?: MessageLog['status'];
  }): MessageLog[] {
    return this.store
      .exportSnapshot()
      .messageLogs.filter((log) => {
        if (filter.transactionId && log.transaction_id !== filter.transactionId) return false;
        if (filter.direction && log.direction !== filter.direction) return false;
        if (filter.status && log.status !== filter.status) return false;
        return true;
      });
  }

  private metaFor(id: string): ConversationMeta {
    let entry = this.meta.get(id);
    if (!entry) {
      entry = { assignedTo: null, tags: [], triage: null, notes: [] };
      this.meta.set(id, entry);
    }
    return entry;
  }

  private buildConversation(id: string, transactionId: string | null, messages: MessageLog[]): Conversation {
    const meta = this.metaFor(id);
    const hasFailed = messages.some((m) => m.status === 'FAILED');
    return {
      id,
      transactionId,
      channel: 'whatsapp',
      messages,
      assignedTo: meta.assignedTo,
      tags: [...meta.tags],
      // Explicit staff triage wins; otherwise a FAILED message means
      // attention, otherwise open.
      triage: meta.triage ?? (hasFailed ? 'attention' : 'open'),
      notes: [...meta.notes],
      lastMessage: messages[messages.length - 1] ?? null,
    };
  }

  listConversations(filter: {
    search?: string;
    tag?: string;
    assignedTo?: string;
    triage?: TriageValue;
  }): Conversation[] {
    const grouped = new Map<string, { transactionId: string | null; messages: MessageLog[] }>();
    for (const log of this.listMessages({})) {
      const id = log.transaction_id ?? `unlinked:${log.whatsapp_message_id}`;
      let group = grouped.get(id);
      if (!group) {
        group = { transactionId: log.transaction_id, messages: [] };
        grouped.set(id, group);
      }
      group.messages.push(log);
    }
    return [...grouped.entries()]
      .map(([id, group]) => this.buildConversation(id, group.transactionId, group.messages))
      .filter((conv) => {
        if (filter.search) {
          const hay = `${conv.id} ${conv.transactionId ?? ''} ${conv.messages.map((m) => m.whatsapp_message_id).join(' ')}`;
          if (!hay.includes(filter.search)) return false;
        }
        if (filter.tag && !conv.tags.includes(filter.tag)) return false;
        if (filter.assignedTo && conv.assignedTo !== filter.assignedTo) return false;
        if (filter.triage && conv.triage !== filter.triage) return false;
        return true;
      });
  }

  getConversation(id: string): Conversation | undefined {
    return this.listConversations({}).find((conv) => conv.id === id);
  }

  assign(id: string, assignedTo: string): Conversation {
    if (!assignedTo) {
      throw new DomainError('INVALID_INPUT', 422, 'assignedTo is required');
    }
    // The conversation must exist (a real MessageLog group); metadata
    // cannot be attached to a conversation that does not exist.
    if (!this.getConversation(id)) {
      throw new DomainError('NOT_FOUND', 404, `Conversation ${id} not found`);
    }
    this.metaFor(id).assignedTo = assignedTo;
    return this.getConversation(id) as Conversation;
  }

  setTags(id: string, tags: string[]): Conversation {
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string' || !t)) {
      throw new DomainError('INVALID_INPUT', 422, 'tags must be an array of non-empty strings');
    }
    if (!this.getConversation(id)) {
      throw new DomainError('NOT_FOUND', 404, `Conversation ${id} not found`);
    }
    this.metaFor(id).tags = [...tags];
    return this.getConversation(id) as Conversation;
  }

  setTriage(id: string, triage: string): Conversation {
    if (!(TRIAGE_VALUES as string[]).includes(triage)) {
      throw new DomainError('INVALID_INPUT', 422, 'triage must be open, attention, or resolved');
    }
    if (!this.getConversation(id)) {
      throw new DomainError('NOT_FOUND', 404, `Conversation ${id} not found`);
    }
    this.metaFor(id).triage = triage as TriageValue;
    return this.getConversation(id) as Conversation;
  }

  /** Internal note: stored as metadata ONLY — never a MessageLog row, never sent. */
  addNote(id: string, text: string, author: string): Conversation {
    if (!text) {
      throw new DomainError('INVALID_INPUT', 422, 'note text is required');
    }
    if (!this.getConversation(id)) {
      throw new DomainError('NOT_FOUND', 404, `Conversation ${id} not found`);
    }
    this.noteCounter += 1;
    this.metaFor(id).notes.push({
      id: `note-${this.noteCounter}`,
      text,
      author,
      createdAt: new Date().toISOString(),
    });
    return this.getConversation(id) as Conversation;
  }
}
