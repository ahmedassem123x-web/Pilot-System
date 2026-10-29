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

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const FRONTEND_FALLBACK = path.join(__dirname, '..', '..', 'frontend');
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB (all routes except the webhook)
const WEBHOOK_MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB: Meta webhook only

const STATES = ['draft','issued','accepted','payment_pending','payment_confirmed','preparing','delivered','completed','disputed','refund_pending','refunded','cancelled'];
const TRANSITIONS = {
  draft: ['issued','cancelled'],
  issued: ['accepted','cancelled'],
  accepted: ['payment_pending','cancelled'],
  payment_pending: ['payment_confirmed','cancelled'],
  payment_confirmed: ['preparing','cancelled'],
  preparing: ['delivered','disputed'],
  delivered: ['completed','disputed'],
  disputed: ['refund_pending','cancelled','preparing'],
  refund_pending: ['refunded'],
  completed: [], refunded: [], cancelled: [],
};
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
const BANNED_STEP_TYPES = ['release_money', 'refund_money', 'confirm_payment', 'settle_dispute'];
const FILE_KINDS = ['original', 'buyer_signed', 'seller_signed', 'attachment'];
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
const CHECKLIST_STEPS = [
  { step: 1, key: 'meta_business', title_ar: 'حساب Meta Business', description_ar: 'التحقق من حساب Meta Business الحالي قبل إنشاء أي حساب جديد' },
  { step: 2, key: 'dedicated_number', title_ar: 'رقم مخصص للخدمة', description_ar: 'رقم واتساب مخصص لخدمة الوساطة، منفصل عن الرقم الشخصي' },
  { step: 3, key: 'fi_agreement', title_ar: 'اتفاقية المؤسسة المالية', description_ar: 'اتفاقية مع مؤسسة مالية خارجية لحفظ الأموال والتنسيق اليدوي فقط' },
  { step: 4, key: 'templates_approval', title_ar: 'اعتماد القوالب', description_ar: 'اعتماد قوالب واتساب العشرة لدى Meta قبل الإرسال' },
  { step: 5, key: 'env_vars', title_ar: 'متغيرات البيئة', description_ar: 'إعداد متغيرات البيئة عبر القناة الآمنة، دون وضع أسرار في الملفات' },
  { step: 6, key: 'webhook_hmac', title_ar: 'تحقق Webhook وHMAC', description_ar: 'إعداد رمز التحقق وسر التطبيق والتحقق من توقيع Webhook' },
  { step: 7, key: 'test_message', title_ar: 'رسالة اختبار', description_ar: 'إرسال رسالة اختبار عبر واتساب والتأكد من وصولها' },
  { step: 8, key: 'full_cycle_test', title_ar: 'اختبار دورة كاملة', description_ar: 'اختبار دورة عقد كاملة من الإنشاء حتى الإغلاق' },
  { step: 9, key: 'backup_monitoring', title_ar: 'النسخ الاحتياطي والمراقبة', description_ar: 'نسخ احتياطي ومراقبة للسجلات والأعطال' },
  { step: 10, key: 'client_acceptance', title_ar: 'قبول العميل', description_ar: 'قبول العميل النهائي قبل التشغيل الفعلي' },
];

// ---- Token signing secret: env, or a random per-process fallback. ----
// Never a hardcoded default: with no JWT_SECRET, tokens simply do not
// survive a restart, and a warning is logged (no secret value is logged).
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: JWT_SECRET is not set — using a random per-process secret. Tokens will not survive a restart. Set JWT_SECRET in production.');
}

// ---- Password hashing (scrypt, per-user salt) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const hash = crypto.scryptSync(password, parts[1], 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(parts[2], 'hex'));
  } catch { return false; }
}

// ---- Minimal HMAC token (header.payload.signature, 8h expiry) ----
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function signToken(user) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    sub: user.id, email: user.email, role: user.role,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 8 * 3600,
  }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
function verifyToken(token) {
  try {
    const [header, payload, sig] = String(token).split('.');
    if (!header || !payload || !sig) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp * 1000 < Date.now()) return null;
    return data;
  } catch { return null; }
}

// ---- Login rate limiting: max 10 failed attempts per IP per 15 min ----
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILED = 10;
const loginFailures = new Map(); // ip -> { count, resetAt }
function loginBlocked(ip) {
  const rec = loginFailures.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) { loginFailures.delete(ip); return false; }
  return rec.count >= LOGIN_MAX_FAILED;
}
function recordLoginFailure(ip) {
  const now = Date.now();
  const rec = loginFailures.get(ip);
  if (!rec || now > rec.resetAt) loginFailures.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else rec.count += 1;
}
function clearLoginFailures(ip) { loginFailures.delete(ip); }

// ---- Data store ----
function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { users: [], contracts: [], conversations: [], messages: [], tasks: [], workflows: [], templates: [], rules: [], audit: [], killSwitch: false, seq: 1 }; }
}
let db = load();
// Migrate older data files: never drop existing rows, just add new collections.
for (const k of ['users', 'contracts', 'conversations', 'messages', 'tasks', 'workflows', 'templates', 'rules', 'audit', 'contract_versions', 'contract_files']) {
  if (!Array.isArray(db[k])) db[k] = [];
}
if (typeof db.killSwitch !== 'boolean') db.killSwitch = false;
if (typeof db.seq !== 'number') db.seq = 1;
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
function nextId() { return db.seq++; }
function audit(actor, entity, id, action, details = {}) {
  db.audit.push({ id: nextId(), actor, entity, entity_id: id, action, details, created_at: new Date().toISOString() });
  save();
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

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
// Constant-time signature comparison (same-length buffers only; a
// length mismatch is itself a rejection, and lengths here are fixed).
function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ---- Meta WhatsApp Cloud API client (built-ins only) ----
// Env names only; values are never logged, returned, or persisted.
function metaConfig() {
  const mock = process.env.META_MOCK_BASE_URL || '';
  const version = process.env.WHATSAPP_API_VERSION || 'v26.0';
  const token = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';
  return {
    base: (mock || 'https://graph.facebook.com').replace(/\/+$/, ''),
    version, token, phoneId, wabaId, mock: !!mock,
    configured: !!(token && phoneId && wabaId),
  };
}
// Sanitised Meta error: code + message only, capped, never a token.
function metaErrorInfo(parsed) {
  const err = parsed && parsed.error;
  if (err && typeof err === 'object') {
    return { meta_error_code: err.code !== undefined ? err.code : null, error: String(err.message || 'meta request failed').slice(0, 500) };
  }
  return { error: 'meta request failed' };
}
function metaRequest(method, path, bodyObj) {
  const cfg = metaConfig();
  return new Promise((resolve) => {
    let url;
    try { url = new URL(`${cfg.base}/${cfg.version}${path}`); }
    catch { return resolve({ ok: false, ...metaErrorInfo(null) }); }
    const lib = url.protocol === 'http:' ? require('http') : require('https');
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    const req = lib.request(url, { method, headers, timeout: 10000 }, (resp) => {
      let data = '';
      resp.on('data', (c) => { data += c; });
      resp.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch {}
        if (resp.statusCode >= 200 && resp.statusCode < 300) resolve({ ok: true, status: resp.statusCode, data: parsed });
        else resolve({ ok: false, status: resp.statusCode, ...metaErrorInfo(parsed) });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'meta request timed out' }); });
    req.on('error', () => resolve({ ok: false, error: 'meta request failed' }));
    if (payload) req.write(payload);
    req.end();
  });
}

// ---- WhatsApp phone / conversation helpers ----
// Normalise for matching: strip spaces, dashes, parentheses; keep '+'.
function normPhone(p) { return String(p || '').replace(/[\s\-()]/g, ''); }
function phoneKey(p) { return normPhone(p).replace(/^\+/, ''); }
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
function within24h(iso) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && (Date.now() - t) < 24 * 3600 * 1000;
}
// Status ranking: never let an older status overwrite a newer one,
// except 'failed', which always applies.
const META_STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };
function mapMetaStatus(s) {
  const v = String(s || '').toLowerCase();
  if (['sent', 'delivered', 'read', 'failed'].includes(v)) return v;
  return null;
}
function mapMetaTemplateStatus(s) {
  const v = String(s || '').toUpperCase();
  if (v === 'APPROVED') return 'approved';
  if (v === 'PENDING') return 'pending';
  if (v === 'REJECTED') return 'rejected';
  if (v === 'PAUSED') return 'paused';
  if (v === 'DISABLED') return 'disabled';
  return null;
}
function contractCode(n) { return 'PS-' + String(1000 + n); }
function hasBannedStep(steps) {
  return (steps || []).some((s) => BANNED_STEP_TYPES.includes(s.step_type || s.action));
}
// Normalise steps: assign/keep an explicit `order` field, then sort by it.
function normaliseSteps(steps) {
  return (steps || []).map((s, i) => ({ ...s, order: (typeof s.order === 'number' ? s.order : i) }))
    .sort((a, b) => a.order - b.order);
}
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

function seedTemplates() {
  let changed = false;
  if (!db.templates.length) {
    const names = ['contract_created','invite_accept','contract_accepted','payment_request','payment_confirmed_fi','preparing','delivery_confirmed','transaction_closed','dispute_opened','handover_support'];
    names.forEach((n) => db.templates.push({ id: nextId(), name: n, label_ar: TEMPLATE_LABELS_AR[n] || n, language: 'ar', category: 'UTILITY', approval_status: 'pending', meta_status: 'not_submitted' }));
    changed = true;
  } else {
    for (const t of db.templates) {
      if (!t.label_ar && TEMPLATE_LABELS_AR[t.name]) { t.label_ar = TEMPLATE_LABELS_AR[t.name]; changed = true; }
      // meta_status is Meta's view of the template; approval_status stays
      // the local (manual) field. Never overwrite one with the other.
      if (!t.meta_status) { t.meta_status = 'not_submitted'; changed = true; }
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
              tpl.meta_status = mapped; templateCount++;
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
              let text = null, mediaType = null;
              if (m.type === 'text') text = (m.text && m.text.body) || null;
              else if (['image', 'video', 'audio', 'document'].includes(m.type)) {
                mediaType = m.type;
                text = (m[m.type] && m[m.type].caption) || `[${m.type}]`;
              } else if (m.type === 'interactive') {
                const r = m.interactive || {};
                text = (r.button_reply && r.button_reply.title) || (r.list_reply && r.list_reply.title) || '[interactive]';
              } else if (m.type === 'sticker') { mediaType = 'sticker'; text = '[sticker]'; }
              else continue; // unknown message type: ignore safely
              const ts = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
              const msg = { id: nextId(), conversation_id: conv.id, direction: 'in', sender_phone: normPhone(m.from), body: text, media_type: mediaType, wamid: m.id, meta_status: null, created_at: ts };
              db.messages.push(msg);
              conv.unread_count = (conv.unread_count || 0) + 1;
              conv.last_inbound_at = ts;
              inCount++;
              audit('whatsapp-webhook', 'message', msg.id, 'whatsapp_inbound', { conversation_id: conv.id, wamid: m.id, type: m.type });
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
      const wizardSteps = [
        { key: 'meta_business', title_ar: 'حساب Meta Business', status: cfg.wabaId ? 'done' : 'pending' },
        { key: 'dedicated_number', title_ar: 'رقم مخصص للخدمة', status: cfg.phoneId ? 'done' : 'pending' },
        { key: 'env_vars', title_ar: 'متغيرات البيئة', status: (verify && hmac && metaConfigured) ? 'done' : 'pending' },
        { key: 'webhook', title_ar: 'تحقق Webhook', status: (verify && hmac) ? 'done' : 'pending' },
        { key: 'meta_connection', title_ar: 'اختبار اتصال Meta', status: metaConfigured ? 'pending' : 'blocked' },
        { key: 'templates', title_ar: 'اعتماد القوالب لدى Meta', status: db.templates.some((t) => t.meta_status === 'approved') ? 'done' : (metaConfigured ? 'pending' : 'blocked') },
        { key: 'test_message', title_ar: 'رسالة اختبار', status: metaConfigured ? 'pending' : 'blocked' },
      ];
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
      let metaPayload = null;
      if (isTemplate) {
        const tpl = db.templates.find((t) => t.name === body.template_name);
        if (!tpl) return send(res, 400, { error: 'template_not_found' }, p);
        if (tpl.approval_status !== 'approved') return send(res, 400, { error: 'template_not_approved' }, p);
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
      const cfg = metaConfig();
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
      if (db.templates.some((t) => t.name === body.name)) return send(res, 400, { error: 'template name already exists' }, p);
      const t = { id: nextId(), name: body.name, label_ar: body.label_ar || body.name, language: 'ar', category: 'UTILITY', body: String(body.body), buttons: Array.isArray(body.buttons) ? body.buttons : [], approval_status: 'pending', meta_status: 'not_submitted', meta_template_id: null, created_at: new Date().toISOString() };
      db.templates.push(t); audit(actor, 'template', t.id, 'whatsapp_template_created', { name: t.name }); return send(res, 201, t, p);
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
      const components = [{ type: 'BODY', text: t.body }];
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
      const r = await metaRequest('GET', `/${cfg.wabaId}/message_templates?fields=name,status,category,language&limit=100`, null);
      if (!r.ok) {
        audit(actor, 'whatsapp', 0, 'whatsapp_templates_sync_failed', { meta_error_code: r.meta_error_code || null });
        return send(res, 502, { ok: false, dry_run: false, meta_error_code: r.meta_error_code || null, error: r.error || 'meta request failed' }, p);
      }
      let updated = 0;
      const rows = (r.data && r.data.data) || [];
      for (const row of rows) {
        const tpl = db.templates.find((t) => t.name === row.name);
        const mapped = mapMetaTemplateStatus(row.status);
        if (tpl && mapped && tpl.meta_status !== mapped) { tpl.meta_status = mapped; updated++; }
      }
      // approval_status is local and is NEVER overwritten by Meta status.
      audit(actor, 'whatsapp', 0, 'whatsapp_templates_synced', { updated, total_from_meta: rows.length }); save();
      return send(res, 200, { ok: true, dry_run: false, configured: true, updated, total_from_meta: rows.length, synced_at: new Date().toISOString(), templates: db.templates.map((t) => ({ id: t.id, name: t.name, approval_status: t.approval_status, meta_status: t.meta_status })) }, p);
    }

    // ---- Connection checklist (10 steps; any authenticated user) ----
    if (p === '/api/connection-checklist' && req.method === 'GET') {
      return send(res, 200, CHECKLIST_STEPS.map((s) => ({ ...s, status: 'pending' })), p);
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
      const c = { id, code: contractCode(id), buyer_phone: body.buyer_phone, seller_phone: body.seller_phone, product_description: body.product_description, amount: Number(body.amount), currency: body.currency || 'SAR', delivery_point: body.delivery_point || null, state: 'draft', version: 1, clause_fingerprint: sha256(JSON.stringify(body) + id), created_at: new Date().toISOString() };
      db.contracts.push(c);
      db.contract_versions.push({ id: nextId(), contract_id: id, version: 1, snapshot: { buyer_phone: c.buyer_phone, seller_phone: c.seller_phone, product_description: c.product_description, amount: c.amount, currency: c.currency, delivery_point: c.delivery_point }, clause_fingerprint: c.clause_fingerprint, is_locked: false, created_at: c.created_at });
      ['buyer', 'seller'].forEach((party) => db.conversations.push({ id: nextId(), contract_id: id, party, status: 'new', unread_count: 0, assigned_to: null }));
      db.tasks.push({ id: nextId(), contract_id: id, title: 'مراجعة العقد وإصداره', type: 'review', status: 'open', assigned_to: null, created_at: new Date().toISOString() });
      audit(actor, 'contract', id, 'created', { code: c.code }); return send(res, 201, c, p);
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
      c.state = to; audit(actor, 'contract', c.id, 'transition', { to, financial_reference: body.financial_reference || null }); return send(res, 200, c, p);
    }
    const contractAmendMatch = p.match(/^\/api\/contracts\/(\d+)\/amend$/);
    if (contractAmendMatch && req.method === 'POST') {
      if (!can(user, 'contracts', 'edit')) return forbidden();
      const c = db.contracts.find((x) => x.id === Number(contractAmendMatch[1]));
      if (!c) return send(res, 404, { error: 'contract not found' }, p);
      const amendable = ['buyer_phone', 'seller_phone', 'product_description', 'amount', 'currency', 'delivery_point'];
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
    const contractSingleMatch = p.match(/^\/api\/contracts\/(\d+)$/);
    if (contractSingleMatch && req.method === 'GET') {
      if (!can(user, 'contracts', 'view')) return forbidden();
      const c = db.contracts.find((x) => x.id === Number(contractSingleMatch[1]));
      if (!c) return send(res, 404, { error: 'contract not found' }, p);
      return send(res, 200, c, p);
    }

    // ---- Inbox: conversations & messages ----
    if (p === '/api/conversations' && req.method === 'GET') {
      if (!can(user, 'inbox', 'view')) return forbidden();
      let list = db.conversations;
      if (url.searchParams.has('status')) list = list.filter((c) => c.status === url.searchParams.get('status'));
      if (url.searchParams.has('assigned_to')) list = list.filter((c) => String(c.assigned_to) === url.searchParams.get('assigned_to'));
      if (url.searchParams.has('contract_id')) list = list.filter((c) => String(c.contract_id) === url.searchParams.get('contract_id'));
      if (url.searchParams.has('party')) list = list.filter((c) => c.party === url.searchParams.get('party'));
      if (url.searchParams.get('unread') === 'true') list = list.filter((c) => (c.unread_count || 0) > 0);
      return send(res, 200, list, p);
    }
    if (p === '/api/inbox/unread-counts' && req.method === 'GET') {
      if (!can(user, 'inbox', 'view')) return forbidden();
      const byConversation = db.conversations.map((c) => ({ conversation_id: c.id, contract_id: c.contract_id, party: c.party, status: c.status, unread_count: c.unread_count || 0 }));
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
    const convReplyMatch = p.match(/^\/api\/conversations\/(\d+)\/reply$/);
    if (convReplyMatch && req.method === 'POST') {
      if (!can(user, 'inbox', 'create')) return forbidden();
      const conv = db.conversations.find((x) => x.id === Number(convReplyMatch[1]));
      if (!conv) return send(res, 404, { error: 'conversation not found' }, p);
      if (!body.body && !body.template_name) return send(res, 400, { error: 'body or template_name is required for a reply' }, p);
      const m = { id: nextId(), conversation_id: conv.id, direction: 'out', sender_name: body.sender_name || actor, body: body.body || null, template_name: body.template_name || null, is_internal_note: !!body.is_internal_note, created_at: new Date().toISOString() };
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
      return send(res, 200, list, p);
    }
    if (p === '/api/messages' && req.method === 'POST') {
      if (!can(user, 'inbox', 'create')) return forbidden();
      if (!body.body && !body.template_name) return send(res, 400, { error: 'body or template_name is required' }, p);
      const m = { id: nextId(), conversation_id: body.conversation_id || null, direction: body.direction || 'out', sender_name: body.sender_name || actor, body: body.body || null, template_name: body.template_name || null, is_internal_note: !!body.is_internal_note, created_at: new Date().toISOString() };
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
