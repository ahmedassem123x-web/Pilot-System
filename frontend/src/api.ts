// Thin fetch wrapper over the backend API (relative /api/* — same origin, so
// no base URL and no secret is ever needed in the frontend).
import type { AuditEntry, Contract, Conversation, Message, Task, Template, User, Workflow, WorkflowStep } from './types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `خطأ ${res.status} من ${path}`);
  return body as T;
}

export const api = {
  health: () => req<{ ok: boolean; service: string; states: string[] }>('/health'),
  contracts: () => req<Contract[]>('/api/contracts'),
  createContract: (b: { buyer_phone: string; seller_phone: string; product_description: string; amount: number; currency: string; delivery_point?: string }) =>
    req<Contract>('/api/contracts', { method: 'POST', body: JSON.stringify(b) }),
  transition: (id: number, b: { to: string; financial_reference?: string; actor?: string }) =>
    req<Contract>(`/api/contracts/${id}/transition`, { method: 'POST', body: JSON.stringify(b) }),
  conversations: () => req<Conversation[]>('/api/conversations'),
  messages: () => req<Message[]>('/api/messages'),
  sendMessage: (b: { conversation_id: number; direction: string; sender_name: string; body: string; template_name?: string | null; is_internal_note: boolean }) =>
    req<Message>('/api/messages', { method: 'POST', body: JSON.stringify(b) }),
  tasks: () => req<Task[]>('/api/tasks'),
  taskAction: (id: number, action: 'complete' | 'cancel') =>
    req<Task>(`/api/tasks/${id}/${action}`, { method: 'POST' }),
  workflows: () => req<Workflow[]>('/api/workflows'),
  createWorkflow: (b: { name: string; trigger_type: string; trigger_value?: string | null; steps: WorkflowStep[] }) =>
    req<Workflow>('/api/workflows', { method: 'POST', body: JSON.stringify(b) }),
  updateWorkflow: (id: number, b: { name: string; trigger_type: string; trigger_value?: string | null; steps: WorkflowStep[] }) =>
    req<Workflow>(`/api/workflows/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteWorkflow: (id: number) =>
    req<{ ok: boolean }>(`/api/workflows/${id}`, { method: 'DELETE' }),
  templates: () => req<Template[]>('/api/templates'),
  users: () => req<User[]>('/api/users'),
  createUser: (b: { full_name: string; email: string; role: string }) =>
    req<User>('/api/users', { method: 'POST', body: JSON.stringify(b) }),
  audit: () => req<AuditEntry[]>('/api/audit'),
  killSwitchGet: () => req<{ killSwitch: boolean }>('/api/automation/kill-switch'),
  killSwitchSet: (off: boolean) =>
    req<{ killSwitch: boolean }>('/api/automation/kill-switch', { method: 'POST', body: JSON.stringify({ off }) }),
};

// Local-only state (backend has no endpoints for these yet). Kept in
// localStorage, clearly labelled in the UI, never mixed into server data.
function loadLocal<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function saveLocal(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } }

export const local = {
  taskOverrides: (): Record<number, string> => loadLocal('ps_task_overrides', {}),
  setTaskOverride: (id: number, status: string) => {
    const o = loadLocal<Record<number, string>>('ps_task_overrides', {}); o[id] = status; saveLocal('ps_task_overrides', o);
  },
  hiddenWorkflows: (): number[] => loadLocal('ps_hidden_workflows', []),
  hideWorkflow: (id: number) => { const h = loadLocal<number[]>('ps_hidden_workflows', []); if (!h.includes(id)) { h.push(id); saveLocal('ps_hidden_workflows', h); } },
  assignees: (): Record<number, string> => loadLocal('ps_assignees', {}),
  setAssignee: (convId: number, name: string) => {
    const a = loadLocal<Record<number, string>>('ps_assignees', {}); a[convId] = name; saveLocal('ps_assignees', a);
  },
  attachments: (): Record<number, { name: string; size: number; type: string; added_at: string }[]> => loadLocal('ps_attachments', {}),
  addAttachment: (contractId: number, f: { name: string; size: number; type: string }) => {
    const a = loadLocal<Record<number, { name: string; size: number; type: string; added_at: string }[]>>('ps_attachments', {});
    (a[contractId] ||= []).push({ ...f, added_at: new Date().toISOString() }); saveLocal('ps_attachments', a);
  },
  amendDrafts: (): Record<number, { product_description: string; amount: string; delivery_point: string; saved_at: string }> => loadLocal('ps_amend_drafts', {}),
  saveAmendDraft: (contractId: number, d: { product_description: string; amount: string; delivery_point: string }) => {
    const a = loadLocal<Record<number, { product_description: string; amount: string; delivery_point: string; saved_at: string }>>('ps_amend_drafts', {});
    a[contractId] = { ...d, saved_at: new Date().toISOString() }; saveLocal('ps_amend_drafts', a);
  },
  checklist: (): Record<number, boolean> => loadLocal('ps_checklist', {}),
  setChecklist: (i: number, v: boolean) => {
    const c = loadLocal<Record<number, boolean>>('ps_checklist', {}); c[i] = v; saveLocal('ps_checklist', c);
  },
};
