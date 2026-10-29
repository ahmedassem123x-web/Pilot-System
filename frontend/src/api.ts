// Thin fetch wrapper over the backend API (relative /api/* — same origin, so
// no base URL and no secret is ever needed in the frontend).
// Auth: the login token is stored in localStorage and attached as
// `Authorization: Bearer <token>` on every request. On a 401 the token is
// cleared and a `ps:unauthorized` event is fired so the app can show the
// login screen again. No password or secret value is ever stored here.
import type { AuditEntry, Contract, Conversation, Message, Task, Template, User, WhatsAppSendInput, WhatsAppSendResult, WhatsAppStatusFull, WhatsAppTemplateCreateInput, WhatsAppTemplateSubmitResult, WhatsAppTemplateSyncResult, WhatsAppTestTokenResult, Workflow, WorkflowStep } from './types';

const TOKEN_KEY = 'ps_token';
export function getToken(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function setToken(t: string) { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } }
export function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, { headers, ...init });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearToken();
    try { window.dispatchEvent(new CustomEvent('ps:unauthorized')); } catch { /* ignore */ }
  }
  if (!res.ok) {
    const err = new Error((body as { error?: string }).error || `خطأ ${res.status} من ${path}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export interface MeUser extends User {}
export type WhatsAppStatus = WhatsAppStatusFull;
export interface AutomationRule {
  id: number; name: string; category: string; trigger_type: string | null; trigger_value: string | null;
  steps: WorkflowStep[]; actions: unknown[]; is_active: boolean; deactivated_by_kill_switch?: boolean;
}
export interface ChecklistStep { step: number; key: string; title_ar: string; description_ar: string; status: string; }

export const api = {
  health: () => req<{ ok: boolean; service: string; states: string[] }>('/health'),
  login: (email: string, password: string) =>
    req<{ token: string; user: MeUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => req<MeUser>('/api/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    req<{ ok: boolean }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  departments: () => req<{ key: string; label_ar: string }[]>('/api/departments'),
  whatsappStatus: () => req<WhatsAppStatus>('/api/whatsapp/status'),
  // Stage 5 Meta WhatsApp contract. None of these requests carries, returns,
  // or stores any token/secret/phone/WABA value — test-token returns only
  // booleans, and send returns only ok/dry_run/message ids or an error.
  whatsappTestToken: () => req<WhatsAppTestTokenResult>('/api/whatsapp/test-token', { method: 'POST' }),
  whatsappSend: (b: WhatsAppSendInput) =>
    req<WhatsAppSendResult>('/api/whatsapp/send', { method: 'POST', body: JSON.stringify(b) }),
  createWhatsAppTemplate: (b: WhatsAppTemplateCreateInput) =>
    req<Template>('/api/whatsapp/templates', { method: 'POST', body: JSON.stringify(b) }),
  submitWhatsAppTemplate: (id: number) =>
    req<WhatsAppTemplateSubmitResult>(`/api/whatsapp/templates/${id}/submit`, { method: 'POST' }),
  syncWhatsAppTemplates: () =>
    req<WhatsAppTemplateSyncResult>('/api/whatsapp/templates/sync', { method: 'POST' }),
  connectionChecklist: () => req<ChecklistStep[]>('/api/connection-checklist'),
  contracts: () => req<Contract[]>('/api/contracts'),
  createContract: (b: { buyer_phone: string; seller_phone: string; product_description: string; amount: number; currency: string; delivery_point?: string }) =>
    req<Contract>('/api/contracts', { method: 'POST', body: JSON.stringify(b) }),
  transition: (id: number, b: { to: string; financial_reference?: string; actor?: string }) =>
    req<Contract>(`/api/contracts/${id}/transition`, { method: 'POST', body: JSON.stringify(b) }),
  contractVersions: (id: number) => req<Record<string, unknown>[]>(`/api/contracts/${id}/versions`),
  conversations: () => req<Conversation[]>('/api/conversations'),
  assignConversation: (id: number, assigned_to: string) =>
    req<Conversation>(`/api/conversations/${id}/assign`, { method: 'POST', body: JSON.stringify({ assigned_to }) }),
  readConversation: (id: number) =>
    req<Conversation>(`/api/conversations/${id}/read`, { method: 'POST' }),
  replyConversation: (id: number, b: { body?: string; template_name?: string | null; is_internal_note?: boolean; sender_name?: string }) =>
    req<Message>(`/api/conversations/${id}/reply`, { method: 'POST', body: JSON.stringify(b) }),
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
  updateTemplate: (id: number, approval_status: string) =>
    req<Template>(`/api/templates/${id}`, { method: 'PUT', body: JSON.stringify({ approval_status }) }),
  automationRules: () => req<AutomationRule[]>('/api/automation/rules'),
  createRule: (b: { name: string; category?: string; trigger_type?: string | null; trigger_value?: string | null; steps?: WorkflowStep[] }) =>
    req<AutomationRule>('/api/automation/rules', { method: 'POST', body: JSON.stringify(b) }),
  toggleRule: (id: number) =>
    req<AutomationRule>(`/api/automation/rules/${id}/toggle`, { method: 'POST' }),
  users: () => req<User[]>('/api/users'),
  createUser: (b: { full_name: string; email: string; password: string; role: string; department?: string | null; sections?: string[]; actions?: Record<string, string[]> }) =>
    req<User>('/api/users', { method: 'POST', body: JSON.stringify(b) }),
  updateUser: (id: number, b: Record<string, unknown>) =>
    req<User>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteUser: (id: number) =>
    req<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),
  disableUser: (id: number) =>
    req<User>(`/api/users/${id}/disable`, { method: 'POST' }),
  enableUser: (id: number) =>
    req<User>(`/api/users/${id}/enable`, { method: 'POST' }),
  resetPassword: (id: number, password: string) =>
    req<User>(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
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
