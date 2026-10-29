// Pilot System — standalone backend (Node.js built-ins only)
// Rules enforced here, matching docs/state-machine.md and db/schema.sql:
// - No internal wallet/balance, no marketplace, no automated bank API.
// - No payment confirmation without a financial-institution reference.
// - No automated money step: release/refund/confirm/settle are human-only.
// - Audit log is append-only: the API never updates or deletes it
//   (GET /api/audit only; POST/PUT/PATCH/DELETE on it return 404).
// - WhatsApp webhook verifies HMAC-SHA256 over the RAW request body with
//   WHATSAPP_APP_SECRET (constant-time compare); a missing/malformed
//   signature is rejected, and invalid JSON is never stored as a message.
// - Meta WhatsApp Cloud API client (Node https/http built-ins only):
//   base https://graph.facebook.com, version from WHATSAPP_API_VERSION
//   (default v26.0), token/phone/WABA IDs from environment only, never
//   returned in any response and never written to any file. A mock base
//   URL (META_MOCK_BASE_URL) exists for tests only, never for production.
// - Contract file uploads store METADATA ONLY — never file bytes/content.
// - Auth: every /api route requires a Bearer token, except /health,
//   POST /api/auth/login and the WhatsApp webhook (GET/POST). Tokens are
//   HMAC-signed with JWT_SECRET (random per-process fallback, never a
//   hardcoded default). Passwords are stored ONLY as scrypt hashes.
// Data is persisted to backend/data.json for local testing. In production
// (Railway/Render/VPS) the same API shape sits on PostgreSQL via db/schema.sql.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, verifyPassword, signToken, verifyToken, loginBlocked, recordLoginFailure, clearLoginFailures } = require('./auth');
const { appendAudit } = require('./audit');
const { STATES, TRANSITIONS, sha256, contractCode } = require('./contracts');
const { normPhone, phoneKey, within24h, META_STATUS_RANK, mapMetaStatus, mapMetaTemplateStatus } = require('./whatsapp');
const { BANNED_STEP_TYPES, AUTOMATION_MAX_STEPS_PER_RUN, AUTOMATION_COOLDOWN_MS, AUTOMATION_MAX_RUNS_PER_MINUTE, stepIsBanned, hasBannedStep, normaliseSteps, normalizeArabic, keywordMatchKind, parseHoursRange, isBusinessHoursNow } = require('./automation');
const { validContactPhone, parseContactLabels, parseCsv, csvEscape } = require('./contacts');
const { UPLOAD_MAX_BYTES, UPLOAD_ALLOWED, sanitizeFilename, publicUpload } = require('./media');
const { metaConfig, embeddedLaunchParams, metaErrorInfo, safeEqualStr, metaRequest } = require('./meta');
const { buildPdf } = require('./pdf');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const FRONTEND_FALLBACK = path.join(__dirname, '..', '..', 'frontend');
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB (all routes except the webhook)
const WEBHOOK_MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB: Meta webhook only

// STATES/TRANSITIONS/sha256/contractCode now come from ./contracts.js (single source of truth).
const ROLES = ['owner','ops_supervisor','ops_employee','financial_coordinator','viewer'];
const DEPARTMENTS = ['Operations','Finance Coordination','Customer Support','Administration'];
const DEPARTMENT_AR = {
  'Operations': 'العمليات',
  'Finance Coordination': 'التنسيق المالي',
  'Customer Support': 'دعم العملاء',
  'Administration': 'الإدارة',
};
const SECTIONS = ['dashboard','contracts','inbox','tasks','whatsapp','automation','users','audit','settings'];
const SECTION_ACTIONS = ['view','create','edit','approve','manage'];
// Role defaults. Per-user sections/actions stored on the user record
// override (restrict) these defaults; owner always has everything.
const ROLE_DEFAULTS = {
  owner: {
    sections: [...SECTIONS],
    actions: Object.fromEntries(SECTIONS.map((s) => [s, ['view','create','edit','approve','manage']])),
  },
  ops_supervisor: {
    sections: ['dashboard','contracts','inbox','tasks','automation','audit'],
    actions: {
      dashboard: ['view'], contracts: ['view','create','edit','approve'],
      inbox: ['view','create','edit'], tasks: ['view','create','edit','approve'],
      automation: ['view','create','edit'], audit: ['view'],
    },
  },
  ops_employee: {
    sections: ['dashboard','contracts','inbox','tasks'],
    actions: {
      dashboard: ['view'], contracts: ['view','create','edit'],
      inbox: ['view','create','edit'], tasks: ['view','create','edit'],
    },
  },
  financial_coordinator: {
    sections: ['dashboard','contracts','inbox','tasks','audit'],
    actions: {
      dashboard: ['view'], contracts: ['view'], inbox: ['view'],
      tasks: ['view'], audit: ['view'],
    },
  },
  viewer: {
    sections: ['dashboard','contracts','inbox','audit'],
    actions: {
      dashboard: ['view'], contracts: ['view'], inbox: ['view'], audit: ['view'],
    },
  },
};
// BANNED_STEP_TYPES / AUTOMATION_* / UPLOAD_* now come from ./automation.js and ./media.js.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const FILE_KINDS = ['original', 'buyer_signed', 'seller_signed', 'attachment'];
const CONTRACT_TYPES = ['goods_sale', 'service', 'supply', 'general'];
const CONTRACT_TYPE_AR = { goods_sale: 'بيع بضاعة', service: 'تقديم خدمة', supply: 'توريد', general: 'تنفيذ صفقة عام' };
function contractTypeOf(c) { return CONTRACT_TYPES.includes(c.contract_type) ? c.contract_type : 'general'; }
const TEMPLATE_STATUSES = ['pending', 'approved', 'rejected'];
const CONVERSATION_STATUSES = ['new', 'open', 'pending', 'resolved', 'closed'];
const TEMPLATE_LABELS_AR = {
  contract_created: 'إنشاء عقد',
  invite_accept: 'دعوة قبول',
  contract_accepted: 'قبول العقد',
  payment_request: 'طلب دفع',
  payment_confirmed_fi: 'تأكيد دفع من المؤسسة المالية',
  preparing: 'تجهيز الطلب',
  delivery_confirmed: 'تأكيد التسليم',
  transaction_closed: 'إغلاق الصفقة',
  dispute_opened: 'فتح نزاع',
  handover_support: 'تسليم للدعم',
};
// Old 10-step CHECKLIST_STEPS deleted: the one wizard is computeWizardSteps() (7 steps).


// Auth (hashing, HMAC tokens) now comes from ./auth.js; JWT_SECRET lives there.
// ---- Login rate limiting: max 10 failed attempts per IP per 15 min ----
// Login rate limiting now comes from ./auth.js.
// ---- Data store ----
function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { users: [], contracts: [], conversations: [], messages: [], tasks: [], workflows: [], templates: [], rules: [], audit: [], killSwitch: false, seq: 1, automation_logs: [], uploads: [] }; }
}
let db = load();
// Migrate older data files: never drop existing rows, just add new collections.
for (const k of ['users', 'contracts', 'conversations', 'messages', 'tasks', 'workflows', 'templates', 'rules', 'audit', 'contract_versions', 'contract_files', 'automation_logs', 'uploads', 'contacts', 'quick_replies']) {
  if (!Array.isArray(db[k])) db[k] = [];
}
if (typeof db.killSwitch !== 'boolean') db.killSwitch = false;
if (typeof db.seq !== 'number') db.seq = 1;
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
function nextId() { return db.seq++; }
function audit(actor, entity, id, action, details = {}) { appendAudit(db, nextId, save, actor, entity, id, action, details); }

// ---- Security headers (CSP keeps 'unsafe-inline' only because the
// frontend is a single inlined HTML file; frame-ancestors blocks framing) ----
function securityHeaders(pathname) {
  const h = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  };
  if (pathname.startsWith('/api')) h['Cache-Control'] = 'no-store';
  return h;
}
function send(res, code, obj, pathname = '') {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(pathname) });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; let size = 0; let tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { tooLarge = true; return; }
      b += c;
    });
    req.on('end', () => {
      if (tooLarge) return resolve({ __tooLarge: true });
      try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}
// ---- Raw-body reader (webhook only) ----
// Returns { raw: Buffer, tooLarge: bool }. The webhook MUST verify the
// HMAC over these exact bytes: re-serialising parsed JSON changes key
// order/spacing and breaks genuine Meta signatures.
function readRawBody(req, maxBytes) {
  return new Promise((resolve) => {
    const chunks = []; let size = 0; let tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { tooLarge = true; return; }
      chunks.push(c);
    });
    req.on('end', () => resolve({ raw: Buffer.concat(chunks), tooLarge }));
    req.on('error', () => resolve({ raw: Buffer.concat(chunks), tooLarge: true }));
  });
}
// safeEqualStr now comes from ./meta.js (constant-time, same-length only).
// Meta client (metaConfig/metaRequest/embeddedLaunchParams) now comes from ./meta.js.
// ---- WhatsApp phone / conversation helpers ----
// Normalise for matching: strip spaces, dashes, parentheses; keep '+'.
// normPhone/phoneKey now come from ./whatsapp.js.
// Find (or, for sending, create) the conversation for a customer phone:
// prefer a contract conversation whose buyer/seller phone matches, else
// a GENERAL conversation (contract_id null, party 'general') for that
// phone. NEVER creates a contract.
function conversationForPhone(phone, createGeneral) {
  const key = phoneKey(phone);
  for (const c of db.contracts) {
    if (phoneKey(c.buyer_phone) === key) {
      const conv = db.conversations.find((x) => x.contract_id === c.id && x.party === 'buyer');
      if (conv) return conv;
    }
    if (phoneKey(c.seller_phone) === key) {
      const conv = db.conversations.find((x) => x.contract_id === c.id && x.party === 'seller');
      if (conv) return conv;
    }
  }
  const general = db.conversations.find((x) => x.contract_id === null && x.party === 'general' && phoneKey(x.phone) === key);
  if (general) return general;
  if (!createGeneral) return null;
  const conv = { id: nextId(), contract_id: null, party: 'general', phone: normPhone(phone), status: 'new', unread_count: 0, assigned_to: null, last_inbound_at: null };
  db.conversations.push(conv);
  return conv;
}
// Most recent inbound timestamp (ISO) for a phone across its conversations.
function lastInboundAtForPhone(phone) {
  const key = phoneKey(phone);
  let latest = null;
  for (const conv of db.conversations) {
    let matches = false;
    if (conv.contract_id !== null && conv.contract_id !== undefined) {
      const c = db.contracts.find((x) => x.id === conv.contract_id);
      if (c && ((conv.party === 'buyer' && phoneKey(c.buyer_phone) === key) || (conv.party === 'seller' && phoneKey(c.seller_phone) === key))) matches = true;
    } else if (conv.party === 'general' && phoneKey(conv.phone) === key) matches = true;
    if (matches && conv.last_inbound_at && (!latest || conv.last_inbound_at > latest)) latest = conv.last_inbound_at;
  }
  return latest;
}
// within24h / META_STATUS_RANK / mapMetaStatus / mapMetaTemplateStatus now come from ./whatsapp.js;
// contractCode from ./contracts.js.
// stepIsBanned/hasBannedStep/normaliseSteps now come from ./automation.js.
function bumpUnread(conversationId) {
  const conv = db.conversations.find((c) => c.id === conversationId);
  if (conv) conv.unread_count = (conv.unread_count || 0) + 1;
}
function onlyActiveOwnerCount() {
  return db.users.filter((u) => u.role === 'owner' && u.is_active !== false).length;
}
function contractVersions(contractId) {
  return db.contract_versions.filter((v) => v.contract_id === contractId).sort((a, b) => a.version - b.version);
}

// ================= Stage C: contacts (contract-scoped address book) =================
// A contact is a staff-curated record for a customer phone. It NEVER creates
// a contract, a conversation, or a broadcast audience: there is no broadcast
// endpoint anywhere in this server, and contacts are used only to look up
// the conversations/contracts that already exist for that phone.
// Permission family: whatsapp:view (read) / whatsapp:edit (write/import) —
// the same family as templates and uploads. There is deliberately no
// separate contacts permission: role defaults grant whatsapp only to owner,
// so other roles need an explicit whatsapp section/action override.
// Utility-messaging eligibility is COMPUTED, never claimed by staff:
//   utility_eligible = true iff the phone has (a) a prior inbound message,
//   or (b) an outbound template message actually sent via Meta (dry_run
//   false and a Meta wamid present). A staff-local /api/messages record
//   with a template name, an internal note, or a dry-run record never
//   confers eligibility, and creating a contact never confers it either.
//   Eligibility is a record of a past interaction, not consent: staff must
//   still respect Meta's 24h window / approved-template rules on every send.
// validContactPhone now comes from ./contacts.js.
function contactMatchesConversation(contact, conv) {
  const key = phoneKey(contact.phone);
  if (conv.contract_id !== null && conv.contract_id !== undefined) {
    const c = db.contracts.find((x) => x.id === conv.contract_id);
    if (!c) return false;
    return (conv.party === 'buyer' && phoneKey(c.buyer_phone) === key) || (conv.party === 'seller' && phoneKey(c.seller_phone) === key);
  }
  return conv.party === 'general' && phoneKey(conv.phone) === key;
}
function contactLinks(contact) {
  const key = phoneKey(contact.phone);
  const convs = db.conversations.filter((c) => contactMatchesConversation(contact, c));
  const convIds = new Set(convs.map((c) => c.id));
  const contracts = [];
  const roles = [];
  for (const c of db.contracts) {
    if (phoneKey(c.buyer_phone) === key) { contracts.push({ id: c.id, code: c.code, state: c.state, role: 'buyer' }); if (!roles.includes('buyer')) roles.push('buyer'); }
    if (phoneKey(c.seller_phone) === key) { contracts.push({ id: c.id, code: c.code, state: c.state, role: 'seller' }); if (!roles.includes('seller')) roles.push('seller'); }
  }
  const msgs = db.messages.filter((m) => convIds.has(m.conversation_id) && !m.is_internal_note);
  let lastContactAt = null;
  for (const m of msgs) if (m.created_at && (!lastContactAt || m.created_at > lastContactAt)) lastContactAt = m.created_at;
  let eligibilityBasis = null;
  if (msgs.some((m) => m.direction === 'in')) eligibilityBasis = 'prior_inbound';
  else if (msgs.some((m) => m.direction === 'out' && m.template_name && m.dry_run !== true && m.wamid)) eligibilityBasis = 'approved_template';
  return {
    roles,
    contracts,
    conversations: convs.map((c) => ({ id: c.id, contract_id: c.contract_id, party: c.party, status: c.status, unread_count: c.unread_count || 0, last_inbound_at: c.last_inbound_at || null })),
    last_contact_at: lastContactAt,
    message_count: msgs.length,
    utility_eligible: eligibilityBasis !== null,
    eligibility_basis: eligibilityBasis,
  };
}
function contactPublic(contact) { return { ...contact, ...contactLinks(contact) }; }
// parseContactLabels/parseCsv/csvEscape now come from ./contacts.js.
// ---- Permissions ----
function effectiveSections(user) {
  if (Array.isArray(user.sections)) return user.sections.filter((s) => SECTIONS.includes(s));
  return (ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.viewer).sections;
}
function effectiveActions(user) {
  if (user.actions && typeof user.actions === 'object' && !Array.isArray(user.actions)) return user.actions;
  return (ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.viewer).actions;
}
function can(user, section, action) {
  if (!user) return false;
  if (user.is_primary_admin || user.role === 'owner') return true;
  if (!effectiveSections(user).includes(section)) return false;
  const acts = effectiveActions(user)[section] || [];
  return acts.includes(action);
}
function canAny(user, section, actions) { return actions.some((a) => can(user, section, a)); }
// Never return a password hash to any client.
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, full_name: u.full_name, email: u.email, role: u.role,
    department: u.department || null, is_active: u.is_active !== false,
    is_primary_admin: !!u.is_primary_admin,
    sections: effectiveSections(u), actions: effectiveActions(u),
    created_at: u.created_at || null,
  };
}

// ---- Validation helpers ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normEmail(v) { return String(v || '').trim().toLowerCase(); }
function validSections(v) { return Array.isArray(v) && v.every((s) => SECTIONS.includes(s)); }
function validActions(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v).every(([sec, acts]) =>
    SECTIONS.includes(sec) && Array.isArray(acts) && acts.every((a) => SECTION_ACTIONS.includes(a)));
}
function rejectUnknown(body, allowed) {
  const bad = Object.keys(body || {}).filter((k) => !allowed.includes(k));
  return bad.length ? `unknown field: ${bad[0]}` : null;
}

// ---- Template validation / preview (Stage A) ----
// Placeholders must be {{1}}, {{2}}, ... in sequence, no gaps/duplicates.
// Meta also rejects a body that starts or ends with a placeholder.
function templatePlaceholders(body) {
  const nums = [];
  for (const m of String(body || '').matchAll(/\{\{(\d+)\}\}/g)) nums.push(Number(m[1]));
  return nums;
}
function templatePreview(t, samples) {
  let out = String(t.body || '');
  const vals = Array.isArray(samples) ? samples : (Array.isArray(t.sample_values) ? t.sample_values : []);
  out = out.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = vals[Number(n) - 1];
    return v !== undefined && v !== '' ? String(v) : '[مثال ' + n + ']';
  });
  return out;
}
function templateSendable(t, metaConfigured) {
  if (t.approval_status !== 'approved') return { sendable: false, reason: 'template_not_approved' };
  if (metaConfigured && t.meta_status !== 'approved') return { sendable: false, reason: 'template_not_meta_approved' };
  return { sendable: true, reason: null };
}
const HEADER_TYPES = ['text', 'image', 'video', 'document'];
function normalizeTemplateButtons(buttons) {
  if (!Array.isArray(buttons)) return [];
  return buttons.map((b) => {
    if (typeof b === 'string') return { type: 'QUICK_REPLY', title: b };
    if (b && typeof b === 'object') {
      const title = b.title || b.text || '';
      return { type: b.type || 'QUICK_REPLY', title: String(title), ...(b.url ? { url: b.url } : {}), ...(b.phone_number ? { phone_number: b.phone_number } : {}) };
    }
    return null;
  }).filter(Boolean);
}
function validateTemplateInput(body) {
  // Returns an error string, or null. Name/category/language are
  // immutable after creation and are validated by callers on create.
  if (body.body !== undefined && !String(body.body).trim()) return 'body is required';
  const b = body.body !== undefined ? String(body.body) : null;
  if (b !== null) {
    const nums = templatePlaceholders(b);
    const sorted = [...nums].sort((x, y) => x - y);
    for (let i = 0; i < sorted.length; i++) if (sorted[i] !== i + 1) return 'placeholders must be {{1}}, {{2}}, ... in sequence with no gaps or duplicates';
    // Note: starting/ending with a placeholder is discouraged by Meta guidance
    // but is NOT hard-rejected here, to keep existing templates valid.
  }
  if (body.header_type !== undefined && body.header_type !== null && !HEADER_TYPES.includes(body.header_type)) return 'header_type must be text, image, video or document';
  if (body.header_type === 'text' && (!body.header_text || !String(body.header_text).trim())) return 'header_text is required when header_type is text';
  if (body.footer !== undefined && body.footer !== null && String(body.footer).length > 60) return 'footer must be at most 60 characters';
  if (body.buttons !== undefined) {
    if (!Array.isArray(body.buttons) || body.buttons.length > 3) return 'buttons must be an array of at most 3';
    const norm = normalizeTemplateButtons(body.buttons);
    if (norm.length !== body.buttons.length) return 'each button needs a title';
    if (norm.some((x) => !x.title || String(x.title).length > 25)) return 'each button title must be at most 25 characters';
  }
  if (body.sample_values !== undefined && body.sample_values !== null) {
    if (!Array.isArray(body.sample_values) || body.sample_values.some((v) => typeof v !== 'string')) return 'sample_values must be an array of strings';
  }
  return null;
}
function templatePublic(t, metaConfigured) {
  const gate = templateSendable(t, metaConfigured);
  return { ...t, placeholders: templatePlaceholders(t.body), preview: templatePreview(t), sendable: gate.sendable, send_block_reason: gate.reason };
}

// ================= Stage B: automation execution + file upload =================
// Arabic normalisation for keyword matching: strip diacritics/tatweel,
// unify alef forms, ة/ى variants, collapse whitespace. Applied to BOTH the
// inbound text and the trigger value, so "عَقْد جديد" matches "عقد جديد".
// normalizeArabic now comes from ./automation.js.
function phoneForConversation(conv) {
  if (!conv) return null;
  if (conv.contract_id !== null && conv.contract_id !== undefined) {
    const c = db.contracts.find((x) => x.id === conv.contract_id);
    if (c) return conv.party === 'seller' ? c.seller_phone : c.buyer_phone;
  }
  return conv.phone || null;
}
function convAutomationState(conv) {
  if (!conv.automation_handed_off) conv.automation_handed_off = false;
  if (typeof conv.automation_unknown_count !== 'number') conv.automation_unknown_count = 0;
  if (!conv.automation_waiting) conv.automation_waiting = null;
  if (!Array.isArray(conv.labels)) conv.labels = [];
  if (!conv.automation_last_run) conv.automation_last_run = {};
  if (!Array.isArray(conv.automation_recent_runs)) conv.automation_recent_runs = [];
  return conv;
}
function automationLog(conv, workflow, outcome, details = {}) {
  const rec = { id: nextId(), conversation_id: conv ? conv.id : null, workflow_id: workflow ? workflow.id : null, workflow_kind: workflow ? workflow._kind || null : null, workflow_name: workflow ? workflow.name : null, outcome, details, created_at: new Date().toISOString() };
  db.automation_logs.push(rec);
  return rec;
}
// Business-hours check. trigger_value may be "HH:MM-HH:MM" (server local
// time); default 09:00-17:00. Handles overnight ranges (start > end).
// parseHoursRange/isBusinessHoursNow now come from ./automation.js.
function triggerKey(w) { return (w._kind || 'workflow') + ':' + w.id; }
// keywordMatchKind now comes from ./automation.js.
// --- Automation send (single place for the Stage A send gate) ---
// Returns {sent, dry_run, blocked_reason}. NEVER claims sent on dry-run.
async function automationSend(conv, spec) {
  const phone = phoneForConversation(conv);
  if (!phone) return { sent: false, dry_run: false, blocked_reason: 'no_phone' };
  if (db.killSwitch) return { sent: false, dry_run: false, blocked_reason: 'kill_switch_on' };
  const cfg = metaConfig();
  let metaPayload = null; let bodyText = null; let templateName = null; let mediaType = null;
  if (spec.kind === 'template') {
    const tpl = db.templates.find((t) => t.name === spec.template_name);
    if (!tpl) return { sent: false, dry_run: false, blocked_reason: 'template_not_found' };
    if (tpl.approval_status !== 'approved') return { sent: false, dry_run: false, blocked_reason: 'template_not_approved' };
    if (cfg.configured && tpl.meta_status !== 'approved') return { sent: false, dry_run: false, blocked_reason: 'template_not_meta_approved' };
    templateName = tpl.name;
    const components = [];
    if (Array.isArray(spec.parameters) && spec.parameters.length) components.push({ type: 'body', parameters: spec.parameters.map((v) => ({ type: 'text', text: String(v) })) });
    metaPayload = { messaging_product: 'whatsapp', to: phoneKey(phone), type: 'template', template: { name: tpl.name, language: { code: spec.language || tpl.language || 'ar' }, ...(components.length ? { components } : {}) } };
  } else if (spec.kind === 'buttons' || spec.kind === 'list') {
    if (!within24h(lastInboundAtForPhone(phone))) return { sent: false, dry_run: false, blocked_reason: 'outside_24h_window_use_template' };
    bodyText = spec.body || '';
    if (spec.kind === 'buttons') metaPayload = { messaging_product: 'whatsapp', to: phoneKey(phone), type: 'interactive', interactive: { type: 'button', body: { text: bodyText }, action: { buttons: (spec.buttons || []).slice(0, 3).map((b) => ({ type: 'reply', reply: { id: typeof b === 'string' ? b : (b.id || b.title), title: typeof b === 'string' ? b : b.title } })) } } };
    else metaPayload = { messaging_product: 'whatsapp', to: phoneKey(phone), type: 'interactive', interactive: { type: 'list', body: { text: bodyText }, action: { sections: [{ title: 'options', rows: (spec.items || []).slice(0, 10).map((it, i) => ({ id: 'row' + (i + 1), title: typeof it === 'string' ? it : it.title })) }] } } };
  } else if (spec.kind === 'media') {
    if (!within24h(lastInboundAtForPhone(phone))) return { sent: false, dry_run: false, blocked_reason: 'outside_24h_window_use_template' };
    mediaType = spec.media_type;
    if (!spec.media_id && !spec.media_link) return { sent: false, dry_run: false, blocked_reason: 'media_id_or_link_required' };
    bodyText = spec.caption || null;
    metaPayload = { messaging_product: 'whatsapp', to: phoneKey(phone), type: mediaType, [mediaType]: { ...(spec.media_link ? { link: spec.media_link } : { id: spec.media_id }), ...(spec.caption ? { caption: spec.caption } : {}) } };
  } else {
    if (!within24h(lastInboundAtForPhone(phone))) return { sent: false, dry_run: false, blocked_reason: 'outside_24h_window_use_template' };
    bodyText = spec.body || '';
    metaPayload = { messaging_product: 'whatsapp', to: phoneKey(phone), type: 'text', text: { body: bodyText } };
  }
  if (!cfg.configured) {
    const m = { id: nextId(), conversation_id: conv.id, direction: 'out', sender_phone: null, to_phone: normPhone(phone), body: bodyText, template_name: templateName, media_type: mediaType, wamid: null, meta_status: null, dry_run: true, automation: true, created_at: new Date().toISOString() };
    db.messages.push(m);
    audit('automation', 'message', m.id, 'automation_send_dry_run', { conversation_id: conv.id, template_name: templateName });
    return { sent: false, dry_run: true, message: m };
  }
  const r = await metaRequest('POST', `/${cfg.phoneId}/messages`, metaPayload);
  if (!r.ok) {
    audit('automation', 'whatsapp', 0, 'automation_send_failed', { conversation_id: conv.id, meta_error_code: r.meta_error_code || null });
    return { sent: false, dry_run: false, blocked_reason: 'meta_send_failed', meta_error_code: r.meta_error_code || null };
  }
  const wamid = r.data && r.data.messages && r.data.messages[0] ? r.data.messages[0].id : null;
  const m = { id: nextId(), conversation_id: conv.id, direction: 'out', sender_phone: null, to_phone: normPhone(phone), body: bodyText, template_name: templateName, media_type: mediaType, wamid, meta_status: 'sent', dry_run: false, automation: true, created_at: new Date().toISOString() };
  db.messages.push(m);
  audit('automation', 'message', m.id, 'automation_sent', { conversation_id: conv.id, wamid, template_name: templateName });
  return { sent: true, dry_run: false, message: m, wamid };
}
function stepText(s) { return s.content || s.text || s.body || s.question || s.caption || s.action_text || ''; }
function stepTemplateName(s) { return s.template_name || s.template || null; }
function stepMediaSpec(s) {
  const kind = ['image', 'video', 'audio', 'document'].includes(s.step_type) ? s.step_type : (s.media && s.media.type) || s.media_type || 'image';
  const media = s.media || {};
  return { kind: 'media', media_type: kind, media_link: s.media_url || s.link || media.link || null, media_id: s.media_id || media.id || null, caption: s.caption || s.body || null };
}
async function executeSteps(conv, workflow, steps, ctx) {
  // Returns 'done' | 'paused' | 'handoff' | 'blocked'. ctx carries the
  // latest inbound text for condition evaluation and a sends counter.
  const ordered = (steps || []).map((s, i) => ({ ...s, order: (typeof s.order === 'number' ? s.order : i) })).sort((a, b) => a.order - b.order);
  for (const s of ordered) {
    if (ctx.stepsDone >= AUTOMATION_MAX_STEPS_PER_RUN) { automationLog(conv, workflow, 'truncated_loop_guard', { max_steps: AUTOMATION_MAX_STEPS_PER_RUN }); return 'blocked'; }
    if (stepIsBanned(s) || hasBannedStep([s])) {
      automationLog(conv, workflow, 'blocked_money_step', { step_type: s.step_type || s.action || null });
      audit('automation', 'workflow', workflow.id, 'automation_rejected_money_step', { conversation_id: conv.id, step_type: s.step_type || s.action || null });
      return 'blocked';
    }
    ctx.stepsDone++;
    const t = s.step_type || s.action || s.type || '';
    if (t === 'end') { automationLog(conv, workflow, 'step_end', {}); return 'done'; }
    if (t === 'handoff' || t === 'human_handoff' || t === 'handover') {
      conv.automation_handed_off = true; conv.automation_waiting = null;
      automationLog(conv, workflow, 'handoff', { note: s.handover_note || s.note || null });
      audit('automation', 'conversation', conv.id, 'automation_handoff', { workflow_id: workflow.id });
      return 'handoff';
    }
    if (t === 'text' || t === 'send_text') {
      const r = await automationSend(conv, { kind: 'text', body: stepText(s) });
      ctx.sends += r.sent || r.dry_run ? 1 : 0;
      automationLog(conv, workflow, r.sent ? 'sent' : (r.dry_run ? 'dry_run' : 'send_blocked'), { step_type: t, blocked_reason: r.blocked_reason || null });
      if (r.blocked_reason === 'kill_switch_on') return 'blocked';
      continue;
    }
    if (t === 'template' || t === 'send_template') {
      const r = await automationSend(conv, { kind: 'template', template_name: stepTemplateName(s), parameters: s.parameters || s.sample_values || [] });
      ctx.sends += r.sent || r.dry_run ? 1 : 0;
      automationLog(conv, workflow, r.sent ? 'sent' : (r.dry_run ? 'dry_run' : 'send_blocked'), { step_type: t, template_name: stepTemplateName(s), blocked_reason: r.blocked_reason || null });
      if (r.blocked_reason === 'kill_switch_on') return 'blocked';
      continue;
    }
    if (t === 'image' || t === 'video' || t === 'audio' || t === 'document' || t === 'send_media' || t === 'media') {
      const r = await automationSend(conv, stepMediaSpec(s));
      ctx.sends += r.sent || r.dry_run ? 1 : 0;
      automationLog(conv, workflow, r.sent ? 'sent' : (r.dry_run ? 'dry_run' : 'send_blocked'), { step_type: t, blocked_reason: r.blocked_reason || null });
      if (r.blocked_reason === 'kill_switch_on') return 'blocked';
      continue;
    }
    if (t === 'buttons' || t === 'list') {
      const titles = t === 'buttons' ? (s.buttons || []) : (s.items || []);
      const r = await automationSend(conv, { kind: t, body: stepText(s), buttons: titles, items: titles });
      ctx.sends += r.sent || r.dry_run ? 1 : 0;
      automationLog(conv, workflow, r.sent ? 'sent' : (r.dry_run ? 'dry_run' : 'send_blocked'), { step_type: t, blocked_reason: r.blocked_reason || null });
      if (r.blocked_reason === 'kill_switch_on') return 'blocked';
      continue;
    }
    if (t === 'question_text' || t === 'question_number' || t === 'media_request' || t === 'ask_question' || t === 'question') {
      const r = await automationSend(conv, { kind: 'text', body: stepText(s) });
      ctx.sends += r.sent || r.dry_run ? 1 : 0;
      automationLog(conv, workflow, r.sent ? 'question_sent_waiting' : (r.dry_run ? 'question_dry_run_waiting' : 'send_blocked'), { step_type: t, blocked_reason: r.blocked_reason || null });
      if (r.blocked_reason === 'kill_switch_on') return 'blocked';
      // Wait for the customer's reply: store the NEXT step index. The
      // waiting pointer is set by runAutomation (it knows the index);
      // here we signal pause via ctx and the caller records it.
      ctx.pauseAfterIndex = ctx.currentIndex;
      return 'paused';
    }
    if (t === 'condition' || t === 'branch') {
      const cond = s.condition || {};
      const needle = s.if_contains || s.contains || cond.contains || cond.value_contains || null;
      const exact = s.if_equals || s.equals || cond.equals || null;
      let result = null;
      const normIn = normalizeArabic(ctx.inboundText || '');
      if (needle !== null && needle !== undefined) result = normIn.includes(normalizeArabic(needle));
      else if (exact !== null && exact !== undefined) result = normIn === normalizeArabic(exact);
      else { automationLog(conv, workflow, 'condition_unstructured_skipped', { condition_expr: s.condition_expr || null }); continue; }
      const branch = result ? (s.then || s.then_steps || s.branches || []) : (s.else || s.else_steps || []);
      const sub = await executeSteps(conv, workflow, branch, ctx);
      if (sub !== 'done') return sub;
      continue;
    }
    if (t === 'assign' || t === 'assign_conversation') {
      conv.assigned_to = s.assigned_to || s.assignee || s.value || conv.assigned_to;
      automationLog(conv, workflow, 'assigned', { assigned_to: conv.assigned_to });
      audit('automation', 'conversation', conv.id, 'automation_assigned', { workflow_id: workflow.id, assigned_to: conv.assigned_to });
      continue;
    }
    if (t === 'add_label' || t === 'label') {
      const label = s.label || s.value || stepText(s);
      if (label && !conv.labels.includes(label)) conv.labels.push(label);
      automationLog(conv, workflow, 'label_added', { label: label || null });
      continue;
    }
    if (t === 'add_note' || t === 'note' || t === 'internal_note') {
      const m = { id: nextId(), conversation_id: conv.id, direction: 'out', sender_name: 'automation', body: stepText(s) || null, template_name: null, is_internal_note: true, created_at: new Date().toISOString() };
      db.messages.push(m);
      automationLog(conv, workflow, 'note_added', { message_id: m.id });
      continue;
    }
    if (t === 'create_task' || t === 'task') {
      const task = { id: nextId(), contract_id: conv.contract_id || null, title: s.title || stepText(s) || 'مهمة من الأتمتة', type: 'automation', status: 'open', assigned_to: s.assigned_to || null, created_at: new Date().toISOString() };
      db.tasks.push(task);
      automationLog(conv, workflow, 'task_created', { task_id: task.id, title: task.title });
      audit('automation', 'task', task.id, 'automation_task_created', { workflow_id: workflow.id, conversation_id: conv.id });
      continue;
    }
    if (t === 'webhook_out' || t === 'webhook') {
      const target = s.url || s.webhook_url || null;
      if (!target) { automationLog(conv, workflow, 'webhook_skipped_no_url', {}); continue; }
      let ok = false; let statusCode = null;
      try {
        const u = new URL(target);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('unsupported protocol');
        const lib = u.protocol === 'http:' ? require('http') : require('https');
        const payload = JSON.stringify({ event: 'automation', conversation_id: conv.id, workflow_id: workflow.id, workflow_name: workflow.name });
        const res = await new Promise((resolve) => {
          const rq = lib.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 5000 }, (resp) => { resp.resume(); resp.on('end', () => resolve({ status: resp.statusCode })); });
          rq.on('timeout', () => { rq.destroy(); resolve({ status: null }); });
          rq.on('error', () => resolve({ status: null }));
          rq.write(payload); rq.end();
        });
        statusCode = res.status; ok = statusCode !== null && statusCode >= 200 && statusCode < 300;
      } catch { ok = false; }
      automationLog(conv, workflow, ok ? 'webhook_sent' : 'webhook_failed', { status: statusCode });
      continue;
    }
    if (t === 'delay') {
      const ms = typeof s.delay_ms === 'number' ? s.delay_ms : (typeof s.delay_seconds === 'number' ? s.delay_seconds * 1000 : 0);
      automationLog(conv, workflow, 'delay', { delay_ms: ms, waited_ms: Math.min(ms, 2000) });
      if (ms > 0) await new Promise((r) => setTimeout(r, Math.min(ms, 2000)));
      continue;
    }
    if (t === 'action') { automationLog(conv, workflow, 'action_logged', { action_text: s.action_text || null }); continue; }
    automationLog(conv, workflow, 'step_skipped_unknown', { step_type: t });
  }
  return 'done';
}
// Run one workflow/rule against one conversation. startIndex is used for
// ask-question continuations. Returns a result object; never throws.
async function runAutomation(conv, workflow, opts = {}) {
  convAutomationState(conv);
  const startIndex = opts.startIndex || 0;
  const steps = normaliseSteps(workflow.steps || []);
  if (db.killSwitch) {
    automationLog(conv, workflow, 'blocked_kill_switch', {});
    audit('automation', 'workflow', workflow.id, 'automation_blocked_kill_switch', { conversation_id: conv.id });
    save(); return { ran: false, blocked_reason: 'kill_switch_on' };
  }
  if (conv.automation_handed_off && !opts.manual) {
    automationLog(conv, workflow, 'blocked_handed_off', {});
    save(); return { ran: false, blocked_reason: 'handed_off' };
  }
  if (hasBannedStep(steps)) {
    automationLog(conv, workflow, 'blocked_money_step', {});
    audit('automation', 'workflow', workflow.id, 'automation_rejected_money_step', { conversation_id: conv.id });
    save(); return { ran: false, blocked_reason: 'money_step' };
  }
  if (!opts.manual && !opts.continuation) {
    const key = triggerKey(workflow);
    const last = conv.automation_last_run[key] ? Date.parse(conv.automation_last_run[key]) : 0;
    if (last && Date.now() - last < AUTOMATION_COOLDOWN_MS) {
      automationLog(conv, workflow, 'blocked_cooldown', { cooldown_ms: AUTOMATION_COOLDOWN_MS });
      save(); return { ran: false, blocked_reason: 'cooldown' };
    }
    const now = Date.now();
    conv.automation_recent_runs = (conv.automation_recent_runs || []).filter((x) => now - Date.parse(x) < 60 * 1000);
    if (conv.automation_recent_runs.length >= AUTOMATION_MAX_RUNS_PER_MINUTE) {
      automationLog(conv, workflow, 'blocked_loop_guard', { max_runs_per_minute: AUTOMATION_MAX_RUNS_PER_MINUTE });
      save(); return { ran: false, blocked_reason: 'loop_guard' };
    }
    conv.automation_recent_runs.push(new Date().toISOString());
  }
  conv.automation_last_run[triggerKey(workflow)] = new Date().toISOString();
  const ctx = { inboundText: opts.inboundText || '', stepsDone: 0, sends: 0, currentIndex: startIndex, pauseAfterIndex: null };
  // executeSteps iterates its own ordered copy; to support pause/resume
  // we run the slice from startIndex and translate pause back to an
  // absolute index via stepsDone counting (pause is only set by an
  // ask-question step, which is the last executed step in that slice).
  const slice = steps.slice(startIndex);
  // Track pause: wrap executeSteps so a pause returns the absolute index.
  let outcome = 'done';
  outcome = await executeSteps(conv, workflow, slice, ctx);
  if (outcome === 'paused') {
    // The ask-question step was the last executed step in the slice.
    const absIndex = startIndex + ctx.stepsDone - 1;
    conv.automation_waiting = { workflow_id: workflow.id, workflow_kind: workflow._kind || 'workflow', next_index: absIndex + 1, set_at: new Date().toISOString() };
    automationLog(conv, workflow, 'waiting_for_reply', { next_index: absIndex + 1 });
  } else {
    if (conv.automation_waiting && conv.automation_waiting.workflow_id === workflow.id) conv.automation_waiting = null;
    automationLog(conv, workflow, outcome === 'handoff' ? 'completed_handoff' : (outcome === 'blocked' ? 'completed_blocked' : 'completed'), { steps_done: ctx.stepsDone, sends: ctx.sends });
  }
  audit('automation', 'workflow', workflow.id, 'automation_run', { conversation_id: conv.id, outcome, steps_done: ctx.stepsDone, sends: ctx.sends });
  save();
  return { ran: true, outcome, steps_done: ctx.stepsDone, sends: ctx.sends };
}
function allAutomationCandidates() {
  const list = [];
  for (const w of db.workflows) if (w.is_active !== false) list.push({ ...w, _kind: 'workflow' });
  for (const r of db.rules) if (r.is_active) list.push({ ...r, _kind: 'rule' });
  return list;
}
// Inbound routing: continuation first, then exact keyword > contains
// keyword (longest wins) > button/list reply > first message >
// business-hours/away > fallback after 2 unknowns.
async function runInboundAutomation(conv, inbound) {
  convAutomationState(conv);
  const candidates = allAutomationCandidates();
  // Waiting continuation: any new inbound resumes the waiting flow.
  if (conv.automation_waiting) {
    const w = candidates.find((x) => x.id === conv.automation_waiting.workflow_id && x._kind === (conv.automation_waiting.workflow_kind || 'workflow'));
    if (w && !conv.automation_handed_off) {
      const next = conv.automation_waiting.next_index;
      conv.automation_waiting = null;
      conv.automation_unknown_count = 0;
      return runAutomation(conv, w, { continuation: true, startIndex: next, inboundText: inbound.text || '' });
    }
    conv.automation_waiting = null;
  }
  if (conv.automation_handed_off) return { ran: false, blocked_reason: 'handed_off' };
  if (db.killSwitch) {
    const any = candidates.length > 0;
    if (any) { automationLog(conv, null, 'blocked_kill_switch', {}); audit('automation', 'conversation', conv.id, 'automation_blocked_kill_switch', {}); save(); }
    return { ran: false, blocked_reason: 'kill_switch_on' };
  }
  const normIn = normalizeArabic(inbound.text || '');
  const exact = [], contains = [], buttons = [], firsts = [], hours = [];
  for (const w of candidates) {
    const tt = w.trigger_type;
    if (tt === 'keyword') {
      const k = keywordMatchKind(w.trigger_value, normIn);
      if (k === 'exact') exact.push(w);
      else if (k === 'contains') contains.push(w);
    } else if (tt === 'button_reply' || tt === 'interactive_reply' || tt === 'list_reply') {
      if (inbound.interactive) {
        const tv = normalizeArabic(w.trigger_value);
        if (tv && (normalizeArabic(inbound.interactive.title) === tv || normalizeArabic(inbound.interactive.id) === tv || normalizeArabic(inbound.interactive.title).includes(tv))) buttons.push(w);
      }
    } else if (tt === 'first_message' || tt === 'first') {
      if (inbound.isFirst) firsts.push(w);
    } else if (tt === 'business_hours') {
      if (isBusinessHoursNow(w.trigger_value)) hours.push(w);
    } else if (tt === 'away') {
      if (!isBusinessHoursNow(w.trigger_value)) hours.push(w);
    }
  }
  const byLength = (a, b) => normalizeArabic(b.trigger_value || '').length - normalizeArabic(a.trigger_value || '').length;
  exact.sort(byLength); contains.sort(byLength);
  const winner = exact[0] || contains[0] || buttons[0] || firsts[0] || hours[0] || null;
  if (winner) {
    conv.automation_unknown_count = 0;
    return runAutomation(conv, winner, { inboundText: inbound.text || '' });
  }
  // No match: count unknowns; fallback fires on the 2nd unknown.
  conv.automation_unknown_count += 1;
  if (conv.automation_unknown_count >= 2) {
    const fallbacks = candidates.filter((w) => w.trigger_type === 'fallback');
    conv.automation_unknown_count = 0;
    if (fallbacks.length) return runAutomation(conv, fallbacks[0], { inboundText: inbound.text || '' });
    save(); return { ran: false, blocked_reason: 'no_fallback' };
  }
  save(); return { ran: false, blocked_reason: 'no_match' };
}
async function runContractEventAutomation(contract, newState) {
  const convs = db.conversations.filter((c) => c.contract_id === contract.id);
  const results = [];
  for (const conv of convs) {
    convAutomationState(conv);
    if (conv.automation_handed_off) continue;
    for (const w of allAutomationCandidates()) {
      const tt = w.trigger_type;
      if (tt !== 'contract_event' && tt !== 'contract-event') continue;
      const tv = String(w.trigger_value || '').trim();
      if (tv !== newState && tv !== 'state:' + newState) continue;
      results.push(await runAutomation(conv, w, { inboundText: '' }));
    }
  }
  return results;
}
// --- File upload helpers (Node built-ins only) ---
// sanitizeFilename now comes from ./media.js.
function parseMultipart(buffer, boundary) {
  const fields = {}; const files = [];
  const sep = Buffer.from('--' + boundary);
  let idx = 0;
  while (true) {
    const start = buffer.indexOf(sep, idx);
    if (start === -1) break;
    let pos = start + sep.length;
    if (buffer.slice(pos, pos + 2).toString() === '--') break;
    if (buffer.slice(pos, pos + 2).toString() === '\r\n') pos += 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', pos);
    if (headerEnd === -1) break;
    const headers = buffer.slice(pos, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const dataEnd = buffer.indexOf(sep, dataStart);
    if (dataEnd === -1) break;
    let data = buffer.slice(dataStart, dataEnd);
    if (data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10) data = data.slice(0, data.length - 2);
    const nameMatch = headers.match(/name="([^"]*)"/);
    const fileMatch = headers.match(/filename="([^"]*)"/);
    const typeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    if (fileMatch) files.push({ fieldname: nameMatch ? nameMatch[1] : 'file', filename: fileMatch[1], mime: typeMatch ? typeMatch[1].trim() : 'application/octet-stream', data });
    else if (nameMatch) fields[nameMatch[1]] = data.toString('utf8');
    idx = dataEnd;
  }
  return { fields, files };
}
// Upload a local file buffer to Meta to obtain a media ID (multipart,
// built by hand — no dependency). Returns {ok, media_id} or {ok:false}.
function metaUploadMedia(buffer, filename, mime) {
  return new Promise((resolve) => {
    const cfg = metaConfig();
    const boundary = '----PilotMedia' + crypto.randomBytes(8).toString('hex');
    const parts = [];
    const field = (name, value) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    field('messaging_product', 'whatsapp');
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`));
    parts.push(buffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const bodyBuf = Buffer.concat(parts);
    let url;
    try { url = new URL(`${cfg.base}/${cfg.version}/${cfg.phoneId}/media`); } catch { return resolve({ ok: false, error: 'meta request failed' }); }
    const lib = url.protocol === 'http:' ? require('http') : require('https');
    const headers = { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': bodyBuf.length };
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    const rq = lib.request(url, { method: 'POST', headers, timeout: 30000 }, (resp) => {
      let data = '';
      resp.on('data', (c) => { data += c; });
      resp.on('end', () => {
        let parsed = null; try { parsed = data ? JSON.parse(data) : null; } catch {}
        if (resp.statusCode >= 200 && resp.statusCode < 300 && parsed && parsed.id) resolve({ ok: true, media_id: parsed.id });
        else resolve({ ok: false, ...metaErrorInfo(parsed) });
      });
    });
    rq.on('timeout', () => { rq.destroy(); resolve({ ok: false, error: 'meta upload timed out' }); });
    rq.on('error', () => resolve({ ok: false, error: 'meta upload failed' }));
    rq.write(bodyBuf); rq.end();
  });
}
// publicUpload now comes from ./media.js.
async function handleWhatsAppUpload(req, res, p, user, actor) {
  const forbidden = () => send(res, 403, { error: 'forbidden — لا صلاحية لديك لعرض هذا القسم' }, p);
  if (!can(user, 'whatsapp', 'edit')) return forbidden();
  const ct = req.headers['content-type'] || '';
  const bm = ct.match(/multipart\/form-data;\s*boundary=(.+)/);
  if (!bm) return send(res, 400, { error: 'content-type must be multipart/form-data' }, p);
  const boundary = bm[1].replace(/^"|"$/g, '');
  const { raw, tooLarge } = await readRawBody(req, UPLOAD_MAX_BYTES + 1024 * 1024);
  if (tooLarge) return send(res, 413, { error: 'upload too large (max 16 MB file)' }, p);
  const { fields, files } = parseMultipart(raw, boundary);
  const file = files[0];
  if (!file) return send(res, 400, { error: 'file is required' }, p);
  if (file.data.length > UPLOAD_MAX_BYTES) return send(res, 413, { error: 'file too large (max 16 MB)' }, p);
  if (file.data.length === 0) return send(res, 400, { error: 'file is empty' }, p);
  const sanitized = sanitizeFilename(file.filename);
  const ext = '.' + sanitized.split('.').pop().toLowerCase();
  const allowed = UPLOAD_ALLOWED[ext];
  if (!allowed) return send(res, 400, { error: 'unsupported file type' }, p);
  // MIME must match the extension family (prevents renaming an .exe to .png).
  const mimeFamily = allowed.mime.split('/')[0];
  if (file.mime.split('/')[0] !== mimeFamily && !(allowed.kind === 'document' && ['application', 'text'].includes(file.mime.split('/')[0]))) {
    return send(res, 400, { error: 'unsupported file type (mime does not match extension)' }, p);
  }
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
  const stored = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-' + sanitized;
  const fullPath = path.join(UPLOAD_DIR, stored);
  fs.writeFileSync(fullPath, file.data);
  let conv = null; let phone = null;
  if (fields.conversation_id) conv = db.conversations.find((c) => c.id === Number(fields.conversation_id)) || null;
  if (fields.to) { phone = fields.to; if (!conv) conv = conversationForPhone(phone, true); }
  if (conv && !phone) phone = phoneForConversation(conv);
  const rec = { id: nextId(), sanitized_filename: sanitized, stored_filename: stored, mime_type: allowed.mime, kind: allowed.kind, size_bytes: file.data.length, media_id: null, conversation_id: conv ? conv.id : null, uploaded_by: actor, dry_run: false, created_at: new Date().toISOString() };
  db.uploads.push(rec);
  const sendRequested = !!(phone || conv);
  if (sendRequested) {
    if (db.killSwitch) { try { fs.unlinkSync(fullPath); } catch {} db.uploads = db.uploads.filter((x) => x.id !== rec.id); audit(actor, 'whatsapp_upload', rec.id, 'whatsapp_upload_blocked_kill_switch', {}); save(); return send(res, 400, { error: 'kill_switch_on — الإرسال موقوف بمفتاح الإيقاف' }, p); }
    if (!within24h(lastInboundAtForPhone(phone))) {
      // File is KEPT (it can be sent later by media ID or after a template
      // re-opens the window); only the send is refused now.
      audit(actor, 'whatsapp_upload', rec.id, 'whatsapp_upload_kept_window_closed', { conversation_id: conv ? conv.id : null }); save();
      return send(res, 400, { error: 'outside_24h_window_use_template', upload: publicUpload(rec) }, p);
    }
  }
  const cfg = metaConfig();
  if (cfg.configured) {
    const up = await metaUploadMedia(file.data, sanitized, allowed.mime);
    if (!up.ok) {
      audit(actor, 'whatsapp_upload', rec.id, 'whatsapp_media_upload_failed', { meta_error_code: up.meta_error_code || null }); save();
      return send(res, 502, { ok: false, error: up.error || 'meta upload failed', meta_error_code: up.meta_error_code || null, upload: publicUpload(rec) }, p);
    }
    rec.media_id = up.media_id;
    if (sendRequested) {
      const r = await metaRequest('POST', `/${cfg.phoneId}/messages`, { messaging_product: 'whatsapp', to: phoneKey(phone), type: allowed.kind, [allowed.kind]: { id: up.media_id, ...(fields.caption ? { caption: fields.caption } : {}) } });
      if (!r.ok) { audit(actor, 'whatsapp_upload', rec.id, 'whatsapp_media_send_failed', { meta_error_code: r.meta_error_code || null }); save(); return send(res, 502, { ok: false, error: r.error || 'meta request failed', meta_error_code: r.meta_error_code || null, upload: publicUpload(rec) }, p); }
      const wamid = r.data && r.data.messages && r.data.messages[0] ? r.data.messages[0].id : null;
      const m = { id: nextId(), conversation_id: conv.id, direction: 'out', sender_phone: null, to_phone: normPhone(phone), body: fields.caption || null, template_name: null, media_type: allowed.kind, media_id: up.media_id, wamid, meta_status: 'sent', dry_run: false, created_at: new Date().toISOString() };
      db.messages.push(m); audit(actor, 'message', m.id, 'whatsapp_media_sent', { conversation_id: conv.id, wamid, upload_id: rec.id }); save();
      return send(res, 200, { ok: true, dry_run: false, configured: true, wamid, upload: publicUpload(rec), message: m }, p);
    }
    audit(actor, 'whatsapp_upload', rec.id, 'whatsapp_media_uploaded', { media_id: up.media_id }); save();
    return send(res, 201, { ok: true, dry_run: false, configured: true, upload: publicUpload(rec) }, p);
  }
  // Dry-run: file stored locally, message recorded locally, never claimed sent.
  rec.dry_run = true;
  if (sendRequested && conv) {
    const m = { id: nextId(), conversation_id: conv.id, direction: 'out', sender_phone: null, to_phone: normPhone(phone), body: fields.caption || null, template_name: null, media_type: allowed.kind, media_id: null, wamid: null, meta_status: null, dry_run: true, created_at: new Date().toISOString() };
    db.messages.push(m); audit(actor, 'message', m.id, 'whatsapp_media_send_dry_run', { conversation_id: conv.id, upload_id: rec.id }); save();
    return send(res, 200, { ok: true, dry_run: true, configured: false, upload: publicUpload(rec), message: m }, p);
  }
  audit(actor, 'whatsapp_upload', rec.id, 'whatsapp_media_stored_dry_run', {}); save();
  return send(res, 201, { ok: true, dry_run: true, configured: false, upload: publicUpload(rec) }, p);
}

function seedTemplates() {
  let changed = false;
  if (!db.templates.length) {
    const names = ['contract_created','invite_accept','contract_accepted','payment_request','payment_confirmed_fi','preparing','delivery_confirmed','transaction_closed','dispute_opened','handover_support'];
    names.forEach((n) => db.templates.push({ id: nextId(), name: n, label_ar: TEMPLATE_LABELS_AR[n] || n, language: 'ar', category: 'UTILITY', body: null, header_type: null, header_text: null, header_link: null, footer: null, buttons: [], sample_values: [], approval_status: 'pending', meta_status: 'not_submitted', meta_template_id: null, rejection_reason: null }));
    changed = true;
  } else {
    for (const t of db.templates) {
      if (!t.label_ar && TEMPLATE_LABELS_AR[t.name]) { t.label_ar = TEMPLATE_LABELS_AR[t.name]; changed = true; }
      // meta_status is Meta's view of the template; approval_status stays
      // the local (manual) field. Never overwrite one with the other.
      if (!t.meta_status) { t.meta_status = 'not_submitted'; changed = true; }
      if (t.header_type === undefined) { t.header_type = null; changed = true; }
      if (t.header_text === undefined) { t.header_text = null; changed = true; }
      if (t.header_link === undefined) { t.header_link = null; changed = true; }
      if (t.footer === undefined) { t.footer = null; changed = true; }
      if (t.sample_values === undefined) { t.sample_values = []; changed = true; }
      if (t.meta_template_id === undefined) { t.meta_template_id = null; changed = true; }
      if (t.rejection_reason === undefined) { t.rejection_reason = null; changed = true; }
      if (!Array.isArray(t.buttons)) { t.buttons = []; changed = true; }
    }
  }
  if (changed) save();
}
seedTemplates();

// Primary admin seeding: FIRST START ONLY, and only when BOTH env vars
// are set. No credential is ever hardcoded or written to any file.
function seedPrimaryAdmin() {
  if (db.users.length) return;
  const email = normEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password) return;
  if (!EMAIL_RE.test(email) || password.length < 8) {
    console.warn('WARNING: ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD are set but invalid (email shape or password under 8 chars) — primary admin was NOT seeded.');
    return;
  }
  const u = {
    id: nextId(), full_name: 'Primary Admin', email, role: 'owner',
    department: 'Administration', sections: [...SECTIONS],
    actions: Object.fromEntries(SECTIONS.map((s) => [s, ['view','create','edit','approve','manage']])),
    password_hash: hashPassword(password), is_primary_admin: true, is_active: true,
    created_at: new Date().toISOString(),
  };
  db.users.push(u);
  audit('system', 'user', u.id, 'primary_admin_seeded', { email: u.email, role: 'owner' });
  console.log('Primary admin seeded from environment (first start).');
}
seedPrimaryAdmin();

const GENERIC_LOGIN_ERROR = 'invalid email or password';

// Single source of truth for the 7-step linking wizard: server-computed
// booleans only, no secret values. Used by /api/whatsapp/status AND
// /api/whatsapp/linking (the one wizard); the old 10-step checklist
// endpoint now only redirects to this one.
function computeWizardSteps() {
  const cfg = metaConfig();
  const verify = !!process.env.WHATSAPP_VERIFY_TOKEN;
  const hmac = !!process.env.WHATSAPP_APP_SECRET;
  const metaConfigured = cfg.configured;
  return [
    { key: 'meta_business', title_ar: 'حساب Meta Business', status: cfg.wabaId ? 'done' : 'pending' },
    { key: 'dedicated_number', title_ar: 'رقم مخصص للخدمة', status: cfg.phoneId ? 'done' : 'pending' },
    { key: 'env_vars', title_ar: 'متغيرات البيئة', status: (verify && hmac && metaConfigured) ? 'done' : 'pending' },
    { key: 'webhook', title_ar: 'تحقق Webhook', status: (verify && hmac) ? 'done' : 'pending' },
    { key: 'meta_connection', title_ar: 'اختبار اتصال Meta', status: metaConfigured ? 'pending' : 'blocked' },
    { key: 'templates', title_ar: 'اعتماد القوالب لدى Meta', status: db.templates.some((t) => t.meta_status === 'approved') ? 'done' : (metaConfigured ? 'pending' : 'blocked') },
    { key: 'test_message', title_ar: 'رسالة اختبار', status: metaConfigured ? 'pending' : 'blocked' },
  ];
}
function linkingPayload() {
  const cfg = metaConfig();
  const steps = computeWizardSteps();
  return {
    steps,
    done: steps.filter((x) => x.status === 'done').length,
    blocked: steps.filter((x) => x.status === 'blocked').length,
    configured: cfg.configured,
    webhook_verify_configured: !!process.env.WHATSAPP_VERIFY_TOKEN,
    webhook_hmac_configured: !!process.env.WHATSAPP_APP_SECRET,
    whatsapp_access_configured: !!cfg.token,
    phone_number_configured: !!cfg.phoneId,
    waba_configured: !!cfg.wabaId,
    api_version: cfg.version,
    app_base_url: process.env.APP_BASE_URL || null,
    webhook_url: (process.env.APP_BASE_URL ? String(process.env.APP_BASE_URL).replace(/\/$/, '') : null) ? String(process.env.APP_BASE_URL).replace(/\/$/, '') + '/api/whatsapp/webhook' : null,
    embedded_signup: { configured: cfg.embeddedConfigured, app_id_configured: cfg.embedded.app_id_configured, config_id_configured: cfg.embedded.config_id_configured, app_secret_configured: cfg.embedded.app_secret_configured },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // Static frontend (defensive: never crash when the file is absent).
  if (p === '/' || p === '/index.html') {
    for (const dir of [FRONTEND_DIR, FRONTEND_FALLBACK]) {
      try {
        const html = fs.readFileSync(path.join(dir, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...securityHeaders(p) });
        return res.end(html);
      } catch {}
    }
    return send(res, 404, { error: 'frontend not found' }, p);
  }
  if (p === '/health') return send(res, 200, { ok: true, service: 'pilot-system', states: STATES }, p);

  // WhatsApp webhook: POST inbound (public by design) — handled BEFORE
  // any generic body parsing so the HMAC is verified over raw bytes.
  if (p === '/api/whatsapp/webhook' && req.method === 'POST') {
    const secret = process.env.WHATSAPP_APP_SECRET || '';
    // When no app secret is configured, unsigned traffic is refused
    // outright rather than accepted as if it were a customer message.
    if (!secret) return send(res, 401, { error: 'webhook signature not configured' }, p);
    const { raw, tooLarge } = await readRawBody(req, WEBHOOK_MAX_BODY_BYTES);
    if (tooLarge) return send(res, 413, { error: 'webhook body too large (max 5 MB)' }, p);
    const sig = req.headers['x-hub-signature-256'];
    if (!sig || typeof sig !== 'string' || !sig.startsWith('sha256=')) return send(res, 401, { error: 'missing or malformed signature' }, p);
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (!safeEqualStr(sig, expected)) return send(res, 401, { error: 'bad signature' }, p);
    let envelope;
    try { envelope = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'invalid JSON' }, p); }
    // Envelope validation: invalid envelopes are rejected, never stored.
    if (!envelope || envelope.object !== 'whatsapp_business_account' || !Array.isArray(envelope.entry)) {
      return send(res, 400, { error: 'invalid webhook envelope' }, p);
    }
    let inCount = 0, statusCount = 0, templateCount = 0;
    for (const entry of envelope.entry) {
      if (!entry || !Array.isArray(entry.changes)) continue;
      for (const change of entry.changes) {
        if (!change) continue;
        try {
          const value = change.value || {};
          // Template status updates (field-based).
          if (change.field === 'message_template_status_update' && value.message_template_name) {
            const mapped = mapMetaTemplateStatus(value.event || value.status);
            const tpl = db.templates.find((t) => t.name === value.message_template_name);
            if (tpl && mapped) {
              tpl.meta_status = mapped;
              if (mapped === 'rejected' && (value.reason || value.rejected_reason)) tpl.rejection_reason = String(value.reason || value.rejected_reason).slice(0, 500);
              if (mapped === 'approved') tpl.rejection_reason = null;
              templateCount++;
              audit('whatsapp-webhook', 'template', tpl.id, 'whatsapp_template_status', { meta_status: mapped, event: value.event || null });
            }
            continue;
          }
          // Inbound messages.
          if (Array.isArray(value.messages)) {
            for (const m of value.messages) {
              if (!m || !m.id || !m.from) continue;
              if (db.messages.some((x) => x.wamid === m.id)) continue; // dedup on wamid
              const conv = conversationForPhone(m.from, true);
              // Stage B: first-message detection must use the count BEFORE
              // this message is stored.
              const priorInbound = db.messages.filter((x) => x.conversation_id === conv.id && x.direction === 'in').length;
              let text = null, mediaType = null, mediaId = null, mediaCaption = null, mediaFilename = null, interactive = null;
              if (m.type === 'text') text = (m.text && m.text.body) || null;
              else if (['image', 'video', 'audio', 'document'].includes(m.type)) {
                mediaType = m.type;
                mediaId = (m[m.type] && m[m.type].id) || null;
                mediaCaption = (m[m.type] && m[m.type].caption) || null;
                mediaFilename = (m[m.type] && m[m.type].filename) || null;
                text = mediaCaption || `[${m.type}]`;
              } else if (m.type === 'interactive') {
                const r = m.interactive || {};
                const rep = r.button_reply || r.list_reply || {};
                interactive = { id: rep.id || null, title: rep.title || null };
                text = rep.title || '[interactive]';
              } else if (m.type === 'sticker') { mediaType = 'sticker'; text = '[sticker]'; }
              else continue; // unknown message type: ignore safely
              const ts = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
              const msg = { id: nextId(), conversation_id: conv.id, direction: 'in', sender_phone: normPhone(m.from), body: text, media_type: mediaType, media_id: mediaId, media_caption: mediaCaption, media_filename: mediaFilename, interactive_reply_id: interactive ? interactive.id : null, interactive_reply_title: interactive ? interactive.title : null, wamid: m.id, meta_status: null, created_at: ts };
              db.messages.push(msg);
              conv.unread_count = (conv.unread_count || 0) + 1;
              conv.last_inbound_at = ts;
              inCount++;
              audit('whatsapp-webhook', 'message', msg.id, 'whatsapp_inbound', { conversation_id: conv.id, wamid: m.id, type: m.type });
              // Stage B: execute automation on this inbound (awaited, so
              // the webhook response reflects the automation outcome and
              // tests see the outbound message immediately after).
              try { await runInboundAutomation(conv, { text, isFirst: priorInbound === 0, interactive, type: m.type }); } catch { /* automation never fails the webhook */ }
            }
          }
          // Delivery/read/failed statuses for outbound messages.
          if (Array.isArray(value.statuses)) {
            for (const s of value.statuses) {
              if (!s || !s.id) continue;
              const mapped = mapMetaStatus(s.status);
              if (!mapped) continue;
              const out = db.messages.find((x) => x.wamid === s.id && x.direction === 'out');
              if (!out) continue;
              const curRank = META_STATUS_RANK[out.meta_status] || 0;
              if (mapped === 'failed' || META_STATUS_RANK[mapped] >= curRank) {
                out.meta_status = mapped; statusCount++;
                audit('whatsapp-webhook', 'message', out.id, 'whatsapp_status', { wamid: s.id, meta_status: mapped });
              }
            }
          }
          // Other value types (phone_number_quality_update, etc.): ignored safely.
        } catch { continue; } // one malformed change never fails the whole webhook
      }
    }
    save();
    return send(res, 200, { ok: true, messages: inCount, statuses: statusCount, templates: templateCount }, p);
  }

  // Stage B file upload: raw multipart body, handled BEFORE the JSON
  // body parser (which would discard the file). Auth is verified here
  // with the same token check as the /api block below.
  if (p === '/api/whatsapp/upload' && req.method === 'POST') {
    const auth = req.headers.authorization || '';
    const mm = auth.match(/^Bearer\s+(.+)$/);
    const payload = mm ? verifyToken(mm[1]) : null;
    const upUser = payload ? db.users.find((u) => u.id === payload.sub) : null;
    if (!upUser || upUser.is_active === false) return send(res, 401, { error: 'unauthorized' }, p);
    return handleWhatsAppUpload(req, res, p, upUser, upUser.email);
  }
  // Stage B media download (binary, not JSON): same pre-JSON handling.
  const uploadDownloadMatch = p.match(/^\/api\/whatsapp\/uploads\/(\d+)\/download$/);
  if (uploadDownloadMatch && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    const mm = auth.match(/^Bearer\s+(.+)$/);
    const payload = mm ? verifyToken(mm[1]) : null;
    const upUser = payload ? db.users.find((u) => u.id === payload.sub) : null;
    if (!upUser || upUser.is_active === false) return send(res, 401, { error: 'unauthorized' }, p);
    if (!can(upUser, 'whatsapp', 'view')) return send(res, 403, { error: 'forbidden — لا صلاحية لديك لعرض هذا القسم' }, p);
    const rec = db.uploads.find((x) => x.id === Number(uploadDownloadMatch[1]));
    if (!rec) return send(res, 404, { error: 'upload not found' }, p);
    const fullPath = path.join(UPLOAD_DIR, path.basename(rec.stored_filename));
    if (!fullPath.startsWith(UPLOAD_DIR)) return send(res, 400, { error: 'invalid path' }, p);
    try {
      const data = fs.readFileSync(fullPath);
      res.writeHead(200, { 'Content-Type': rec.mime_type || 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + rec.sanitized_filename.replace(/"/g, '') + '"', ...securityHeaders(p) });
      return res.end(data);
    } catch { return send(res, 404, { error: 'file not found on disk' }, p); }
  }

  const hasBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
  const body = hasBody ? await readBody(req) : {};
  if (body && body.__tooLarge) return send(res, 413, { error: 'request body too large (max 1 MB)' }, p);

  // WhatsApp webhook: GET verification (unchanged handshake).
  if (p === '/api/whatsapp/webhook' && req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode'), token = url.searchParams.get('hub.verify_token'), challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) { res.writeHead(200, securityHeaders(p)); return res.end(challenge); }
    return send(res, 403, { error: 'webhook verification failed' }, p);
  }

  // ---- Auth: login is public; every other /api route needs a token ----
  if (p === '/api/auth/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (loginBlocked(ip)) return send(res, 429, { error: 'too many login attempts, try again later' }, p);
    const email = normEmail(body.email);
    const user = db.users.find((u) => u.email === email);
    // One generic error for every failure: unknown user, wrong password,
    // disabled account and missing fields are indistinguishable.
    if (!body.password || !user || user.is_active === false || !verifyPassword(body.password, user.password_hash)) {
      recordLoginFailure(ip);
      audit('auth', 'user', user ? user.id : 0, 'login_failed', { email });
      return send(res, 401, { error: GENERIC_LOGIN_ERROR }, p);
    }
    clearLoginFailures(ip);
    audit(user.email, 'user', user.id, 'login_success');
    return send(res, 200, { token: signToken(user), user: publicUser(user) }, p);
  }
  if (p.startsWith('/api/')) {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    const payload = m ? verifyToken(m[1]) : null;
    const user = payload ? db.users.find((u) => u.id === payload.sub) : null;
    if (!user || user.is_active === false) return send(res, 401, { error: 'unauthorized' }, p);
    req.user = user;
    const actor = user.email;
    const forbidden = () => send(res, 403, { error: 'forbidden — لا صلاحية لديك لعرض هذا القسم' }, p);

    // ---- Auth self-service ----
    if (p === '/api/auth/me' && req.method === 'GET') return send(res, 200, publicUser(user), p);
    if (p === '/api/auth/change-password' && req.method === 'POST') {
      if (!body.current_password || !verifyPassword(body.current_password, user.password_hash)) return send(res, 400, { error: GENERIC_LOGIN_ERROR }, p);
      if (!body.new_password || body.new_password.length < 8) return send(res, 400, { error: 'new password must be at least 8 characters' }, p);
      user.password_hash = hashPassword(body.new_password);
      audit(actor, 'user', user.id, 'password_changed'); return send(res, 200, { ok: true }, p);
    }
    if (p === '/api/departments' && req.method === 'GET') {
      return send(res, 200, DEPARTMENTS.map((d) => ({ key: d, label_ar: DEPARTMENT_AR[d] })), p);
    }
    if (p === '/api/whatsapp/status' && req.method === 'GET') {
      if (!can(user, 'whatsapp', 'view')) return forbidden();
      const cfg = metaConfig();
      const verify = !!process.env.WHATSAPP_VERIFY_TOKEN;
      const hmac = !!process.env.WHATSAPP_APP_SECRET;
      const metaConfigured = cfg.configured;
      // Wizard steps: server-computed, booleans only, no secret values.
      // 'blocked' = cannot proceed until Meta is configured at all.
      const wizardSteps = computeWizardSteps();
      return send(res, 200, {
        // health is now computed (Meta fully configured), not hardcoded.
        health: metaConfigured,
        webhook_verify_configured: verify,
        webhook_hmac_configured: hmac,
        whatsapp_access_configured: !!cfg.token,
        phone_number_configured: !!cfg.phoneId,
        waba_configured: !!cfg.wabaId,
        api_version: cfg.version,
        meta_configured: metaConfigured,
        embedded_signup: { configured: cfg.embeddedConfigured, app_id_configured: cfg.embedded.app_id_configured, config_id_configured: cfg.embedded.config_id_configured, app_secret_configured: cfg.embedded.app_secret_configured },
        templates_total: db.templates.length,
        templates_approved: db.templates.filter((t) => t.approval_status === 'approved').length,
        templates_meta_approved: db.templates.filter((t) => t.meta_status === 'approved').length,
        wizard_steps: wizardSteps,
      }, p);
    }

    // ---- Meta WhatsApp: test-token / send / templates (whatsapp:edit) ----
    // All Meta actions are audited. No token value is ever returned.
    if (p === '/api/whatsapp/test-token' && req.method === 'POST') {
      if (!can(user, 'whatsapp', 'edit')) return forbidden();
      const cfg = metaConfig();
      if (!cfg.configured) {
        audit(actor, 'whatsapp', 0, 'whatsapp_test_token_dry_run');
        return send(res, 200, { ok: true, configured: false, meta_ok: false, dry_run: true }, p);
      }
      const r = await metaRequest('GET', '/me', null);
      if (r.ok) {
        audit(actor, 'whatsapp', 0, 'whatsapp_test_token', { meta_ok: true });
        return send(res, 200, { ok: true, configured: true, meta_ok: true, dry_run: false }, p);
      }
      audit(actor, 'whatsapp', 0, 'whatsapp_test_token_failed', { meta_error_code: r.meta_error_code || null });
      return send(res, 200, { ok: false, configured: true, meta_ok: false, dry_run: false, meta_error_code: r.meta_error_code || null, error: r.error || 'meta request failed' }, p);
    }
    if (p === '/api/whatsapp/send' && req.method === 'POST') {
      if (!can(user, 'whatsapp', 'edit')) return forbidden();
      if (db.killSwitch) return send(res, 400, { error: 'kill_switch_on — الإرسال موقوف بمفتاح الإيقاف' }, p);
      if (!body.to) return send(res, 400, { error: 'to is required' }, p);
      const toNorm = normPhone(body.to);
      const toMeta = phoneKey(body.to); // Meta wants international format, no '+'
      const isTemplate = !!body.template_name;
      const cfg = metaConfig();
      let metaPayload = null;
      if (isTemplate) {
        const tpl = db.templates.find((t) => t.name === body.template_name);
        if (!tpl) return send(res, 400, { error: 'template_not_found' }, p);
        if (tpl.approval_status !== 'approved') return send(res, 400, { error: 'template_not_approved' }, p);
        // FIX (Stage A): when Meta IS configured, local approval alone is
        // NOT enough — Meta approval is also required. When Meta is NOT
        // configured the send below is a dry-run, so local approval only.
        if (cfg.configured && tpl.meta_status !== 'approved') return send(res, 400, { error: 'template_not_meta_approved' }, p);
        const components = [];
        if (Array.isArray(body.parameters) && body.parameters.length) {
          components.push({ type: 'body', parameters: body.parameters.map((v) => ({ type: 'text', text: String(v) })) });
        }
        metaPayload = { messaging_product: 'whatsapp', to: toMeta, type: 'template', template: { name: tpl.name, language: { code: body.language || tpl.language || 'ar' }, ...(components.length ? { components } : {}) } };
      } else {
        // Free-form (text/media/buttons/list) requires an open 24h window.
        if (!within24h(lastInboundAtForPhone(body.to))) return send(res, 400, { error: 'outside_24h_window_use_template' }, p);
        if (body.buttons !== undefined && (!Array.isArray(body.buttons) || body.buttons.length > 3)) return send(res, 400, { error: 'buttons must be an array of at most 3' }, p);
        if (body.list !== undefined) {
          const rows = (body.list.sections || []).reduce((n, s) => n + ((s.rows || []).length), 0);
          if (rows > 10) return send(res, 400, { error: 'list must have at most 10 rows' }, p);
        }
        const kind = body.type || (body.media ? body.media.type : null) || 'text';
        if (!['text', 'image', 'video', 'audio', 'document', 'buttons', 'list'].includes(kind)) return send(res, 400, { error: 'unsupported message type' }, p);
        if (kind === 'text' && !body.body) return send(res, 400, { error: 'body is required for a text message' }, p);
        if (kind === 'buttons') {
          metaPayload = { messaging_product: 'whatsapp', to: toMeta, type: 'interactive', interactive: { type: 'button', body: { text: body.body || '' }, action: { buttons: (body.buttons || []).map((b) => ({ type: 'reply', reply: { id: b.id || b.title, title: b.title } })) } } };
        } else if (kind === 'list') {
          metaPayload = { messaging_product: 'whatsapp', to: toMeta, type: 'interactive', interactive: { type: 'list', body: { text: body.body || '' }, action: body.list } };
        } else if (kind === 'text') {
          metaPayload = { messaging_product: 'whatsapp', to: toMeta, type: 'text', text: { body: body.body } };
        } else {
          const media = body.media || {};
          if (!media.link && !media.id) return send(res, 400, { error: 'media.link is required for a media message' }, p);
          metaPayload = { messaging_product: 'whatsapp', to: toMeta, type: kind, [kind]: { ...(media.link ? { link: media.link } : { id: media.id }), ...(body.body ? { caption: body.body } : {}) } };
        }
      }
      const conv = conversationForPhone(body.to, true);
      if (!cfg.configured) {
        const m = { id: nextId(), conversation_id: conv.id, direction: 'out', sender_phone: null, to_phone: toNorm, body: body.body || null, template_name: body.template_name || null, media_type: (body.media && body.media.type) || null, wamid: null, meta_status: null, dry_run: true, created_at: new Date().toISOString() };
        db.messages.push(m); audit(actor, 'message', m.id, 'whatsapp_send_dry_run', { conversation_id: conv.id, template_name: m.template_name });
        return send(res, 200, { ok: true, dry_run: true, configured: false, message: m }, p);
      }
      const r = await metaRequest('POST', `/${cfg.phoneId}/messages`, metaPayload);
      if (!r.ok) {
        audit(actor, 'whatsapp', 0, 'whatsapp_send_failed', { to_phone: toNorm, meta_error_code: r.meta_error_code || null });
        return send(res, 502, { ok: false, dry_run: false, meta_error_code: r.meta_error_code || null, error: r.error || 'meta request failed' }, p);
      }
      const wamid = r.data && r.data.messages && r.data.messages[0] ? r.data.messages[0].id : null;
      const m = { id: nextId(), conversation_id: conv.id, direction: 'out', sender_phone: null, to_phone: toNorm, body: body.body || null, template_name: body.template_name || null, media_type: (body.media && body.media.type) || null, wamid, meta_status: 'sent', dry_run: false, created_at: new Date().toISOString() };
      db.messages.push(m); audit(actor, 'message', m.id, 'whatsapp_sent', { conversation_id: conv.id, wamid, template_name: m.template_name });
      return send(res, 200, { ok: true, dry_run: false, configured: true, wamid, message: m }, p);
    }
    if (p === '/api/whatsapp/templates' && req.method === 'POST') {
      if (!can(user, 'whatsapp', 'edit')) return forbidden();
      if (!body.name || !/^[a-z0-9_]+$/.test(String(body.name))) return send(res, 400, { error: 'name is required (lowercase letters, digits, underscores only)' }, p);
      if (body.category !== undefined && body.category !== 'UTILITY') return send(res, 400, { error: 'category must be UTILITY only — Marketing templates are not allowed' }, p);
      if (body.language !== undefined && body.language !== 'ar') return send(res, 400, { error: 'language must be ar' }, p);
      if (!body.body || !String(body.body).trim()) return send(res, 400, { error: 'body is required' }, p);
      const vErr = validateTemplateInput(body);
      if (vErr) return send(res, 400, { error: vErr }, p);
      if (db.templates.some((t) => t.name === body.name)) return send(res, 400, { error: 'template name already exists' }, p);
      const t = { id: nextId(), name: body.name, label_ar: body.label_ar || body.name, language: 'ar', category: 'UTILITY', body: String(body.body), header_type: body.header_type || null, header_text: body.header_text ? String(body.header_text) : null, header_link: body.header_link ? String(body.header_link) : null, footer: body.footer ? String(body.footer) : null, buttons: normalizeTemplateButtons(body.buttons), sample_values: Array.isArray(body.sample_values) ? body.sample_values.map(String) : (Array.isArray(body.example_values) ? body.example_values.map(String) : []), approval_status: 'pending', meta_status: 'not_submitted', meta_template_id: null, rejection_reason: null, created_at: new Date().toISOString() };
      db.templates.push(t); audit(actor, 'template', t.id, 'whatsapp_template_created', { name: t.name }); save(); return send(res, 201, t, p);
    }
    // ---- Embedded Signup: launch config (booleans + public params only) ----
    if (p === '/api/whatsapp/embedded-signup/config' && req.method === 'GET') {
      if (!can(user, 'whatsapp', 'view')) return forbidden();
      const cfg = metaConfig();
      return send(res, 200, { embedded_configured: cfg.embeddedConfigured, app_id_configured: cfg.embedded.app_id_configured, config_id_configured: cfg.embedded.config_id_configured, app_secret_configured: cfg.embedded.app_secret_configured, launch: cfg.embeddedConfigured ? embeddedLaunchParams(cfg) : null, api_version: cfg.version }, p);
    }
    // ---- Embedded Signup: code exchange, TESTED not persisted ----
    // The exchanged token is used only in-process to call /me (and, when
    // env WABA/phone IDs exist, a phone lookup) and is then discarded:
    // it is NEVER returned, logged, audited, or written to data.json.
    // Production: the operator copies the resulting WABA/Phone IDs into
    // Render Environment Variables + Redeploy (free container file is
    // ephemeral). See docs/zeromsg-linking.md.
    if (p === '/api/whatsapp/embedded-signup/callback' && req.method === 'POST') {
      if (!can(user, 'whatsapp', 'edit')) return forbidden();
      const cfg = metaConfig();
      if (!cfg.embeddedConfigured) {
        audit(actor, 'whatsapp', 0, 'whatsapp_embedded_signup_not_configured');
        return send(res, 400, { error: 'embedded_not_configured — set WHATSAPP_APP_ID, WHATSAPP_APP_SECRET and WHATSAPP_CONFIG_ID in hosting env' }, p);
      }
      if (!body.code || typeof body.code !== 'string') return send(res, 400, { error: 'code is required' }, p);
      const code = body.code;
      const redirectUri = body.redirect_uri ? String(body.redirect_uri) : null;
      // 1) Exchange the short-lived code for a token (server-side only:
      // the App Secret travels only in this server-to-Meta request).
      let exUrl;
      try {
        exUrl = new URL(cfg.base + '/' + cfg.version + '/oauth/access_token');
        exUrl.searchParams.set('client_id', cfg.appId);
        exUrl.searchParams.set('client_secret', cfg.appSecret);
        exUrl.searchParams.set('code', code);
        if (redirectUri) exUrl.searchParams.set('redirect_uri', redirectUri);
      } catch { return send(res, 502, { error: 'embedded exchange failed' }, p); }
      const ex = await new Promise((resolve) => {
        const lib = exUrl.protocol === 'http:' ? require('http') : require('https');
        const rq = lib.request(exUrl, { method: 'GET', timeout: 10000 }, (resp) => {
          let d = ''; resp.on('data', (c) => { d += c; }); resp.on('end', () => {
            let parsed = null; try { parsed = d ? JSON.parse(d) : null; } catch {}
            resolve(resp.statusCode >= 200 && resp.statusCode < 300 ? { ok: true, data: parsed } : { ok: false, ...metaErrorInfo(parsed) });
          });
        });
        rq.on('timeout', () => { rq.destroy(); resolve({ ok: false, error: 'meta request timed out' }); });
        rq.on('error', () => resolve({ ok: false, error: 'meta request failed' })); rq.end();
      });
      if (!ex.ok || !ex.data || !ex.data.access_token) {
        audit(actor, 'whatsapp', 0, 'whatsapp_embedded_signup_exchange_failed', { meta_error_code: ex.meta_error_code || null });
        return send(res, 502, { ok: false, error: ex.error || 'embedded exchange failed', meta_error_code: ex.meta_error_code || null }, p);
      }
      const exchanged = ex.data.access_token;
      // 2) Validate the exchanged token via /me (read-only).
      const me = await metaRequest('GET', '/me', null, exchanged);
      if (!me.ok) {
        audit(actor, 'whatsapp', 0, 'whatsapp_embedded_signup_validation_failed', { meta_error_code: me.meta_error_code || null });
        return send(res, 502, { ok: false, error: me.error || 'token validation failed', meta_error_code: me.meta_error_code || null }, p);
      }
      // 3) Optional phone lookup when a WABA ID is already configured;
      // failures here do not fail the test — env IDs are the fallback.
      let displayName = (me.data && me.data.name) || null;
      let phoneId = cfg.phoneId || null;
      if (cfg.wabaId) {
        const phones = await metaRequest('GET', '/' + cfg.wabaId + '/phone_numbers?fields=display_name&limit=10', null, exchanged);
        const first = phones.ok && phones.data && Array.isArray(phones.data.data) ? phones.data.data[0] : null;
        if (first) { if (first.display_name) displayName = first.display_name; if (first.id && !phoneId) phoneId = first.id; }
      }
      audit(actor, 'whatsapp', 0, 'whatsapp_embedded_signup_tested', { tested: true, persisted: false, has_waba: !!cfg.wabaId, has_phone: !!phoneId });
      return send(res, 200, { ok: true, tested: true, persisted: false, meta_user_id: (me.data && me.data.id) || null, display_name: displayName, waba_id: cfg.wabaId || null, phone_number_id: phoneId, configured: { app_id_configured: true, config_id_configured: true, app_secret_configured: true, access_token_configured: !!cfg.token, phone_number_configured: !!cfg.phoneId, waba_configured: !!cfg.wabaId }, message: 'Token tested successfully and NOT persisted. For production, set the resulting IDs/token in Render Environment Variables and Redeploy.' }, p);
    }
    // ---- WhatsApp template: single GET (with preview + send gate) / draft edit ----
    const waTplMatch = p.match(/^\/api\/whatsapp\/templates\/(\d+)$/);
    if (waTplMatch) {
      const t = db.templates.find((x) => x.id === Number(waTplMatch[1]));
      if (!t) return send(res, 404, { error: 'template not found' }, p);
      if (req.method === 'GET') {
        if (!can(user, 'whatsapp', 'view')) return forbidden();
        return send(res, 200, templatePublic(t, metaConfig().configured), p);
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (!can(user, 'whatsapp', 'edit')) return forbidden();
        // Draft edit only: an approved/pending Meta template must not be
        // silently diverged from Meta — submit a new version instead.
        if (t.meta_status === 'approved' || t.meta_status === 'pending') return send(res, 400, { error: 'template_not_editable — template is approved or pending at Meta; create a new template version instead' }, p);
        if (body.name !== undefined && body.name !== t.name) return send(res, 400, { error: 'name is immutable after creation' }, p);
        if (body.category !== undefined && body.category !== 'UTILITY') return send(res, 400, { error: 'category must be UTILITY only' }, p);
        if (body.language !== undefined && body.language !== 'ar') return send(res, 400, { error: 'language must be ar' }, p);
        const vErr = validateTemplateInput(body);
        if (vErr) return send(res, 400, { error: vErr }, p);
        if (body.label_ar !== undefined) t.label_ar = body.label_ar || t.name;
        if (body.header_type !== undefined) t.header_type = body.header_type;
        if (body.header_text !== undefined) t.header_text = body.header_text ? String(body.header_text) : null;
        if (body.header_link !== undefined) t.header_link = body.header_link ? String(body.header_link) : null;
        if (body.body !== undefined) t.body = String(body.body);
        if (body.footer !== undefined) t.footer = body.footer ? String(body.footer) : null;
        if (body.buttons !== undefined) t.buttons = normalizeTemplateButtons(body.buttons);
        if (body.sample_values !== undefined) t.sample_values = body.sample_values.map(String);
        if (body.example_values !== undefined) t.sample_values = body.example_values.map(String);
        audit(actor, 'template', t.id, 'whatsapp_template_draft_edited', { name: t.name }); save(); return send(res, 200, t, p);
      }
    }
    const tplSubmitMatch = p.match(/^\/api\/whatsapp\/templates\/(\d+)\/submit$/);
    if (tplSubmitMatch && req.method === 'POST') {
      if (!can(user, 'whatsapp', 'edit')) return forbidden();
      const t = db.templates.find((x) => x.id === Number(tplSubmitMatch[1]));
      if (!t) return send(res, 404, { error: 'template not found' }, p);
      const cfg = metaConfig();
      if (!cfg.configured) {
        audit(actor, 'template', t.id, 'whatsapp_template_submit_dry_run', { name: t.name });
        return send(res, 200, { ok: true, dry_run: true, configured: false, message: 'Meta is not configured — template kept as not_submitted', template: t }, p);
      }
      if (!t.body) return send(res, 400, { error: 'template body is required before submission' }, p);
      const components = [];
      if (t.header_type === 'text' && t.header_text) components.push({ type: 'HEADER', format: 'TEXT', text: t.header_text });
      else if (t.header_type) components.push({ type: 'HEADER', format: String(t.header_type).toUpperCase() });
      components.push({ type: 'BODY', text: t.body, ...(Array.isArray(t.sample_values) && t.sample_values.length ? { example: { body_text: [t.sample_values] } } : {}) });
      if (t.footer) components.push({ type: 'FOOTER', text: t.footer });
      if (Array.isArray(t.buttons) && t.buttons.length) components.push({ type: 'BUTTONS', buttons: t.buttons });
      const r = await metaRequest('POST', `/${cfg.wabaId}/message_templates`, { name: t.name, category: 'UTILITY', language: 'ar', components });
      if (!r.ok) {
        audit(actor, 'template', t.id, 'whatsapp_template_submit_failed', { name: t.name, meta_error_code: r.meta_error_code || null });
        return send(res, 502, { ok: false, dry_run: false, meta_error_code: r.meta_error_code || null, error: r.error || 'meta request failed', template: t }, p);
      }
      t.meta_status = mapMetaTemplateStatus(r.data && r.data.status) || 'pending';
      if (r.data && r.data.id) t.meta_template_id = r.data.id;
      audit(actor, 'template', t.id, 'whatsapp_template_submitted', { name: t.name, meta_status: t.meta_status }); save();
      return send(res, 200, { ok: true, dry_run: false, configured: true, template: t }, p);
    }
    if (p === '/api/whatsapp/templates/sync' && req.method === 'POST') {
      if (!can(user, 'whatsapp', 'edit')) return forbidden();
      const cfg = metaConfig();
      if (!cfg.configured) {
        audit(actor, 'whatsapp', 0, 'whatsapp_templates_sync_dry_run');
        return send(res, 200, { ok: true, dry_run: true, configured: false, message: 'Meta is not configured — local template states unchanged' }, p);
      }
      const r = await metaRequest('GET', `/${cfg.wabaId}/message_templates?fields=name,status,category,language,id&limit=100`, null);
      if (!r.ok) {
        audit(actor, 'whatsapp', 0, 'whatsapp_templates_sync_failed', { meta_error_code: r.meta_error_code || null });
        return send(res, 502, { ok: false, dry_run: false, meta_error_code: r.meta_error_code || null, error: r.error || 'meta request failed' }, p);
      }
      let updated = 0;
      const rows = (r.data && r.data.data) || [];
      for (const row of rows) {
        const tpl = db.templates.find((t) => t.name === row.name);
        const mapped = mapMetaTemplateStatus(row.status);
        if (!tpl) continue;
        let changedRow = false;
        if (mapped && tpl.meta_status !== mapped) { tpl.meta_status = mapped; changedRow = true; }
        if (row.id && tpl.meta_template_id !== row.id) { tpl.meta_template_id = row.id; changedRow = true; }
        const rej = row.rejected_reason || row.rejection_reason || null;
        if (mapped === 'rejected' && rej && tpl.rejection_reason !== String(rej).slice(0, 500)) { tpl.rejection_reason = String(rej).slice(0, 500); changedRow = true; }
        if (mapped === 'approved' && tpl.rejection_reason) { tpl.rejection_reason = null; changedRow = true; }
        if (changedRow) updated++;
      }
      // approval_status is local and is NEVER overwritten by Meta status.
      audit(actor, 'whatsapp', 0, 'whatsapp_templates_synced', { updated, total_from_meta: rows.length }); save();
      return send(res, 200, { ok: true, dry_run: false, configured: true, updated, total_from_meta: rows.length, synced_at: new Date().toISOString(), templates: db.templates.map((t) => ({ id: t.id, name: t.name, approval_status: t.approval_status, meta_status: t.meta_status })) }, p);
    }

    // ---- Old 10-step checklist: DELETED as a separate wizard, kept only
    // as a redirect to the one 7-step wizard (/api/whatsapp/linking).
    // No second linking flow exists anywhere in the UI or API.
    if (p === '/api/connection-checklist' && req.method === 'GET') {
      return send(res, 200, { deprecated: true, redirect: '/api/whatsapp/linking', ...linkingPayload() }, p);
    }
    // ---- The ONE linking wizard (7 steps, server-driven) ----
    if (p === '/api/whatsapp/linking' && req.method === 'GET') {
      if (!can(user, 'whatsapp', 'view')) return forbidden();
      return send(res, 200, linkingPayload(), p);
    }

    // ---- Users (users:manage only) ----
    if (p === '/api/users' && req.method === 'GET') {
      if (!can(user, 'users', 'manage')) return forbidden();
      return send(res, 200, db.users.map(publicUser), p);
    }
    if (p === '/api/users' && req.method === 'POST') {
      if (!can(user, 'users', 'manage')) return forbidden();
      const badField = rejectUnknown(body, ['full_name','email','password','role','department','sections','actions']);
      if (badField) return send(res, 400, { error: badField }, p);
      const email = normEmail(body.email);
      if (!body.full_name || !String(body.full_name).trim()) return send(res, 400, { error: 'full_name is required' }, p);
      if (!EMAIL_RE.test(email)) return send(res, 400, { error: 'invalid email' }, p);
      if (!body.password || body.password.length < 8) return send(res, 400, { error: 'password must be at least 8 characters' }, p);
      if (!ROLES.includes(body.role)) return send(res, 400, { error: 'invalid role — must be one of: ' + ROLES.join(', ') }, p);
      if (body.department !== undefined && !DEPARTMENTS.includes(body.department)) return send(res, 400, { error: 'department must be one of: ' + DEPARTMENTS.join(', ') }, p);
      if (body.sections !== undefined && !validSections(body.sections)) return send(res, 400, { error: 'sections must be a subset of: ' + SECTIONS.join(', ') }, p);
      if (body.actions !== undefined && !validActions(body.actions)) return send(res, 400, { error: 'actions must map sections to view/create/edit/approve/manage' }, p);
      if (db.users.some((u) => u.email === email)) return send(res, 400, { error: 'email already exists' }, p);
      const u = {
        id: nextId(), full_name: String(body.full_name).trim(), email, role: body.role,
        department: body.department || null,
        sections: body.sections !== undefined ? body.sections : undefined,
        actions: body.actions !== undefined ? body.actions : undefined,
        password_hash: hashPassword(body.password), is_primary_admin: false, is_active: true,
        created_at: new Date().toISOString(),
      };
      db.users.push(u); audit(actor, 'user', u.id, 'created'); return send(res, 201, publicUser(u), p);
    }
    const userResetMatch = p.match(/^\/api\/users\/(\d+)\/reset-password$/);
    if (userResetMatch && req.method === 'POST') {
      if (!can(user, 'users', 'manage')) return forbidden();
      const u = db.users.find((x) => x.id === Number(userResetMatch[1]));
      if (!u) return send(res, 404, { error: 'user not found' }, p);
      const badField = rejectUnknown(body, ['password']);
      if (badField) return send(res, 400, { error: badField }, p);
      if (!body.password || body.password.length < 8) return send(res, 400, { error: 'password must be at least 8 characters' }, p);
      u.password_hash = hashPassword(body.password);
      audit(actor, 'user', u.id, 'password_reset'); return send(res, 200, publicUser(u), p);
    }
    const userIdMatch = p.match(/^\/api\/users\/(\d+)$/);
    if (userIdMatch) {
      if (!can(user, 'users', 'manage')) return forbidden();
      const u = db.users.find((x) => x.id === Number(userIdMatch[1]));
      if (!u) return send(res, 404, { error: 'user not found' }, p);
      if (req.method === 'GET') return send(res, 200, publicUser(u), p);
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const badField = rejectUnknown(body, ['full_name','email','role','department','sections','actions','is_active']);
        if (badField) return send(res, 400, { error: badField }, p);
        if (body.role !== undefined && !ROLES.includes(body.role)) return send(res, 400, { error: 'invalid role — must be one of: ' + ROLES.join(', ') }, p);
        if (body.email !== undefined && !EMAIL_RE.test(normEmail(body.email))) return send(res, 400, { error: 'invalid email' }, p);
        if (body.department !== undefined && body.department !== null && !DEPARTMENTS.includes(body.department)) return send(res, 400, { error: 'department must be one of: ' + DEPARTMENTS.join(', ') }, p);
        if (body.sections !== undefined && !validSections(body.sections)) return send(res, 400, { error: 'sections must be a subset of: ' + SECTIONS.join(', ') }, p);
        if (body.actions !== undefined && !validActions(body.actions)) return send(res, 400, { error: 'actions must map sections to view/create/edit/approve/manage' }, p);
        if (body.is_active === false && u.is_primary_admin) return send(res, 400, { error: 'cannot disable the primary admin — لا يمكن تعطيل المسؤول الأساسي' }, p);
        if (body.is_active === false && u.role === 'owner' && u.is_active !== false && onlyActiveOwnerCount() <= 1) {
          return send(res, 400, { error: 'cannot disable the only active owner — لا يمكن تعطيل المالك النشط الوحيد' }, p);
        }
        const roleChanged = body.role !== undefined && body.role !== u.role;
        if (body.role !== undefined) u.role = body.role;
        if (body.full_name !== undefined) u.full_name = String(body.full_name).trim();
        if (body.email !== undefined) u.email = normEmail(body.email);
        if (body.department !== undefined) u.department = body.department;
        // Changing role without explicit overrides resets to the new role defaults.
        if (body.sections !== undefined) u.sections = body.sections;
        else if (roleChanged) u.sections = undefined;
        if (body.actions !== undefined) u.actions = body.actions;
        else if (roleChanged) u.actions = undefined;
        if (body.is_active !== undefined) u.is_active = !!body.is_active;
        audit(actor, 'user', u.id, 'updated'); save(); return send(res, 200, publicUser(u), p);
      }
      if (req.method === 'DELETE') {
        if (u.is_primary_admin) return send(res, 400, { error: 'cannot delete the primary admin — لا يمكن حذف المسؤول الأساسي' }, p);
        if (u.role === 'owner' && u.is_active !== false && onlyActiveOwnerCount() <= 1) {
          return send(res, 400, { error: 'cannot delete the only active owner — لا يمكن حذف المالك النشط الوحيد' }, p);
        }
        db.users = db.users.filter((x) => x.id !== u.id);
        audit(actor, 'user', u.id, 'deleted'); return send(res, 200, { ok: true, deleted_id: u.id }, p);
      }
    }
    const userDisableMatch = p.match(/^\/api\/users\/(\d+)\/(disable|enable)$/);
    if (userDisableMatch && req.method === 'POST') {
      if (!can(user, 'users', 'manage')) return forbidden();
      const u = db.users.find((x) => x.id === Number(userDisableMatch[1]));
      if (!u) return send(res, 404, { error: 'user not found' }, p);
      if (userDisableMatch[2] === 'disable') {
        if (u.is_primary_admin) return send(res, 400, { error: 'cannot disable the primary admin — لا يمكن تعطيل المسؤول الأساسي' }, p);
        if (u.role === 'owner' && u.is_active !== false && onlyActiveOwnerCount() <= 1) {
          return send(res, 400, { error: 'cannot disable the only active owner — لا يمكن تعطيل المالك النشط الوحيد' }, p);
        }
        u.is_active = false; audit(actor, 'user', u.id, 'disabled'); save(); return send(res, 200, publicUser(u), p);
      }
      u.is_active = true; audit(actor, 'user', u.id, 'enabled'); save(); return send(res, 200, publicUser(u), p);
    }

    // ---- Contracts ----
    if (p === '/api/contracts' && req.method === 'GET') {
      if (!can(user, 'contracts', 'view')) return forbidden();
      return send(res, 200, db.contracts, p);
    }
    if (p === '/api/contracts' && req.method === 'POST') {
      if (!can(user, 'contracts', 'create')) return forbidden();
      if (!body.buyer_phone || !body.seller_phone || !body.product_description || !body.amount) return send(res, 400, { error: 'buyer_phone, seller_phone, product_description and amount are required' }, p);
      const id = nextId();
      if (body.contract_type !== undefined && !CONTRACT_TYPES.includes(body.contract_type)) return send(res, 400, { error: 'contract_type must be one of: ' + CONTRACT_TYPES.join(', ') }, p);
      const extra = {};
      for (const k of ['quantity', 'specifications', 'service_duration', 'delivery_stages']) if (body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== '') extra[k] = String(body[k]).trim();
      const c = { id, code: contractCode(id), buyer_phone: body.buyer_phone, seller_phone: body.seller_phone, product_description: body.product_description, amount: Number(body.amount), currency: body.currency || 'SAR', delivery_point: body.delivery_point || null, contract_type: body.contract_type || 'general', ...extra, state: 'draft', version: 1, clause_fingerprint: sha256(JSON.stringify(body) + id), created_at: new Date().toISOString() };
      db.contracts.push(c);
      db.contract_versions.push({ id: nextId(), contract_id: id, version: 1, snapshot: { buyer_phone: c.buyer_phone, seller_phone: c.seller_phone, product_description: c.product_description, amount: c.amount, currency: c.currency, delivery_point: c.delivery_point, contract_type: c.contract_type }, clause_fingerprint: c.clause_fingerprint, is_locked: false, created_at: c.created_at });
      ['buyer', 'seller'].forEach((party) => db.conversations.push({ id: nextId(), contract_id: id, party, status: 'new', unread_count: 0, assigned_to: null }));
      db.tasks.push({ id: nextId(), contract_id: id, title: 'مراجعة العقد وإصداره', type: 'review', status: 'open', assigned_to: null, created_at: new Date().toISOString() });
      audit(actor, 'contract', id, 'created', { code: c.code }); return send(res, 201, c, p);
    }
    // ---- Contract PDF (Round 3, expanded brief): a formatted Arabic RTL
    // PDF presentation of the LOCKED contract record — never an editable
    // replacement. Generated server-side with an embedded font (pdf.js),
    // so it works on Render too. No new dependency.
    const contractPdfMatch = p.match(/^\/api\/contracts\/(\d+)\/pdf$/);
    if (contractPdfMatch && req.method === 'GET') {
      if (!can(user, 'contracts', 'view')) return forbidden();
      const c = db.contracts.find((x) => x.id === Number(contractPdfMatch[1]));
      if (!c) return send(res, 404, { error: 'contract not found' }, p);
      const STATE_AR = { draft: 'مسودة', issued: 'صادر بانتظار القبول', accepted: 'مقبول من الطرفين', payment_pending: 'بانتظار تأكيد المؤسسة المالية', payment_confirmed: 'مؤكد مالياً بمرجع مؤسسة', preparing: 'قيد التجهيز', delivered: 'مسلّم بانتظار تأكيد الاستلام', completed: 'مكتمل ومغلق', disputed: 'نزاع مفتوح', refund_pending: 'استرداد بانتظار تنفيذ يدوي خارج النظام', refunded: 'مسترد', cancelled: 'ملغى' };
      const auditLines = db.audit.filter((a) => a.entity === 'contract' && a.entity_id === c.id).slice(-10);
      const files = db.contract_files.filter((f) => f.contract_id === c.id);
      const lines = [
        { text: 'عقد ضمان — Pilot System', size: 20, align: 'center', blankAfter: true },
      ];
      if (c.is_demo) lines.push({ text: 'تجريبي — ليس عقداً حقيقياً', size: 14, align: 'center', blankAfter: true });
      lines.push(
        { text: `رقم العقد: ${c.code}`, size: 14, blankAfter: true },
        { text: `الحالة: ${STATE_AR[c.state] || c.state}`, size: 14 },
        { text: `المشتري: ${c.buyer_phone}`, size: 14 },
        { text: `البائع: ${c.seller_phone}`, size: 14 },
        { text: `المنتج: ${c.product_description}`, size: 14 },
        { text: `المبلغ: ${c.amount} ${c.currency}`, size: 14 },
        { text: `نقطة التسليم: ${c.delivery_point || 'غير محددة'}`, size: 14 },
        { text: 'نافذة القبول: غير مسجلة كحقل مستقل في سجل العقد — تحددها بنود الاتفاق المتفق عليها خارج النظام', size: 12 },
        { text: `تاريخ الإنشاء: ${String(c.created_at).slice(0, 10)}`, size: 14 },
        { text: `إصدار العقد: v${c.version || 1}`, size: 14, blankAfter: true },
        { text: `بصمة البنود (SHA-256): ${c.clause_fingerprint}`, size: 11, blankAfter: true },
        { text: 'النسخ الموقعة المسجلة:', size: 14 },
      );
      if (!files.length) lines.push({ text: 'لا نسخ موقعة مسجلة لهذا العقد بعد.', size: 12 });
      else for (const f of files) lines.push({ text: `${f.filename} — ${f.kind}`, size: 12 });
      lines.push({ text: 'ملخص سجل التدقيق:', size: 14, blankAfter: false });
      if (!auditLines.length) lines.push({ text: 'لا أحداث تدقيق لهذا العقد بعد.', size: 12 });
      else for (const a of auditLines) lines.push({ text: `${String(a.created_at).slice(0, 10)} ${String(a.created_at).slice(11, 16)} — ${a.actor}: ${a.action}${a.details && a.details.to ? ' ← ' + (STATE_AR[String(a.details.to)] || String(a.details.to)) : ''}${a.details && a.details.financial_reference ? ' (مرجع: ' + String(a.details.financial_reference) + ')' : ''}`, size: 11 });
      lines.push({ text: 'هذا المستند عرض لسجل العقد المقفل في النظام، وليس بديلاً قابلاً للتعديل عنه. أي تنفيذ مالي يتم يدوياً خارج النظام عبر المؤسسة المالية الخارجية.', size: 11, blankAfter: false });
      lines[0] = { text: `عقد ${CONTRACT_TYPE_AR[contractTypeOf(c)]} — Pilot System`, size: 20, align: 'center', blankAfter: true };
      const typeLines = [];
      if (contractTypeOf(c) === 'goods_sale') { if (c.quantity) typeLines.push({ text: `الكمية: ${c.quantity}`, size: 14 }); if (c.specifications) typeLines.push({ text: `المواصفات: ${c.specifications}`, size: 14 }); }
      if (contractTypeOf(c) === 'service') { if (c.service_duration) typeLines.push({ text: `مدة الخدمة: ${c.service_duration}`, size: 14 }); }
      if (contractTypeOf(c) === 'supply') { if (c.delivery_stages) typeLines.push({ text: `مراحل/دفعات التوريد: ${c.delivery_stages}`, size: 14 }); }
      const dpIdx = lines.findIndex((l) => String(l.text || '').startsWith('نقطة التسليم'));
      if (typeLines.length && dpIdx >= 0) lines.splice(dpIdx + 1, 0, ...typeLines);
      let pdf;
      try { pdf = buildPdf(lines); } catch (e) { return send(res, 500, { error: 'pdf generation failed: ' + e.message }, p); }
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="contract-${c.code}.pdf"`, ...securityHeaders(p) });
      return res.end(pdf);
    }
    // ---- Demo contract (Round 3, expanded brief): ONE clearly-labelled
    // test contract so the whole system can be judged end-to-end before
    // Meta linking. Excluded from real reports, deleted by one button.
    if (p === '/api/demo-contract' && req.method === 'POST') {
      if (!can(user, 'contracts', 'create')) return forbidden();
      const existing = db.contracts.find((x) => x.is_demo);
      if (existing) return send(res, 200, { ok: true, already: true, contract: existing }, p);
      const id = nextId();
      const c = { id, code: contractCode(id), buyer_phone: '+967700000001', seller_phone: '+967700000002', product_description: 'تجريبي — منتج تجريبي للعرض فقط', amount: 100, currency: 'SAR', delivery_point: 'تجريبي — نقطة عرض فقط', state: 'draft', version: 1, is_demo: true, contract_type: 'general', clause_fingerprint: sha256('demo-contract' + id), created_at: new Date().toISOString() };
      db.contracts.push(c);
      db.contract_versions.push({ id: nextId(), contract_id: id, version: 1, snapshot: { buyer_phone: c.buyer_phone, seller_phone: c.seller_phone, product_description: c.product_description, amount: c.amount, currency: c.currency, delivery_point: c.delivery_point }, clause_fingerprint: c.clause_fingerprint, is_locked: false, created_at: c.created_at });
      ['buyer', 'seller'].forEach((party) => db.conversations.push({ id: nextId(), contract_id: id, party, status: 'new', unread_count: 0, assigned_to: null }));
      audit(actor, 'contract', id, 'demo_contract_created', { code: c.code }); save();
      return send(res, 201, { ok: true, already: false, contract: c }, p);
    }
    if (p === '/api/demo-contract' && req.method === 'DELETE') {
      if (!can(user, 'contracts', 'create')) return forbidden();
      const ids = db.contracts.filter((x) => x.is_demo).map((x) => x.id);
      const convIds = db.conversations.filter((x) => ids.includes(x.contract_id)).map((x) => x.id);
      db.messages = db.messages.filter((m) => !convIds.includes(m.conversation_id));
      db.conversations = db.conversations.filter((x) => !ids.includes(x.contract_id));
      db.contract_versions = db.contract_versions.filter((v) => !ids.includes(v.contract_id));
      db.contracts = db.contracts.filter((x) => !x.is_demo);
      audit(actor, 'contract', 0, 'demo_contract_deleted', { contracts: ids.length }); save();
      return send(res, 200, { ok: true, contracts_deleted: ids.length }, p);
    }
    const contractMatch = p.match(/^\/api\/contracts\/(\d+)\/transition$/);
    if (contractMatch && req.method === 'POST') {
      const c = db.contracts.find((x) => x.id === Number(contractMatch[1]));
      if (!c) return send(res, 404, { error: 'contract not found' }, p);
      const to = body.to;
      // Payment confirmation is an approval-grade action; other moves are edits.
      if (to === 'payment_confirmed') { if (!can(user, 'contracts', 'approve')) return forbidden(); }
      else if (!canAny(user, 'contracts', ['edit', 'approve'])) return forbidden();
      if (!TRANSITIONS[c.state].includes(to)) return send(res, 400, { error: `invalid transition ${c.state} -> ${to}` }, p);
      if (to === 'payment_confirmed' && !body.financial_reference) return send(res, 400, { error: 'payment_confirmed requires financial_reference from the financial institution' }, p);
      if (to === 'payment_confirmed') db.tasks.push({ id: nextId(), contract_id: c.id, title: 'تأكيد دفع بمرجع مؤسسة', type: 'financial', status: 'done', financial_reference: body.financial_reference, assigned_to: null, created_at: new Date().toISOString() });
      if (to === 'issued') db.tasks.push({ id: nextId(), contract_id: c.id, title: 'متابعة قبول الطرفين', type: 'followup', status: 'open', assigned_to: null, created_at: new Date().toISOString() });
      c.state = to; audit(actor, 'contract', c.id, 'transition', { to, financial_reference: body.financial_reference || null });
      // Stage B: contract-event automations (awaited, money steps are
      // re-checked inside runAutomation and never executed).
      try { await runContractEventAutomation(c, to); } catch {}
      return send(res, 200, c, p);
    }
    const contractAmendMatch = p.match(/^\/api\/contracts\/(\d+)\/amend$/);
    if (contractAmendMatch && req.method === 'POST') {
      if (!can(user, 'contracts', 'edit')) return forbidden();
      const c = db.contracts.find((x) => x.id === Number(contractAmendMatch[1]));
      if (!c) return send(res, 404, { error: 'contract not found' }, p);
      const amendable = ['buyer_phone', 'seller_phone', 'product_description', 'amount', 'currency', 'delivery_point', 'quantity', 'specifications', 'service_duration', 'delivery_stages'];
      const changes = {};
      for (const k of amendable) if (body[k] !== undefined) changes[k] = (k === 'amount' ? Number(body[k]) : body[k]);
      if (!Object.keys(changes).length) return send(res, 400, { error: 'amend requires at least one field: ' + amendable.join(', ') }, p);
      for (const v of db.contract_versions.filter((v) => v.contract_id === c.id)) v.is_locked = true;
      const nextVersion = (contractVersions(c.id).reduce((m, v) => Math.max(m, v.version), 0)) + 1;
      const merged = { buyer_phone: c.buyer_phone, seller_phone: c.seller_phone, product_description: c.product_description, amount: c.amount, currency: c.currency, delivery_point: c.delivery_point, ...changes };
      const fingerprint = sha256(JSON.stringify({ ...merged, version: nextVersion }) + c.id);
      const versionRec = { id: nextId(), contract_id: c.id, version: nextVersion, snapshot: merged, clause_fingerprint: fingerprint, is_locked: true, amended_by: actor, created_at: new Date().toISOString() };
      db.contract_versions.push(versionRec);
      Object.assign(c, changes, { version: nextVersion, clause_fingerprint: fingerprint, updated_at: new Date().toISOString() });
      audit(actor, 'contract', c.id, 'amended', { version: nextVersion, clause_fingerprint: fingerprint });
      return send(res, 200, { ...c, new_version: versionRec }, p);
    }
    const contractVersionsMatch = p.match(/^\/api\/contracts\/(\d+)\/versions$/);
    if (contractVersionsMatch && req.method === 'GET') {
      if (!can(user, 'contracts', 'view')) return forbidden();
      const c = db.contracts.find((x) => x.id === Number(contractVersionsMatch[1]));
      if (!c) return send(res, 404, { error: 'contract not found' }, p);
      return send(res, 200, contractVersions(c.id), p);
    }
    const contractFilesMatch = p.match(/^\/api\/contracts\/(\d+)\/(files|attachments)$/);
    if (contractFilesMatch) {
      const c = db.contracts.find((x) => x.id === Number(contractFilesMatch[1]));
      if (!c) return send(res, 404, { error: 'contract not found' }, p);
      if (req.method === 'GET') {
        if (!can(user, 'contracts', 'view')) return forbidden();
        return send(res, 200, db.contract_files.filter((f) => f.contract_id === c.id), p);
      }
      if (req.method === 'POST') {
        if (!can(user, 'contracts', 'edit')) return forbidden();
        if (!body.filename) return send(res, 400, { error: 'filename is required' }, p);
        if (!FILE_KINDS.includes(body.kind)) return send(res, 400, { error: 'kind must be one of: ' + FILE_KINDS.join(', ') }, p);
        // Metadata only: any file bytes/content fields are deliberately dropped.
        const f = { id: nextId(), contract_id: c.id, filename: body.filename, kind: body.kind, mime_type: body.mime_type || null, size_bytes: (typeof body.size_bytes === 'number' ? body.size_bytes : null), uploaded_by: actor, created_at: new Date().toISOString() };
        db.contract_files.push(f); audit(actor, 'contract_file', f.id, 'uploaded', { contract_id: c.id, kind: f.kind, filename: f.filename }); return send(res, 201, f, p);
      }
    }
    const signingMatch = p.match(/^\/api\/contracts\/(\d+)\/signing$/);
    if (signingMatch && req.method === 'GET') {
      if (!can(user, 'contracts', 'view')) return forbidden();
      const c = db.contracts.find((x) => x.id === Number(signingMatch[1]));
      if (!c) return send(res, 404, { error: 'contract not found' }, p);
      const files = db.contract_files.filter((f) => f.contract_id === c.id);
      const buyer = files.some((f) => f.kind === 'buyer_signed');
      const seller = files.some((f) => f.kind === 'seller_signed');
      return send(res, 200, { contract_id: c.id, code: c.code, contract_type: contractTypeOf(c), pdf_sent_at: c.pdf_sent_at || null, pdf_sent_by: c.pdf_sent_by || null, buyer_signed: buyer, seller_signed: seller, both_signed: buyer && seller, files }, p);
    }
    const sendPdfMatch = p.match(/^\/api\/contracts\/(\d+)\/send-pdf$/);
    if (sendPdfMatch && req.method === 'POST') {
      if (!can(user, 'contracts', 'edit')) return forbidden();
      const c = db.contracts.find((x) => x.id === Number(sendPdfMatch[1]));
      if (!c) return send(res, 404, { error: 'contract not found' }, p);
      if (c.pdf_sent_at) return send(res, 200, { ok: true, already: true, contract: c }, p);
      c.pdf_sent_at = new Date().toISOString(); c.pdf_sent_by = actor;
      audit(actor, 'contract', c.id, 'pdf_sent', { code: c.code, contract_type: contractTypeOf(c) }); save();
      return send(res, 200, { ok: true, already: false, contract: c }, p);
    }
    const contractSingleMatch = p.match(/^\/api\/contracts\/(\d+)$/);
    if (contractSingleMatch && req.method === 'GET') {
      if (!can(user, 'contracts', 'view')) return forbidden();
      const c = db.contracts.find((x) => x.id === Number(contractSingleMatch[1]));
      if (!c) return send(res, 404, { error: 'contract not found' }, p);
      return send(res, 200, c, p);
    }

    // ---- Demo conversation (Round 3): ONE clearly-labelled test thread so
    // the triptych shape can be judged BEFORE Meta linking. It is never a
    // real client (no phone number, no contract), never sent to Meta, and
    // never counted in reports (see /api/reports/summary). One-button
    // DELETE removes the conversation and all its messages.
    if (p === '/api/demo-conversation' && req.method === 'POST') {
      if (!can(user, 'inbox', 'edit')) return forbidden();
      const existing = db.conversations.find((c) => c.is_demo);
      if (existing) return send(res, 200, { ok: true, already: true, conversation: existing, messages: db.messages.filter((m) => m.conversation_id === existing.id).sort((a, b) => a.id - b.id) }, p);
      const now = new Date();
      const day = (d, h, mi) => { const t = new Date(d); t.setHours(h, mi, 0, 0); return t.toISOString(); };
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      const conv = { id: nextId(), contract_id: null, party: 'general', phone: null, display_name: 'عميل تجريبي', is_demo: true, status: 'open', unread_count: 0, assigned_to: null, labels: ['تجريبي'], pinned: false, last_inbound_at: day(now, 9, 5) };
      db.conversations.push(conv);
      const mk = (direction, body, extra) => { const m = { id: nextId(), conversation_id: conv.id, direction, sender_name: direction === 'in' ? 'عميل تجريبي' : 'فريق Pilot System', body: body || null, template_name: null, is_internal_note: false, is_demo: true, reply_to_id: null, meta_status: null, created_at: day(now, 9, 0), ...extra }; db.messages.push(m); return m; };
      mk('in', 'مرحباً، هل العقد جاهز للتوقيع؟', { created_at: day(yesterday, 10, 15) });
      mk('out', 'أهلاً بك، نعم العقد جاهز وسنرسل لك التفاصيل قبل التوقيع.', { created_at: day(yesterday, 10, 22), meta_status: 'read' });
      mk('in', 'صورة المنتج قبل التغليف', { created_at: day(now, 9, 5), media_type: 'image', media_filename: 'صورة المنتج التجريبي.jpg', media_caption: 'صورة المنتج قبل التغليف' });
      mk('out', 'تم قبول العقد — اضغط للتأكيد أو لطلب تعديل.', { created_at: day(now, 9, 6), template_name: 'contract_accepted', buttons: ['تأكيد العقد', 'اطلب تعديلاً'], meta_status: 'delivered' });
      mk('out', 'ملاحظة فريق: تحقق من هوية العميل قبل إرسال العقد النهائي.', { created_at: day(now, 9, 10), is_internal_note: true });
      audit(actor, 'conversation', conv.id, 'demo_conversation_created'); save();
      return send(res, 201, { ok: true, already: false, conversation: conv, messages: db.messages.filter((m) => m.conversation_id === conv.id).sort((a, b) => a.id - b.id) }, p);
    }
    if (p === '/api/demo-conversation' && req.method === 'DELETE') {
      if (!can(user, 'inbox', 'edit')) return forbidden();
      const ids = db.conversations.filter((c) => c.is_demo).map((c) => c.id);
      const beforeMsgs = db.messages.length;
      db.messages = db.messages.filter((m) => !ids.includes(m.conversation_id));
      db.conversations = db.conversations.filter((c) => !c.is_demo);
      audit(actor, 'conversation', 0, 'demo_conversation_deleted', { conversations: ids.length, messages: beforeMsgs - db.messages.length }); save();
      return send(res, 200, { ok: true, conversations_deleted: ids.length, messages_deleted: beforeMsgs - db.messages.length }, p);
    }
    // ---- Inbox: conversations & messages ----
    if (p === '/api/conversations' && req.method === 'GET') {
      if (!can(user, 'inbox', 'view')) return forbidden();
      let list = db.conversations;
      if (url.searchParams.has('status')) list = list.filter((c) => c.status === url.searchParams.get('status'));
      if (url.searchParams.has('assigned_to')) list = list.filter((c) => String(c.assigned_to) === url.searchParams.get('assigned_to'));
      if (url.searchParams.has('contract_id')) list = list.filter((c) => String(c.contract_id) === url.searchParams.get('contract_id'));
      if (url.searchParams.has('party')) list = list.filter((c) => c.party === url.searchParams.get('party'));
      if (url.searchParams.has('tag')) { const tg = url.searchParams.get('tag').trim().toLowerCase(); if (tg) list = list.filter((c) => (c.labels || []).some((l) => String(l).toLowerCase() === tg)); }
      if (url.searchParams.has('q')) {
        const q = url.searchParams.get('q').trim().toLowerCase();
        const qDigits = q.replace(/^\+/, '').replace(/[\s\-()]/g, '');
        if (q) list = list.filter((c) => {
          const contract = db.contracts.find((x) => x.id === c.contract_id);
          const hay = [c.phone || '', contract ? contract.code : '', contract ? contract.product_description : '', c.party].join(' ').toLowerCase();
          return hay.includes(q) || (qDigits && phoneKey(c.phone || '').includes(qDigits)) || (contract && (phoneKey(contract.buyer_phone).includes(qDigits) || phoneKey(contract.seller_phone).includes(qDigits)));
        });
      }
      if (url.searchParams.get('unread') === 'true') list = list.filter((c) => (c.unread_count || 0) > 0);
      return send(res, 200, list, p);
    }
    if (p === '/api/inbox/unread-counts' && req.method === 'GET') {
      if (!can(user, 'inbox', 'view')) return forbidden();
      const byConversation = db.conversations.filter((c) => !c.is_demo).map((c) => ({ conversation_id: c.id, contract_id: c.contract_id, party: c.party, status: c.status, unread_count: c.unread_count || 0 }));
      const total = byConversation.reduce((s, c) => s + c.unread_count, 0);
      const byStatus = {};
      for (const c of byConversation) byStatus[c.status] = (byStatus[c.status] || 0) + c.unread_count;
      return send(res, 200, { total_unread: total, by_status: byStatus, conversations: byConversation }, p);
    }
    const convSingleMatch = p.match(/^\/api\/conversations\/(\d+)$/);
    if (convSingleMatch) {
      const conv = db.conversations.find((x) => x.id === Number(convSingleMatch[1]));
      if (!conv) return send(res, 404, { error: 'conversation not found' }, p);
      if (req.method === 'GET') {
        if (!can(user, 'inbox', 'view')) return forbidden();
        return send(res, 200, conv, p);
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (!can(user, 'inbox', 'edit')) return forbidden();
        if (body.status !== undefined && !CONVERSATION_STATUSES.includes(body.status)) return send(res, 400, { error: 'status must be one of: ' + CONVERSATION_STATUSES.join(', ') }, p);
        if (body.status !== undefined) conv.status = body.status;
        if (body.assigned_to !== undefined) conv.assigned_to = body.assigned_to;
        if (body.labels !== undefined) {
          if (!Array.isArray(body.labels) || body.labels.some((l) => typeof l !== 'string') || body.labels.length > 20) return send(res, 400, { error: 'labels must be an array of at most 20 strings' }, p);
          conv.labels = body.labels.map((l) => String(l).trim()).filter(Boolean);
        }
        audit(actor, 'conversation', conv.id, 'updated'); save(); return send(res, 200, conv, p);
      }
    }
    const convAssignMatch = p.match(/^\/api\/conversations\/(\d+)\/assign$/);
    if (convAssignMatch && req.method === 'POST') {
      if (!can(user, 'inbox', 'edit')) return forbidden();
      const conv = db.conversations.find((x) => x.id === Number(convAssignMatch[1]));
      if (!conv) return send(res, 404, { error: 'conversation not found' }, p);
      if (!body.assigned_to) return send(res, 400, { error: 'assigned_to is required' }, p);
      conv.assigned_to = body.assigned_to; audit(actor, 'conversation', conv.id, 'assigned', { assigned_to: body.assigned_to }); save(); return send(res, 200, conv, p);
    }
    const convReadMatch = p.match(/^\/api\/conversations\/(\d+)\/read$/);
    if (convReadMatch && req.method === 'POST') {
      if (!can(user, 'inbox', 'edit')) return forbidden();
      const conv = db.conversations.find((x) => x.id === Number(convReadMatch[1]));
      if (!conv) return send(res, 404, { error: 'conversation not found' }, p);
      conv.unread_count = 0; audit(actor, 'conversation', conv.id, 'marked_read'); save(); return send(res, 200, conv, p);
    }
    const convPinMatch = p.match(/^\/api\/conversations\/(\d+)\/pin$/);
    if (convPinMatch && req.method === 'POST') {
      if (!can(user, 'inbox', 'edit')) return forbidden();
      const conv = db.conversations.find((x) => x.id === Number(convPinMatch[1]));
      if (!conv) return send(res, 404, { error: 'conversation not found' }, p);
      conv.pinned = !conv.pinned; audit(actor, 'conversation', conv.id, conv.pinned ? 'pinned' : 'unpinned'); save(); return send(res, 200, conv, p);
    }
    const convReplyMatch = p.match(/^\/api\/conversations\/(\d+)\/reply$/);
    if (convReplyMatch && req.method === 'POST') {
      if (!can(user, 'inbox', 'create')) return forbidden();
      const conv = db.conversations.find((x) => x.id === Number(convReplyMatch[1]));
      if (!conv) return send(res, 404, { error: 'conversation not found' }, p);
      if (!body.body && !body.template_name) return send(res, 400, { error: 'body or template_name is required for a reply' }, p);
      const m = { id: nextId(), conversation_id: conv.id, direction: 'out', sender_name: body.sender_name || actor, body: body.body || null, template_name: body.template_name || null, is_internal_note: !!body.is_internal_note, is_demo: !!body.is_demo || !!conv.is_demo, reply_to_id: body.reply_to_id || null, buttons: Array.isArray(body.buttons) ? body.buttons : undefined, created_at: new Date().toISOString() };
      db.messages.push(m); audit(actor, 'message', m.id, 'sent'); return send(res, 201, m, p);
    }
    const customerMessagesMatch = p.match(/^\/api\/customer\/conversations\/(\d+)\/messages$/);
    if (customerMessagesMatch && req.method === 'GET') {
      if (!can(user, 'inbox', 'view')) return forbidden();
      const conv = db.conversations.find((x) => x.id === Number(customerMessagesMatch[1]));
      if (!conv) return send(res, 404, { error: 'conversation not found' }, p);
      // Customer view: internal notes are NEVER returned here.
      return send(res, 200, db.messages.filter((m) => m.conversation_id === conv.id && !m.is_internal_note), p);
    }
    if (p === '/api/messages' && req.method === 'GET') {
      if (!can(user, 'inbox', 'view')) return forbidden();
      let list = db.messages;
      if (url.searchParams.has('conversation_id')) list = list.filter((m) => String(m.conversation_id) === url.searchParams.get('conversation_id'));
      if (url.searchParams.has('direction')) list = list.filter((m) => m.direction === url.searchParams.get('direction'));
      if (url.searchParams.get('internal') === 'false') list = list.filter((m) => !m.is_internal_note);
      if (url.searchParams.get('internal') === 'true') list = list.filter((m) => !!m.is_internal_note);
      if (url.searchParams.has('q')) { const q = url.searchParams.get('q').trim().toLowerCase(); if (q) list = list.filter((m) => String(m.body || '').toLowerCase().includes(q) || String(m.template_name || '').toLowerCase().includes(q)); }
      return send(res, 200, list, p);
    }
    if (p === '/api/messages' && req.method === 'POST') {
      if (!can(user, 'inbox', 'create')) return forbidden();
      if (!body.body && !body.template_name) return send(res, 400, { error: 'body or template_name is required' }, p);
      const m = { id: nextId(), conversation_id: body.conversation_id || null, direction: body.direction || 'out', sender_name: body.sender_name || actor, body: body.body || null, template_name: body.template_name || null, is_internal_note: !!body.is_internal_note, is_demo: !!body.is_demo, reply_to_id: body.reply_to_id || null, buttons: Array.isArray(body.buttons) ? body.buttons : undefined, created_at: new Date().toISOString() };
      db.messages.push(m);
      if (m.direction === 'in' && !m.is_internal_note && m.conversation_id) bumpUnread(m.conversation_id);
      audit(actor, 'message', m.id, 'sent'); return send(res, 201, m, p);
    }

    // ---- Ops tasks ----
    if (p === '/api/tasks' && req.method === 'GET') {
      if (!can(user, 'tasks', 'view')) return forbidden();
      let list = db.tasks;
      if (url.searchParams.has('status')) list = list.filter((t) => t.status === url.searchParams.get('status'));
      if (url.searchParams.has('contract_id')) list = list.filter((t) => String(t.contract_id) === url.searchParams.get('contract_id'));
      if (url.searchParams.has('assigned_to')) list = list.filter((t) => String(t.assigned_to) === url.searchParams.get('assigned_to'));
      if (url.searchParams.has('type')) list = list.filter((t) => t.type === url.searchParams.get('type'));
      return send(res, 200, list, p);
    }
    if (p === '/api/tasks' && req.method === 'POST') {
      if (!can(user, 'tasks', 'create')) return forbidden();
      if (!body.title) return send(res, 400, { error: 'title is required — العنوان مطلوب' }, p);
      const t = { id: nextId(), contract_id: body.contract_id || null, title: body.title, type: body.type || 'general', status: 'open', assigned_to: body.assigned_to || null, created_at: new Date().toISOString() };
      db.tasks.push(t); audit(actor, 'task', t.id, 'created'); return send(res, 201, t, p);
    }
    const taskActionMatch = p.match(/^\/api\/tasks\/(\d+)\/(complete|cancel)$/);
    if (taskActionMatch && req.method === 'POST') {
      if (!canAny(user, 'tasks', ['edit', 'approve'])) return forbidden();
      const t = db.tasks.find((x) => x.id === Number(taskActionMatch[1]));
      if (!t) return send(res, 404, { error: 'task not found' }, p);
      if (t.status === 'completed' || t.status === 'cancelled') return send(res, 400, { error: `task already ${t.status}` }, p);
      t.status = taskActionMatch[2] === 'complete' ? 'completed' : 'cancelled';
      audit(actor, 'task', t.id, t.status); save(); return send(res, 200, t, p);
    }
    const taskSingleMatch = p.match(/^\/api\/tasks\/(\d+)$/);
    if (taskSingleMatch) {
      const t = db.tasks.find((x) => x.id === Number(taskSingleMatch[1]));
      if (!t) return send(res, 404, { error: 'task not found' }, p);
      if (req.method === 'GET') {
        if (!can(user, 'tasks', 'view')) return forbidden();
        return send(res, 200, t, p);
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (!can(user, 'tasks', 'edit')) return forbidden();
        if (body.status !== undefined && !['open', 'completed', 'cancelled'].includes(body.status)) return send(res, 400, { error: 'status must be open, completed or cancelled' }, p);
        if ((t.status === 'completed' || t.status === 'cancelled') && body.status === 'open') return send(res, 400, { error: `task already ${t.status}` }, p);
        if (body.status !== undefined) t.status = body.status;
        if (body.assigned_to !== undefined) t.assigned_to = body.assigned_to;
        if (body.title !== undefined) t.title = body.title;
        audit(actor, 'task', t.id, 'updated'); save(); return send(res, 200, t, p);
      }
    }

    // ---- Workflow designer (automation section) ----
    if (p === '/api/workflows' && req.method === 'GET') {
      if (!can(user, 'automation', 'view')) return forbidden();
      let list = db.workflows;
      if (url.searchParams.has('is_active')) list = list.filter((w) => String(w.is_active) === url.searchParams.get('is_active'));
      return send(res, 200, list, p);
    }
    if (p === '/api/workflows' && req.method === 'POST') {
      if (!can(user, 'automation', 'create')) return forbidden();
      if (!body.name) return send(res, 400, { error: 'name is required' }, p);
      if (hasBannedStep(body.steps)) return send(res, 400, { error: 'money steps are never allowed in a workflow: ' + BANNED_STEP_TYPES.join(', ') }, p);
      const w = { id: nextId(), name: body.name, trigger_type: body.trigger_type || 'keyword', trigger_value: body.trigger_value || null, steps: normaliseSteps(body.steps), is_active: (body.is_active !== undefined ? !!body.is_active : true) };
      db.workflows.push(w); audit(actor, 'workflow', w.id, 'created'); return send(res, 201, w, p);
    }
    const workflowCopyMatch = p.match(/^\/api\/workflows\/(\d+)\/copy$/);
    if (workflowCopyMatch && req.method === 'POST') {
      if (!can(user, 'automation', 'edit')) return forbidden();
      const src = db.workflows.find((x) => x.id === Number(workflowCopyMatch[1]));
      if (!src) return send(res, 404, { error: 'workflow not found' }, p);
      const w = { id: nextId(), name: src.name + ' (نسخة)', trigger_type: src.trigger_type, trigger_value: src.trigger_value, steps: JSON.parse(JSON.stringify(src.steps || [])), is_active: true };
      db.workflows.push(w); audit(actor, 'workflow', w.id, 'copied', { source_workflow_id: src.id }); return send(res, 201, w, p);
    }
    const workflowSingleMatch = p.match(/^\/api\/workflows\/(\d+)$/);
    if (workflowSingleMatch) {
      const w = db.workflows.find((x) => x.id === Number(workflowSingleMatch[1]));
      if (!w) return send(res, 404, { error: 'workflow not found' }, p);
      if (req.method === 'GET') {
        if (!can(user, 'automation', 'view')) return forbidden();
        return send(res, 200, w, p);
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (!can(user, 'automation', 'edit')) return forbidden();
        if (body.steps !== undefined && hasBannedStep(body.steps)) return send(res, 400, { error: 'money steps are never allowed in a workflow: ' + BANNED_STEP_TYPES.join(', ') }, p);
        if (body.name !== undefined) w.name = body.name;
        if (body.trigger_type !== undefined) w.trigger_type = body.trigger_type;
        if (body.trigger_value !== undefined) w.trigger_value = body.trigger_value;
        if (body.steps !== undefined) w.steps = normaliseSteps(body.steps);
        if (body.is_active !== undefined) w.is_active = !!body.is_active;
        audit(actor, 'workflow', w.id, 'updated'); save(); return send(res, 200, w, p);
      }
      if (req.method === 'DELETE') {
        if (!can(user, 'automation', 'edit')) return forbidden();
        db.workflows = db.workflows.filter((x) => x.id !== w.id);
        audit(actor, 'workflow', w.id, 'deleted'); return send(res, 200, { ok: true, deleted_id: w.id }, p);
      }
    }

    // ---- Templates (whatsapp section) ----
    if (p === '/api/templates' && req.method === 'GET') {
      if (!can(user, 'whatsapp', 'view')) return forbidden();
      return send(res, 200, db.templates, p);
    }
    const templateSingleMatch = p.match(/^\/api\/templates\/(\d+)$/);
    if (templateSingleMatch) {
      const t = db.templates.find((x) => x.id === Number(templateSingleMatch[1]));
      if (!t) return send(res, 404, { error: 'template not found' }, p);
      if (req.method === 'GET') {
        if (!can(user, 'whatsapp', 'view')) return forbidden();
        return send(res, 200, t, p);
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (!can(user, 'whatsapp', 'edit')) return forbidden();
        // Only approval_status may change through this endpoint.
        if (!TEMPLATE_STATUSES.includes(body.approval_status)) return send(res, 400, { error: 'approval_status must be one of: ' + TEMPLATE_STATUSES.join(', ') }, p);
        t.approval_status = body.approval_status;
        audit(actor, 'template', t.id, 'approval_updated', { approval_status: t.approval_status }); save(); return send(res, 200, t, p);
      }
    }

    // ---- Stage C: contacts (contract-scoped only, whatsapp permission family) ----
    // No broadcast route exists and none is added here: contacts are never
    // an audience. Import deduplicates by phone and reports every row.
    if (p === '/api/contacts' && req.method === 'GET') {
      if (!can(user, 'whatsapp', 'view')) return forbidden();
      let list = db.contacts.map(contactPublic);
      if (url.searchParams.has('q')) {
        const q = url.searchParams.get('q').trim().toLowerCase();
        const qDigits = q.replace(/^\+/, '').replace(/[\s\-()]/g, '');
        if (q) list = list.filter((c) => (c.name || '').toLowerCase().includes(q) || phoneKey(c.phone).includes(qDigits) || (c.labels || []).some((l) => l.toLowerCase().includes(q)));
      }
      if (url.searchParams.has('segment')) {
        const seg = url.searchParams.get('segment').trim().toLowerCase();
        if (seg) list = list.filter((c) => (c.labels || []).some((l) => l.toLowerCase() === seg));
      }
      if (url.searchParams.has('role')) {
        const role = url.searchParams.get('role');
        if (role === 'buyer' || role === 'seller') list = list.filter((c) => c.roles.includes(role));
      }
      if (url.searchParams.has('last_contact_after')) {
        const after = url.searchParams.get('last_contact_after');
        list = list.filter((c) => c.last_contact_at && c.last_contact_at >= after);
      }
      if (url.searchParams.has('last_contact_before')) {
        const before = url.searchParams.get('last_contact_before');
        list = list.filter((c) => c.last_contact_at && c.last_contact_at <= before);
      }
      if (url.searchParams.get('has_contract') === 'true') list = list.filter((c) => c.contracts.length > 0);
      if (url.searchParams.get('has_contract') === 'false') list = list.filter((c) => c.contracts.length === 0);
      if (url.searchParams.get('eligible') === 'true') list = list.filter((c) => c.utility_eligible);
      if (url.searchParams.get('eligible') === 'false') list = list.filter((c) => !c.utility_eligible);
      // Most recently contacted first; never-contacted contacts last.
      list.sort((a, b) => {
        if (a.last_contact_at && b.last_contact_at) return a.last_contact_at < b.last_contact_at ? 1 : -1;
        if (a.last_contact_at) return -1;
        if (b.last_contact_at) return 1;
        return b.id - a.id;
      });
      return send(res, 200, list, p);
    }
    if (p === '/api/contacts' && req.method === 'POST') {
      if (!can(user, 'whatsapp', 'edit')) return forbidden();
      const badField = rejectUnknown(body, ['name', 'phone', 'labels', 'notes']);
      if (badField) return send(res, 400, { error: badField }, p);
      if (!body.phone || !validContactPhone(body.phone)) return send(res, 400, { error: 'phone is required and must be 7-15 digits (optional leading +)' }, p);
      if (db.contacts.some((c) => phoneKey(c.phone) === phoneKey(body.phone))) return send(res, 409, { error: 'contact already exists for this phone' }, p);
      const c = { id: nextId(), name: (body.name && String(body.name).trim()) || normPhone(body.phone), phone: normPhone(body.phone), labels: parseContactLabels(body.labels), notes: body.notes ? String(body.notes).slice(0, 1000) : null, created_at: new Date().toISOString() };
      db.contacts.push(c); audit(actor, 'contact', c.id, 'contact_created', { phone: c.phone }); save(); return send(res, 201, contactPublic(c), p);
    }
    if (p === '/api/contacts/import' && req.method === 'POST') {
      if (!can(user, 'whatsapp', 'edit')) return forbidden();
      if (!body.csv || typeof body.csv !== 'string') return send(res, 400, { error: 'csv is required (CSV text with a phone column)' }, p);
      const rows = parseCsv(body.csv);
      if (rows.length < 2) return send(res, 400, { error: 'csv must contain a header row and at least one data row' }, p);
      if (rows.length - 1 > 1000) return send(res, 400, { error: 'csv import is limited to 1000 data rows' }, p);
      const header = rows[0].map((h) => String(h).trim().toLowerCase());
      const col = (names) => { for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i; } return -1; };
      const phoneIdx = col(['phone', 'phone_number', 'mobile', 'رقم', 'الهاتف']);
      if (phoneIdx === -1) return send(res, 400, { error: 'csv must contain a phone column (phone / phone_number / mobile)' }, p);
      const nameIdx = col(['name', 'full_name', 'fullname', 'الاسم']);
      const labelsIdx = col(['labels', 'label', 'segments', 'segment', 'التصنيفات']);
      const notesIdx = col(['notes', 'note', 'ملاحظات']);
      const seenInFile = new Set();
      let created = 0, skipped = 0; const errors = []; const details = []; const createdIds = [];
      rows.slice(1).forEach((r, i) => {
        const line = i + 2; // header is line 1
        const rawPhone = (r[phoneIdx] || '').trim();
        if (!rawPhone || !validContactPhone(rawPhone)) { errors.push({ row: line, phone: rawPhone || null, status: 'error', reason: 'invalid or missing phone' }); details.push({ row: line, phone: rawPhone || null, status: 'error', reason: 'invalid or missing phone' }); return; }
        const key = phoneKey(rawPhone);
        if (seenInFile.has(key)) { skipped++; details.push({ row: line, phone: normPhone(rawPhone), status: 'skipped', reason: 'duplicate_in_file' }); return; }
        seenInFile.add(key);
        if (db.contacts.some((c) => phoneKey(c.phone) === key)) { skipped++; details.push({ row: line, phone: normPhone(rawPhone), status: 'skipped', reason: 'duplicate_existing' }); return; }
        const c = { id: nextId(), name: (nameIdx !== -1 && r[nameIdx] && String(r[nameIdx]).trim()) || normPhone(rawPhone), phone: normPhone(rawPhone), labels: labelsIdx !== -1 ? parseContactLabels(r[labelsIdx] || '') : [], notes: notesIdx !== -1 && r[notesIdx] ? String(r[notesIdx]).slice(0, 1000) : null, created_at: new Date().toISOString() };
        db.contacts.push(c); createdIds.push(c.id); created++;
        details.push({ row: line, phone: c.phone, status: 'created', reason: null });
      });
      audit(actor, 'contact', 0, 'contacts_imported', { created, skipped, errors: errors.length });
      save();
      return send(res, 200, { ok: true, total: rows.length - 1, created, skipped, errors: errors.length, created_ids: createdIds, details, error_rows: errors }, p);
    }
    if (p === '/api/contacts/export' && req.method === 'GET') {
      if (!can(user, 'whatsapp', 'view')) return forbidden();
      const lines = [['name', 'phone', 'labels', 'notes', 'roles', 'last_contact_at', 'utility_eligible'].join(',')];
      for (const c of db.contacts.map(contactPublic)) {
        lines.push([csvEscape(c.name), csvEscape(c.phone), csvEscape((c.labels || []).join(',')), csvEscape(c.notes || ''), csvEscape((c.roles || []).join(',')), csvEscape(c.last_contact_at || ''), c.utility_eligible ? 'yes' : 'no'].join(','));
      }
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="contacts.csv"', ...securityHeaders(p) });
      return res.end('\ufeff' + lines.join('\r\n'));
    }
    const contactSingleMatch = p.match(/^\/api\/contacts\/(\d+)$/);
    if (contactSingleMatch) {
      const c = db.contacts.find((x) => x.id === Number(contactSingleMatch[1]));
      if (!c) return send(res, 404, { error: 'contact not found' }, p);
      if (req.method === 'GET') {
        if (!can(user, 'whatsapp', 'view')) return forbidden();
        return send(res, 200, contactPublic(c), p);
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (!can(user, 'whatsapp', 'edit')) return forbidden();
        const badField = rejectUnknown(body, ['name', 'phone', 'labels', 'notes']);
        if (badField) return send(res, 400, { error: badField }, p);
        if (body.phone !== undefined && !validContactPhone(body.phone)) return send(res, 400, { error: 'phone must be 7-15 digits (optional leading +)' }, p);
        if (body.phone !== undefined && db.contacts.some((x) => x.id !== c.id && phoneKey(x.phone) === phoneKey(body.phone))) return send(res, 409, { error: 'contact already exists for this phone' }, p);
        if (body.name !== undefined) c.name = String(body.name).trim() || c.name;
        if (body.phone !== undefined) c.phone = normPhone(body.phone);
        if (body.labels !== undefined) c.labels = parseContactLabels(body.labels);
        if (body.notes !== undefined) c.notes = body.notes ? String(body.notes).slice(0, 1000) : null;
        audit(actor, 'contact', c.id, 'contact_updated', { phone: c.phone }); save(); return send(res, 200, contactPublic(c), p);
      }
      if (req.method === 'DELETE') {
        if (!can(user, 'whatsapp', 'edit')) return forbidden();
        db.contacts = db.contacts.filter((x) => x.id !== c.id);
        audit(actor, 'contact', c.id, 'contact_deleted', { phone: c.phone }); save(); return send(res, 200, { ok: true, deleted_id: c.id }, p);
      }
    }

    // ---- Automation rules + Kill Switch ----
    if (p === '/api/automation/rules' && req.method === 'GET') {
      if (!can(user, 'automation', 'view')) return forbidden();
      return send(res, 200, db.rules, p);
    }
    if (p === '/api/automation/rules' && req.method === 'POST') {
      if (!can(user, 'automation', 'create')) return forbidden();
      if (!body.name) return send(res, 400, { error: 'name is required' }, p);
      if (hasBannedStep(body.steps) || hasBannedStep(body.actions)) return send(res, 400, { error: 'money steps are never allowed in an automation rule: ' + BANNED_STEP_TYPES.join(', ') }, p);
      const forcedInactive = !!db.killSwitch;
      const r = { id: nextId(), name: body.name, category: body.category || 'general', trigger_type: body.trigger_type || null, trigger_value: body.trigger_value || null, steps: normaliseSteps(body.steps), actions: body.actions || [], is_active: (forcedInactive ? false : (body.is_active !== undefined ? !!body.is_active : true)), deactivated_by_kill_switch: forcedInactive, created_at: new Date().toISOString() };
      db.rules.push(r); audit(actor, 'automation_rule', r.id, 'created', { is_active: r.is_active, kill_switch_on: forcedInactive }); return send(res, 201, r, p);
    }
    const ruleToggleMatch = p.match(/^\/api\/automation\/rules\/(\d+)\/toggle$/);
    if (ruleToggleMatch && req.method === 'POST') {
      if (!can(user, 'automation', 'edit')) return forbidden();
      const r = db.rules.find((x) => x.id === Number(ruleToggleMatch[1]));
      if (!r) return send(res, 404, { error: 'automation rule not found' }, p);
      r.is_active = db.killSwitch ? false : !r.is_active;
      r.deactivated_by_kill_switch = !!db.killSwitch && !r.is_active;
      audit(actor, 'automation_rule', r.id, 'toggled', { is_active: r.is_active }); save(); return send(res, 200, r, p);
    }
    const ruleSingleMatch = p.match(/^\/api\/automation\/rules\/(\d+)$/);
    if (ruleSingleMatch && req.method === 'GET') {
      if (!can(user, 'automation', 'view')) return forbidden();
      const r = db.rules.find((x) => x.id === Number(ruleSingleMatch[1]));
      if (!r) return send(res, 404, { error: 'automation rule not found' }, p);
      return send(res, 200, r, p);
    }

    // ---- Stage B: automation execution endpoints ----
    const wfRunMatch = p.match(/^\/api\/workflows\/(\d+)\/run$/);
    if (wfRunMatch && req.method === 'POST') {
      if (!can(user, 'automation', 'edit')) return forbidden();
      const w = db.workflows.find((x) => x.id === Number(wfRunMatch[1]));
      if (!w) return send(res, 404, { error: 'workflow not found' }, p);
      const conv = db.conversations.find((x) => x.id === Number(body.conversation_id));
      if (!conv) return send(res, 400, { error: 'conversation_id is required' }, p);
      if (hasBannedStep(w.steps)) return send(res, 400, { error: 'money steps are never allowed in a workflow: ' + BANNED_STEP_TYPES.join(', ') }, p);
      const r = await runAutomation(conv, { ...w, _kind: 'workflow' }, { manual: true, inboundText: body.inbound_text || '' });
      return send(res, 200, { ok: r.ran, ...r, workflow_id: w.id, conversation_id: conv.id }, p);
    }
    const ruleRunMatch = p.match(/^\/api\/automation\/rules\/(\d+)\/run$/);
    if (ruleRunMatch && req.method === 'POST') {
      if (!can(user, 'automation', 'edit')) return forbidden();
      const r0 = db.rules.find((x) => x.id === Number(ruleRunMatch[1]));
      if (!r0) return send(res, 404, { error: 'automation rule not found' }, p);
      const conv = db.conversations.find((x) => x.id === Number(body.conversation_id));
      if (!conv) return send(res, 400, { error: 'conversation_id is required' }, p);
      if (hasBannedStep(r0.steps) || hasBannedStep(r0.actions)) return send(res, 400, { error: 'money steps are never allowed in an automation rule: ' + BANNED_STEP_TYPES.join(', ') }, p);
      const r = await runAutomation(conv, { ...r0, _kind: 'rule' }, { manual: true, inboundText: body.inbound_text || '' });
      return send(res, 200, { ok: r.ran, ...r, workflow_id: r0.id, conversation_id: conv.id }, p);
    }
    const convAutoMatch = p.match(/^\/api\/conversations\/(\d+)\/automation\/(handoff|resume)$/);
    if (convAutoMatch && req.method === 'POST') {
      if (!can(user, 'automation', 'edit')) return forbidden();
      const conv = db.conversations.find((x) => x.id === Number(convAutoMatch[1]));
      if (!conv) return send(res, 404, { error: 'conversation not found' }, p);
      convAutomationState(conv);
      if (convAutoMatch[2] === 'handoff') {
        conv.automation_handed_off = true; conv.automation_waiting = null;
        audit(actor, 'conversation', conv.id, 'automation_handoff_manual', {});
      } else {
        conv.automation_handed_off = false; conv.automation_waiting = null; conv.automation_unknown_count = 0; conv.automation_last_run = {}; conv.automation_recent_runs = [];
        audit(actor, 'conversation', conv.id, 'automation_resumed', {});
      }
      save(); return send(res, 200, { ok: true, conversation_id: conv.id, handed_off: conv.automation_handed_off, waiting: conv.automation_waiting }, p);
    }
    const convAutoStateMatch = p.match(/^\/api\/conversations\/(\d+)\/automation$/);
    if (convAutoStateMatch && req.method === 'GET') {
      if (!can(user, 'automation', 'view')) return forbidden();
      const conv = db.conversations.find((x) => x.id === Number(convAutoStateMatch[1]));
      if (!conv) return send(res, 404, { error: 'conversation not found' }, p);
      convAutomationState(conv);
      return send(res, 200, { conversation_id: conv.id, handed_off: conv.automation_handed_off, waiting: conv.automation_waiting, unknown_count: conv.automation_unknown_count, labels: conv.labels }, p);
    }
    if (p === '/api/automation/logs' && req.method === 'GET') {
      if (!can(user, 'automation', 'view')) return forbidden();
      let list = db.automation_logs;
      if (url.searchParams.has('conversation_id')) list = list.filter((x) => String(x.conversation_id) === url.searchParams.get('conversation_id'));
      if (url.searchParams.has('workflow_id')) list = list.filter((x) => String(x.workflow_id) === url.searchParams.get('workflow_id'));
      if (url.searchParams.has('outcome')) list = list.filter((x) => x.outcome === url.searchParams.get('outcome'));
      return send(res, 200, list, p);
    }
    // ---- Stage B: uploads list + Meta media download link ----
    if (p === '/api/whatsapp/uploads' && req.method === 'GET') {
      if (!can(user, 'whatsapp', 'view')) return forbidden();
      let list = db.uploads.map(publicUpload);
      if (url.searchParams.has('conversation_id')) list = list.filter((x) => String(x.conversation_id) === url.searchParams.get('conversation_id'));
      return send(res, 200, list, p);
    }
    const mediaUrlMatch = p.match(/^\/api\/whatsapp\/media\/([^/]+)$/);
    if (mediaUrlMatch && req.method === 'GET') {
      if (!can(user, 'whatsapp', 'view')) return forbidden();
      const cfg = metaConfig();
      if (!cfg.configured) return send(res, 200, { ok: true, configured: false, download_url: null, message: 'Meta is not configured — no download link available' }, p);
      const r = await metaRequest('GET', '/' + encodeURIComponent(mediaUrlMatch[1]), null);
      if (!r.ok) return send(res, 502, { ok: false, configured: true, meta_error_code: r.meta_error_code || null, error: r.error || 'meta request failed' }, p);
      return send(res, 200, { ok: true, configured: true, media_id: mediaUrlMatch[1], download_url: (r.data && r.data.url) || null, mime_type: (r.data && r.data.mime_type) || null, file_size: (r.data && r.data.file_size) || null }, p);
    }

    // ---- Unified workspace additions (Stage 2-4): tags, quick replies,
    // macros (one engine), scheduled contract reminders, reports ----
    const convTagsMatch = p.match(/^\/api\/conversations\/(\d+)\/tags$/);
    if (convTagsMatch && req.method === 'POST') {
      if (!can(user, 'inbox', 'edit')) return forbidden();
      const conv = db.conversations.find((x) => x.id === Number(convTagsMatch[1]));
      if (!conv) return send(res, 404, { error: 'conversation not found' }, p);
      if (!Array.isArray(body.labels) || body.labels.some((l) => typeof l !== 'string') || body.labels.length > 20) return send(res, 400, { error: 'labels must be an array of at most 20 strings' }, p);
      conv.labels = body.labels.map((l) => String(l).trim()).filter(Boolean);
      audit(actor, 'conversation', conv.id, 'tags_updated', { labels: conv.labels }); save();
      return send(res, 200, conv, p);
    }
    // Quick replies (canned responses, `/shortcut` in the composer).
    // Stored server-side so every operator sees the same library; they
    // insert text into the composer only — nothing is auto-sent.
    if (p === '/api/quick-replies' && req.method === 'GET') {
      if (!can(user, 'inbox', 'view')) return forbidden();
      return send(res, 200, db.quick_replies, p);
    }
    if (p === '/api/quick-replies' && req.method === 'POST') {
      if (!can(user, 'inbox', 'edit')) return forbidden();
      if (!body.shortcut || !/^\/[a-z0-9_\-]+$/.test(String(body.shortcut))) return send(res, 400, { error: 'shortcut must start with / and contain only lowercase letters, digits, _ or -' }, p);
      if (!body.body || !String(body.body).trim()) return send(res, 400, { error: 'body is required' }, p);
      if (db.quick_replies.some((q) => q.shortcut === body.shortcut)) return send(res, 409, { error: 'quick reply shortcut already exists' }, p);
      const q = { id: nextId(), shortcut: body.shortcut, body: String(body.body).slice(0, 2000), created_at: new Date().toISOString() };
      db.quick_replies.push(q); audit(actor, 'quick_reply', q.id, 'quick_reply_created', { shortcut: q.shortcut }); save();
      return send(res, 201, q, p);
    }
    const qrMatch = p.match(/^\/api\/quick-replies\/(\d+)$/);
    if (qrMatch && req.method === 'DELETE') {
      if (!can(user, 'inbox', 'edit')) return forbidden();
      const q = db.quick_replies.find((x) => x.id === Number(qrMatch[1]));
      if (!q) return send(res, 404, { error: 'quick reply not found' }, p);
      db.quick_replies = db.quick_replies.filter((x) => x.id !== q.id);
      audit(actor, 'quick_reply', q.id, 'quick_reply_deleted', { shortcut: q.shortcut }); save();
      return send(res, 200, { ok: true, deleted_id: q.id }, p);
    }
    // Macros: saved multi-action sequences run by one click. A macro IS a
    // workflow (category 'macro', trigger manual) in the ONE engine —
    // there is no second macro store and no second executor. Money steps
    // are rejected at save (below) and again at execution (runAutomation).
    if (p === '/api/automation/macros' && req.method === 'GET') {
      if (!can(user, 'automation', 'view')) return forbidden();
      return send(res, 200, db.workflows.filter((w) => w.category === 'macro'), p);
    }
    if (p === '/api/automation/macros' && req.method === 'POST') {
      if (!can(user, 'automation', 'create')) return forbidden();
      if (!body.name) return send(res, 400, { error: 'name is required' }, p);
      if (hasBannedStep(body.steps)) return send(res, 400, { error: 'money steps are never allowed in a macro: ' + BANNED_STEP_TYPES.join(', ') }, p);
      const w = { id: nextId(), name: body.name, category: 'macro', trigger_type: 'manual', trigger_value: null, steps: normaliseSteps(body.steps), is_active: true };
      db.workflows.push(w); audit(actor, 'workflow', w.id, 'macro_created'); save();
      return send(res, 201, w, p);
    }
    const macroRunMatch = p.match(/^\/api\/automation\/macros\/(\d+)\/run$/);
    if (macroRunMatch && req.method === 'POST') {
      if (!can(user, 'automation', 'edit')) return forbidden();
      const w = db.workflows.find((x) => x.id === Number(macroRunMatch[1]) && x.category === 'macro');
      if (!w) return send(res, 404, { error: 'macro not found' }, p);
      const conv = db.conversations.find((x) => x.id === Number(body.conversation_id));
      if (!conv) return send(res, 400, { error: 'conversation_id is required' }, p);
      if (hasBannedStep(w.steps)) return send(res, 400, { error: 'money steps are never allowed in a macro: ' + BANNED_STEP_TYPES.join(', ') }, p);
      const r = await runAutomation(conv, { ...w, _kind: 'workflow' }, { manual: true, inboundText: body.inbound_text || '' });
      return send(res, 200, { ok: r.ran, ...r, workflow_id: w.id, conversation_id: conv.id }, p);
    }
    // Scheduled runs: ONLY contract-linked reminders. The caller names a
    // contract; only workflows/rules with trigger_type scheduled_reminder
    // run, against that contract's conversations. No campaign, no broadcast.
    if (p === '/api/automation/scheduled-run' && req.method === 'POST') {
      if (!can(user, 'automation', 'edit')) return forbidden();
      const contract = db.contracts.find((x) => x.id === Number(body.contract_id));
      if (!contract) return send(res, 400, { error: 'contract_id is required and must match an existing contract' }, p);
      const convs = db.conversations.filter((c) => c.contract_id === contract.id);
      const candidates = allAutomationCandidates().filter((w) => w.trigger_type === 'scheduled_reminder' || w.trigger_type === 'scheduled');
      const results = [];
      for (const conv of convs) {
        for (const w of candidates) {
          if (hasBannedStep(w.steps || w.actions)) { automationLog(conv, w, 'blocked_money_step', {}); continue; }
          results.push(await runAutomation(conv, w, { manual: true, inboundText: '' }));
        }
      }
      audit(actor, 'automation', 0, 'scheduled_run', { contract_id: contract.id, runs: results.length });
      save();
      return send(res, 200, { ok: true, contract_id: contract.id, conversations: convs.length, candidates: candidates.length, results }, p);
    }
    // Reports: REAL numbers from the server only — never demo numbers.
    // First-response time = first inbound -> first later outbound, per
    // conversation, averaged over conversations that have both.
    if (p === '/api/reports/summary' && req.method === 'GET') {
      if (!can(user, 'dashboard', 'view')) return forbidden();
      const byState = {};
      for (const st of STATES) byState[st] = db.contracts.filter((c) => !c.is_demo && c.state === st).length;
      const unreadTotal = db.conversations.filter((c) => !c.is_demo).reduce((s, c) => s + (c.unread_count || 0), 0);
      const frtMinutes = [];
      for (const conv of db.conversations.filter((c) => !c.is_demo)) {
        const msgs = db.messages.filter((m) => m.conversation_id === conv.id && !m.is_internal_note).sort((a, b) => a.id - b.id);
        const firstIn = msgs.find((m) => m.direction === 'in');
        if (!firstIn) continue;
        const firstOut = msgs.find((m) => m.direction === 'out' && m.id > firstIn.id);
        if (!firstOut) continue;
        const t1 = Date.parse(firstIn.created_at), t2 = Date.parse(firstOut.created_at);
        if (Number.isFinite(t1) && Number.isFinite(t2) && t2 >= t1) frtMinutes.push((t2 - t1) / 60000);
      }
      const avgFrt = frtMinutes.length ? Math.round(frtMinutes.reduce((a, b) => a + b, 0) / frtMinutes.length) : null;
      const logByOutcome = {};
      for (const l of db.automation_logs) logByOutcome[l.outcome] = (logByOutcome[l.outcome] || 0) + 1;
      return send(res, 200, {
        generated_at: new Date().toISOString(),
        contracts_total: db.contracts.filter((c) => !c.is_demo).length,
        contracts_by_state: byState,
        conversations_total: db.conversations.filter((c) => !c.is_demo).length,
        unread_total: unreadTotal,
        open_tasks: db.tasks.filter((t) => t.status === 'open').length,
        templates_total: db.templates.length,
        templates_local_approved: db.templates.filter((t) => t.approval_status === 'approved').length,
        templates_meta_approved: db.templates.filter((t) => t.meta_status === 'approved').length,
        templates_meta_rejected: db.templates.filter((t) => t.meta_status === 'rejected').length,
        automation_logs_total: db.automation_logs.length,
        automation_by_outcome: logByOutcome,
        kill_switch: !!db.killSwitch,
        first_response: { conversations_measured: frtMinutes.length, avg_minutes: avgFrt },
        audit_total: db.audit.length,
        contacts_total: db.contacts.length,
        uploads_total: db.uploads.length,
      }, p);
    }
    if (p === '/api/reports/audit.csv' && req.method === 'GET') {
      if (!can(user, 'audit', 'view')) return forbidden();
      const lines = [['id', 'actor', 'entity', 'entity_id', 'action', 'created_at'].join(',')];
      for (const a of db.audit) lines.push([a.id, csvEscape(a.actor), csvEscape(a.entity), a.entity_id, csvEscape(a.action), csvEscape(a.created_at)].join(','));
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit.csv"', ...securityHeaders(p) });
      return res.end('\ufeff' + lines.join('\r\n'));
    }
    // Media delete: removes the stored file record (and disk file) only.
    // Messages that used the file keep their own media metadata.
    const uploadDeleteMatch = p.match(/^\/api\/whatsapp\/uploads\/(\d+)$/);
    if (uploadDeleteMatch && req.method === 'DELETE') {
      if (!can(user, 'whatsapp', 'edit')) return forbidden();
      const rec = db.uploads.find((x) => x.id === Number(uploadDeleteMatch[1]));
      if (!rec) return send(res, 404, { error: 'upload not found' }, p);
      try { const fullPath = path.join(UPLOAD_DIR, path.basename(rec.stored_filename)); if (fullPath.startsWith(UPLOAD_DIR)) fs.unlinkSync(fullPath); } catch {}
      db.uploads = db.uploads.filter((x) => x.id !== rec.id);
      audit(actor, 'whatsapp_upload', rec.id, 'whatsapp_upload_deleted', { filename: rec.sanitized_filename });
      save();
      return send(res, 200, { ok: true, deleted_id: rec.id }, p);
    }

    // ---- Audit: GET only (any other method falls through to 404) ----
    if (p === '/api/audit' && req.method === 'GET') {
      if (!can(user, 'audit', 'view')) return forbidden();
      return send(res, 200, db.audit, p);
    }

    // ---- Kill Switch (kept as-is) ----
    if (p === '/api/automation/kill-switch' && req.method === 'POST') {
      if (!can(user, 'automation', 'edit')) return forbidden();
      db.killSwitch = !!body.off; audit(actor, 'automation', 0, body.off ? 'kill_switch_on' : 'kill_switch_off'); return send(res, 200, { killSwitch: db.killSwitch }, p);
    }
    if (p === '/api/automation/kill-switch' && req.method === 'GET') {
      if (!can(user, 'automation', 'view')) return forbidden();
      return send(res, 200, { killSwitch: db.killSwitch }, p);
    }

    return send(res, 404, { error: 'not found' }, p);
  }

  return send(res, 404, { error: 'not found' }, p);
});

if (require.main === module) server.listen(PORT, () => console.log(`Pilot System listening on ${PORT}`));
module.exports = server;
