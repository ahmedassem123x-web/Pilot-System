// Thin fetch wrapper over the backend API (relative /api/* — same origin, so
// no base URL and no secret is ever needed in the frontend).
// Auth: the login token is stored in localStorage and attached as
// `Authorization: Bearer <token>` on every request. On a 401 the token is
// cleared and a `ps:unauthorized` event is fired so the app can show the
// login screen again. No password or secret value is ever stored here.
import type { AuditEntry, Contact, ContactImportReport, Contract, Conversation, Message, Task, Template, User, EmbeddedSignupCallbackResult, EmbeddedSignupConfig, WhatsAppSendInput, WhatsAppSendResult, WhatsAppStatusFull, WhatsAppTemplateCreateInput, WhatsAppTemplateSubmitResult, WhatsAppTemplateSyncResult, WhatsAppTemplateUpdateInput, WhatsAppTestTokenResult, Workflow, WorkflowStep } from './types';

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

async function reqForm<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, { headers, method: 'POST', body: form });
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
export interface AutomationLog { id: number; conversation_id: number | null; workflow_id: number | null; workflow_kind: string | null; workflow_name: string | null; outcome: string; details: Record<string, unknown>; created_at: string; }
export interface WhatsAppUpload { id: number; filename: string; stored_filename: string; mime_type: string; kind: string; size_bytes: number; media_id: string | null; conversation_id: number | null; uploaded_by: string; dry_run: boolean; created_at: string; }

// Raw-text fetch (CSV export): same Bearer auth, but the body is text, not JSON.
async function reqText(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, { headers });
  if (res.status === 401) {
    clearToken();
    try { window.dispatchEvent(new CustomEvent('ps:unauthorized')); } catch { /* ignore */ }
  }
  if (!res.ok) throw new Error(`خطأ ${res.status} من ${path}`);
  return res.text();
}
// Blob fetch (stored-file download): the download endpoint needs the same
// Bearer token, so a plain <a href> would return 401 — fetch it, then object-URL it.
async function reqBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, { headers });
  if (res.status === 401) {
    clearToken();
    try { window.dispatchEvent(new CustomEvent('ps:unauthorized')); } catch { /* ignore */ }
  }
  if (!res.ok) throw new Error(`خطأ ${res.status} من ${path}`);
  return res.blob();
}

export const api = {
  health: () => req<{ ok: boolean; service: string; states: string[] }>('/health'),
  // Stage C contacts (contract-scoped only, whatsapp:view / whatsapp:edit).
  // No broadcast endpoint exists; these calls never create an audience.
  contacts: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString() : '';
    return req<Contact[]>(`/api/contacts${qs}`);
  },
  getContact: (id: number) => req<Contact>(`/api/contacts/${id}`),
  createContact: (b: { name?: string; phone: string; labels?: string[]; notes?: string }) =>
    req<Contact>('/api/contacts', { method: 'POST', body: JSON.stringify(b) }),
  updateContact: (id: number, b: { name?: string; phone?: string; labels?: string[]; notes?: string }) =>
    req<Contact>(`/api/contacts/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteContact: (id: number) =>
    req<{ ok: boolean }>(`/api/contacts/${id}`, { method: 'DELETE' }),
  importContacts: (csv: string) =>
    req<ContactImportReport>('/api/contacts/import', { method: 'POST', body: JSON.stringify({ csv }) }),
  exportContacts: () => reqText('/api/contacts/export'),
  downloadUpload: (id: number) => reqBlob(`/api/whatsapp/uploads/${id}/download`),
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
  // Stage B: real file upload (multipart, Node built-ins server-side).
  // 16 MB cap, image/video/document/audio only, filename sanitized
  // server-side; when Meta is configured the file is uploaded to Meta
  // and sent by media ID, otherwise it is a dry-run local record.
  whatsappUpload: (file: File, opts: { conversation_id?: number; to?: string; caption?: string }) => {
    const form = new FormData();
    form.append('file', file);
    if (opts.conversation_id) form.append('conversation_id', String(opts.conversation_id));
    if (opts.to) form.append('to', opts.to);
    if (opts.caption) form.append('caption', opts.caption);
    return reqForm<{ ok: boolean; dry_run?: boolean; configured?: boolean; wamid?: string; upload: WhatsAppUpload; message?: unknown; error?: string }>('/api/whatsapp/upload', form);
  },
  whatsappUploads: () => req<WhatsAppUpload[]>('/api/whatsapp/uploads'),
  whatsappMediaUrl: (mediaId: string) =>
    req<{ ok: boolean; configured: boolean; download_url: string | null; mime_type?: string | null }>(`/api/whatsapp/media/${encodeURIComponent(mediaId)}`),
  // Stage B: automation execution controls (automation:edit for run /
  // handoff / resume, automation:view for logs and state).
  runWorkflow: (id: number, conversation_id: number) =>
    req<{ ok: boolean; outcome?: string; blocked_reason?: string }>(`/api/workflows/${id}/run`, { method: 'POST', body: JSON.stringify({ conversation_id }) }),
  runRule: (id: number, conversation_id: number) =>
    req<{ ok: boolean; outcome?: string; blocked_reason?: string }>(`/api/automation/rules/${id}/run`, { method: 'POST', body: JSON.stringify({ conversation_id }) }),
  handoffConversation: (id: number) =>
    req<{ ok: boolean; handed_off: boolean }>(`/api/conversations/${id}/automation/handoff`, { method: 'POST' }),
  resumeAutomation: (id: number) =>
    req<{ ok: boolean; handed_off: boolean }>(`/api/conversations/${id}/automation/resume`, { method: 'POST' }),
  automationLogs: (conversation_id?: number) =>
    req<AutomationLog[]>(`/api/automation/logs${conversation_id ? `?conversation_id=${conversation_id}` : ''}`),
  createWhatsAppTemplate: (b: WhatsAppTemplateCreateInput) =>
    req<Template>('/api/whatsapp/templates', { method: 'POST', body: JSON.stringify(b) }),
  submitWhatsAppTemplate: (id: number) =>
    req<WhatsAppTemplateSubmitResult>(`/api/whatsapp/templates/${id}/submit`, { method: 'POST' }),
  syncWhatsAppTemplates: () =>
    req<WhatsAppTemplateSyncResult>('/api/whatsapp/templates/sync', { method: 'POST' }),
  embeddedSignupConfig: () =>
    req<EmbeddedSignupConfig>('/api/whatsapp/embedded-signup/config'),
  embeddedSignupCallback: (code: string, redirect_uri?: string) =>
    req<EmbeddedSignupCallbackResult>('/api/whatsapp/embedded-signup/callback', { method: 'POST', body: JSON.stringify({ code, ...(redirect_uri ? { redirect_uri } : {}) }) }),
  getWhatsAppTemplate: (id: number) =>
    req<Template>(`/api/whatsapp/templates/${id}`),
  updateWhatsAppTemplate: (id: number, b: WhatsAppTemplateUpdateInput) =>
    req<Template>(`/api/whatsapp/templates/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
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
