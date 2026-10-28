// Pilot System — standalone backend (Node.js built-ins only)
// Rules enforced here, matching docs/state-machine.md and db/schema.sql:
// - No internal wallet/balance, no marketplace, no automated bank API.
// - No payment confirmation without a financial-institution reference.
// - No automated money step: release/refund/confirm/settle are human-only.
// - Audit log is append-only: the API never updates or deletes it
//   (GET /api/audit only; POST/PUT/PATCH/DELETE on it return 404).
// - WhatsApp webhook verifies HMAC-SHA256 when WHATSAPP_APP_SECRET is set.
// - Contract file uploads store METADATA ONLY — never file bytes/content.
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
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((resolve) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); }); }
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

function seedTemplates() {
  let changed = false;
  if (!db.templates.length) {
    const names = ['contract_created','invite_accept','contract_accepted','payment_request','payment_confirmed_fi','preparing','delivery_confirmed','transaction_closed','dispute_opened','handover_support'];
    names.forEach((n) => db.templates.push({ id: nextId(), name: n, label_ar: TEMPLATE_LABELS_AR[n] || n, language: 'ar', category: 'UTILITY', approval_status: 'pending' }));
    changed = true;
  } else {
    for (const t of db.templates) {
      if (!t.label_ar && TEMPLATE_LABELS_AR[t.name]) { t.label_ar = TEMPLATE_LABELS_AR[t.name]; changed = true; }
    }
  }
  if (changed) save();
}
seedTemplates();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // Static frontend (defensive: never crash when the file is absent).
  // Read the file BEFORE sending headers, so a missing first candidate
  // can never leave headers sent and crash the process on the fallback.
  if (p === '/' || p === '/index.html') {
    for (const dir of [FRONTEND_DIR, FRONTEND_FALLBACK]) {
      try {
        const html = fs.readFileSync(path.join(dir, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      } catch {}
    }
    return send(res, 404, { error: 'frontend not found' });
  }
  if (p === '/health') return send(res, 200, { ok: true, service: 'pilot-system', states: STATES });

  // WhatsApp webhook: GET verification, POST inbound
  if (p === '/api/whatsapp/webhook' && req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode'), token = url.searchParams.get('hub.verify_token'), challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) { res.writeHead(200); return res.end(challenge); }
    return send(res, 403, { error: 'webhook verification failed' });
  }
  if (p === '/api/whatsapp/webhook' && req.method === 'POST') {
    const body = await readBody(req);
    // HMAC check only when a secret is configured; never log the secret.
    const sig = req.headers['x-hub-signature-256'];
    if (process.env.WHATSAPP_APP_SECRET && sig) {
      const raw = JSON.stringify(body);
      const expected = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
      if (sig !== expected) return send(res, 401, { error: 'bad signature' });
    }
    const msg = { id: nextId(), conversation_id: null, direction: 'in', body: JSON.stringify(body).slice(0, 500), created_at: new Date().toISOString() };
    db.messages.push(msg); audit('whatsapp-webhook', 'message', msg.id, 'inbound_received'); return send(res, 200, { ok: true, message_id: msg.id });
  }

  const body = (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') ? await readBody(req) : {};

  // ---- Connection checklist (10 steps) ----
  if (p === '/api/connection-checklist' && req.method === 'GET') {
    return send(res, 200, CHECKLIST_STEPS.map((s) => ({ ...s, status: 'pending' })));
  }

  // ---- Users ----
  if (p === '/api/users' && req.method === 'GET') return send(res, 200, db.users);
  if (p === '/api/users' && req.method === 'POST') {
    if (!ROLES.includes(body.role)) return send(res, 400, { error: 'invalid role — must be one of: ' + ROLES.join(', ') });
    const u = { id: nextId(), full_name: body.full_name, email: body.email, role: body.role, is_active: true };
    db.users.push(u); audit(body.full_name || 'system', 'user', u.id, 'created'); return send(res, 201, u);
  }
  const userIdMatch = p.match(/^\/api\/users\/(\d+)$/);
  if (userIdMatch) {
    const u = db.users.find((x) => x.id === Number(userIdMatch[1]));
    if (!u) return send(res, 404, { error: 'user not found' });
    if (req.method === 'GET') return send(res, 200, u);
    if (req.method === 'PUT' || req.method === 'PATCH') {
      if (body.role !== undefined && !ROLES.includes(body.role)) return send(res, 400, { error: 'invalid role — must be one of: ' + ROLES.join(', ') });
      if (body.is_active === false && u.role === 'owner' && u.is_active !== false && onlyActiveOwnerCount() <= 1) {
        return send(res, 400, { error: 'cannot disable the only active owner — لا يمكن تعطيل المالك النشط الوحيد' });
      }
      if (body.role !== undefined) u.role = body.role;
      if (body.full_name !== undefined) u.full_name = body.full_name;
      if (body.email !== undefined) u.email = body.email;
      if (body.is_active !== undefined) u.is_active = !!body.is_active;
      audit('operator', 'user', u.id, 'updated'); save(); return send(res, 200, u);
    }
    if (req.method === 'DELETE') {
      if (u.role === 'owner' && u.is_active !== false && onlyActiveOwnerCount() <= 1) {
        return send(res, 400, { error: 'cannot delete the only active owner — لا يمكن حذف المالك النشط الوحيد' });
      }
      db.users = db.users.filter((x) => x.id !== u.id);
      audit('operator', 'user', u.id, 'deleted'); return send(res, 200, { ok: true, deleted_id: u.id });
    }
  }
  const userDisableMatch = p.match(/^\/api\/users\/(\d+)\/(disable|enable)$/);
  if (userDisableMatch && req.method === 'POST') {
    const u = db.users.find((x) => x.id === Number(userDisableMatch[1]));
    if (!u) return send(res, 404, { error: 'user not found' });
    if (userDisableMatch[2] === 'disable') {
      if (u.role === 'owner' && u.is_active !== false && onlyActiveOwnerCount() <= 1) {
        return send(res, 400, { error: 'cannot disable the only active owner — لا يمكن تعطيل المالك النشط الوحيد' });
      }
      u.is_active = false; audit('operator', 'user', u.id, 'disabled'); save(); return send(res, 200, u);
    }
    u.is_active = true; audit('operator', 'user', u.id, 'enabled'); save(); return send(res, 200, u);
  }

  // ---- Contracts ----
  if (p === '/api/contracts' && req.method === 'GET') return send(res, 200, db.contracts);
  if (p === '/api/contracts' && req.method === 'POST') {
    if (!body.buyer_phone || !body.seller_phone || !body.product_description || !body.amount) return send(res, 400, { error: 'buyer_phone, seller_phone, product_description and amount are required' });
    const id = nextId();
    const c = { id, code: contractCode(id), buyer_phone: body.buyer_phone, seller_phone: body.seller_phone, product_description: body.product_description, amount: Number(body.amount), currency: body.currency || 'SAR', delivery_point: body.delivery_point || null, state: 'draft', version: 1, clause_fingerprint: sha256(JSON.stringify(body) + id), created_at: new Date().toISOString() };
    db.contracts.push(c);
    db.contract_versions.push({ id: nextId(), contract_id: id, version: 1, snapshot: { buyer_phone: c.buyer_phone, seller_phone: c.seller_phone, product_description: c.product_description, amount: c.amount, currency: c.currency, delivery_point: c.delivery_point }, clause_fingerprint: c.clause_fingerprint, is_locked: false, created_at: c.created_at });
    ['buyer', 'seller'].forEach((party) => db.conversations.push({ id: nextId(), contract_id: id, party, status: 'new', unread_count: 0, assigned_to: null }));
    db.tasks.push({ id: nextId(), contract_id: id, title: 'مراجعة العقد وإصداره', type: 'review', status: 'open', assigned_to: null, created_at: new Date().toISOString() });
    audit('system', 'contract', id, 'created', { code: c.code }); return send(res, 201, c);
  }
  const contractMatch = p.match(/^\/api\/contracts\/(\d+)\/transition$/);
  if (contractMatch && req.method === 'POST') {
    const c = db.contracts.find((x) => x.id === Number(contractMatch[1]));
    if (!c) return send(res, 404, { error: 'contract not found' });
    const to = body.to;
    if (!TRANSITIONS[c.state].includes(to)) return send(res, 400, { error: `invalid transition ${c.state} -> ${to}` });
    if (to === 'payment_confirmed' && !body.financial_reference) return send(res, 400, { error: 'payment_confirmed requires financial_reference from the financial institution' });
    if (to === 'payment_confirmed') db.tasks.push({ id: nextId(), contract_id: c.id, title: 'تأكيد دفع بمرجع مؤسسة', type: 'financial', status: 'done', financial_reference: body.financial_reference, assigned_to: null, created_at: new Date().toISOString() });
    if (to === 'issued') db.tasks.push({ id: nextId(), contract_id: c.id, title: 'متابعة قبول الطرفين', type: 'followup', status: 'open', assigned_to: null, created_at: new Date().toISOString() });
    c.state = to; audit(body.actor || 'operator', 'contract', c.id, 'transition', { to, financial_reference: body.financial_reference || null }); return send(res, 200, c);
  }
  const contractAmendMatch = p.match(/^\/api\/contracts\/(\d+)\/amend$/);
  if (contractAmendMatch && req.method === 'POST') {
    const c = db.contracts.find((x) => x.id === Number(contractAmendMatch[1]));
    if (!c) return send(res, 404, { error: 'contract not found' });
    const amendable = ['buyer_phone', 'seller_phone', 'product_description', 'amount', 'currency', 'delivery_point'];
    const changes = {};
    for (const k of amendable) if (body[k] !== undefined) changes[k] = (k === 'amount' ? Number(body[k]) : body[k]);
    if (!Object.keys(changes).length) return send(res, 400, { error: 'amend requires at least one field: ' + amendable.join(', ') });
    // Lock every previous version; versions are immutable snapshots.
    for (const v of db.contract_versions.filter((v) => v.contract_id === c.id)) v.is_locked = true;
    const nextVersion = (contractVersions(c.id).reduce((m, v) => Math.max(m, v.version), 0)) + 1;
    const merged = { buyer_phone: c.buyer_phone, seller_phone: c.seller_phone, product_description: c.product_description, amount: c.amount, currency: c.currency, delivery_point: c.delivery_point, ...changes };
    const fingerprint = sha256(JSON.stringify({ ...merged, version: nextVersion }) + c.id);
    const versionRec = { id: nextId(), contract_id: c.id, version: nextVersion, snapshot: merged, clause_fingerprint: fingerprint, is_locked: true, amended_by: body.actor || 'operator', created_at: new Date().toISOString() };
    db.contract_versions.push(versionRec);
    Object.assign(c, changes, { version: nextVersion, clause_fingerprint: fingerprint, updated_at: new Date().toISOString() });
    audit(body.actor || 'operator', 'contract', c.id, 'amended', { version: nextVersion, clause_fingerprint: fingerprint });
    return send(res, 200, { ...c, new_version: versionRec });
  }
  const contractVersionsMatch = p.match(/^\/api\/contracts\/(\d+)\/versions$/);
  if (contractVersionsMatch && req.method === 'GET') {
    const c = db.contracts.find((x) => x.id === Number(contractVersionsMatch[1]));
    if (!c) return send(res, 404, { error: 'contract not found' });
    return send(res, 200, contractVersions(c.id));
  }
  const contractFilesMatch = p.match(/^\/api\/contracts\/(\d+)\/(files|attachments)$/);
  if (contractFilesMatch) {
    const c = db.contracts.find((x) => x.id === Number(contractFilesMatch[1]));
    if (!c) return send(res, 404, { error: 'contract not found' });
    if (req.method === 'GET') return send(res, 200, db.contract_files.filter((f) => f.contract_id === c.id));
    if (req.method === 'POST') {
      if (!body.filename) return send(res, 400, { error: 'filename is required' });
      if (!FILE_KINDS.includes(body.kind)) return send(res, 400, { error: 'kind must be one of: ' + FILE_KINDS.join(', ') });
      // Metadata only: any file bytes/content fields are deliberately dropped.
      const f = { id: nextId(), contract_id: c.id, filename: body.filename, kind: body.kind, mime_type: body.mime_type || null, size_bytes: (typeof body.size_bytes === 'number' ? body.size_bytes : null), uploaded_by: body.uploaded_by || 'operator', created_at: new Date().toISOString() };
      db.contract_files.push(f); audit(f.uploaded_by, 'contract_file', f.id, 'uploaded', { contract_id: c.id, kind: f.kind, filename: f.filename }); return send(res, 201, f);
    }
  }
  const contractSingleMatch = p.match(/^\/api\/contracts\/(\d+)$/);
  if (contractSingleMatch && req.method === 'GET') {
    const c = db.contracts.find((x) => x.id === Number(contractSingleMatch[1]));
    if (!c) return send(res, 404, { error: 'contract not found' });
    return send(res, 200, c);
  }

  // ---- Inbox: conversations & messages ----
  if (p === '/api/conversations' && req.method === 'GET') {
    let list = db.conversations;
    if (url.searchParams.has('status')) list = list.filter((c) => c.status === url.searchParams.get('status'));
    if (url.searchParams.has('assigned_to')) list = list.filter((c) => String(c.assigned_to) === url.searchParams.get('assigned_to'));
    if (url.searchParams.has('contract_id')) list = list.filter((c) => String(c.contract_id) === url.searchParams.get('contract_id'));
    if (url.searchParams.has('party')) list = list.filter((c) => c.party === url.searchParams.get('party'));
    if (url.searchParams.get('unread') === 'true') list = list.filter((c) => (c.unread_count || 0) > 0);
    return send(res, 200, list);
  }
  if (p === '/api/inbox/unread-counts' && req.method === 'GET') {
    const byConversation = db.conversations.map((c) => ({ conversation_id: c.id, contract_id: c.contract_id, party: c.party, status: c.status, unread_count: c.unread_count || 0 }));
    const total = byConversation.reduce((s, c) => s + c.unread_count, 0);
    const byStatus = {};
    for (const c of byConversation) byStatus[c.status] = (byStatus[c.status] || 0) + c.unread_count;
    return send(res, 200, { total_unread: total, by_status: byStatus, conversations: byConversation });
  }
  const convSingleMatch = p.match(/^\/api\/conversations\/(\d+)$/);
  if (convSingleMatch) {
    const conv = db.conversations.find((x) => x.id === Number(convSingleMatch[1]));
    if (!conv) return send(res, 404, { error: 'conversation not found' });
    if (req.method === 'GET') return send(res, 200, conv);
    if (req.method === 'PUT' || req.method === 'PATCH') {
      if (body.status !== undefined && !CONVERSATION_STATUSES.includes(body.status)) return send(res, 400, { error: 'status must be one of: ' + CONVERSATION_STATUSES.join(', ') });
      if (body.status !== undefined) conv.status = body.status;
      if (body.assigned_to !== undefined) conv.assigned_to = body.assigned_to;
      audit('operator', 'conversation', conv.id, 'updated'); save(); return send(res, 200, conv);
    }
  }
  const convAssignMatch = p.match(/^\/api\/conversations\/(\d+)\/assign$/);
  if (convAssignMatch && req.method === 'POST') {
    const conv = db.conversations.find((x) => x.id === Number(convAssignMatch[1]));
    if (!conv) return send(res, 404, { error: 'conversation not found' });
    if (!body.assigned_to) return send(res, 400, { error: 'assigned_to is required' });
    conv.assigned_to = body.assigned_to; audit('operator', 'conversation', conv.id, 'assigned', { assigned_to: body.assigned_to }); save(); return send(res, 200, conv);
  }
  const convReadMatch = p.match(/^\/api\/conversations\/(\d+)\/read$/);
  if (convReadMatch && req.method === 'POST') {
    const conv = db.conversations.find((x) => x.id === Number(convReadMatch[1]));
    if (!conv) return send(res, 404, { error: 'conversation not found' });
    conv.unread_count = 0; audit('operator', 'conversation', conv.id, 'marked_read'); save(); return send(res, 200, conv);
  }
  const convReplyMatch = p.match(/^\/api\/conversations\/(\d+)\/reply$/);
  if (convReplyMatch && req.method === 'POST') {
    const conv = db.conversations.find((x) => x.id === Number(convReplyMatch[1]));
    if (!conv) return send(res, 404, { error: 'conversation not found' });
    if (!body.body && !body.template_name) return send(res, 400, { error: 'body or template_name is required for a reply' });
    const m = { id: nextId(), conversation_id: conv.id, direction: 'out', sender_name: body.sender_name || 'operator', body: body.body || null, template_name: body.template_name || null, is_internal_note: !!body.is_internal_note, created_at: new Date().toISOString() };
    db.messages.push(m); audit(m.sender_name, 'message', m.id, 'sent'); return send(res, 201, m);
  }
  const customerMessagesMatch = p.match(/^\/api\/customer\/conversations\/(\d+)\/messages$/);
  if (customerMessagesMatch && req.method === 'GET') {
    const conv = db.conversations.find((x) => x.id === Number(customerMessagesMatch[1]));
    if (!conv) return send(res, 404, { error: 'conversation not found' });
    // Customer view: internal notes are NEVER returned here.
    return send(res, 200, db.messages.filter((m) => m.conversation_id === conv.id && !m.is_internal_note));
  }
  if (p === '/api/messages' && req.method === 'GET') {
    let list = db.messages;
    if (url.searchParams.has('conversation_id')) list = list.filter((m) => String(m.conversation_id) === url.searchParams.get('conversation_id'));
    if (url.searchParams.has('direction')) list = list.filter((m) => m.direction === url.searchParams.get('direction'));
    if (url.searchParams.get('internal') === 'false') list = list.filter((m) => !m.is_internal_note);
    if (url.searchParams.get('internal') === 'true') list = list.filter((m) => !!m.is_internal_note);
    return send(res, 200, list);
  }
  if (p === '/api/messages' && req.method === 'POST') {
    if (!body.body && !body.template_name) return send(res, 400, { error: 'body or template_name is required' });
    const m = { id: nextId(), conversation_id: body.conversation_id || null, direction: body.direction || 'out', sender_name: body.sender_name || 'operator', body: body.body || null, template_name: body.template_name || null, is_internal_note: !!body.is_internal_note, created_at: new Date().toISOString() };
    db.messages.push(m);
    if (m.direction === 'in' && !m.is_internal_note && m.conversation_id) bumpUnread(m.conversation_id);
    audit(m.sender_name, 'message', m.id, 'sent'); return send(res, 201, m);
  }

  // ---- Ops tasks ----
  if (p === '/api/tasks' && req.method === 'GET') {
    let list = db.tasks;
    if (url.searchParams.has('status')) list = list.filter((t) => t.status === url.searchParams.get('status'));
    if (url.searchParams.has('contract_id')) list = list.filter((t) => String(t.contract_id) === url.searchParams.get('contract_id'));
    if (url.searchParams.has('assigned_to')) list = list.filter((t) => String(t.assigned_to) === url.searchParams.get('assigned_to'));
    if (url.searchParams.has('type')) list = list.filter((t) => t.type === url.searchParams.get('type'));
    return send(res, 200, list);
  }
  if (p === '/api/tasks' && req.method === 'POST') {
    if (!body.title) return send(res, 400, { error: 'title is required — العنوان مطلوب' });
    const t = { id: nextId(), contract_id: body.contract_id || null, title: body.title, type: body.type || 'general', status: 'open', assigned_to: body.assigned_to || null, created_at: new Date().toISOString() };
    db.tasks.push(t); audit(body.actor || 'operator', 'task', t.id, 'created'); return send(res, 201, t);
  }
  const taskActionMatch = p.match(/^\/api\/tasks\/(\d+)\/(complete|cancel)$/);
  if (taskActionMatch && req.method === 'POST') {
    const t = db.tasks.find((x) => x.id === Number(taskActionMatch[1]));
    if (!t) return send(res, 404, { error: 'task not found' });
    if (t.status === 'completed' || t.status === 'cancelled') return send(res, 400, { error: `task already ${t.status}` });
    t.status = taskActionMatch[2] === 'complete' ? 'completed' : 'cancelled';
    audit(body.actor || 'operator', 'task', t.id, t.status); save(); return send(res, 200, t);
  }
  const taskSingleMatch = p.match(/^\/api\/tasks\/(\d+)$/);
  if (taskSingleMatch) {
    const t = db.tasks.find((x) => x.id === Number(taskSingleMatch[1]));
    if (!t) return send(res, 404, { error: 'task not found' });
    if (req.method === 'GET') return send(res, 200, t);
    if (req.method === 'PUT' || req.method === 'PATCH') {
      if (body.status !== undefined && !['open', 'completed', 'cancelled'].includes(body.status)) return send(res, 400, { error: 'status must be open, completed or cancelled' });
      if ((t.status === 'completed' || t.status === 'cancelled') && body.status === 'open') return send(res, 400, { error: `task already ${t.status}` });
      if (body.status !== undefined) t.status = body.status;
      if (body.assigned_to !== undefined) t.assigned_to = body.assigned_to;
      if (body.title !== undefined) t.title = body.title;
      audit('operator', 'task', t.id, 'updated'); save(); return send(res, 200, t);
    }
  }

  // ---- Workflow designer ----
  if (p === '/api/workflows' && req.method === 'GET') {
    let list = db.workflows;
    if (url.searchParams.has('is_active')) list = list.filter((w) => String(w.is_active) === url.searchParams.get('is_active'));
    return send(res, 200, list);
  }
  if (p === '/api/workflows' && req.method === 'POST') {
    if (!body.name) return send(res, 400, { error: 'name is required' });
    if (hasBannedStep(body.steps)) return send(res, 400, { error: 'money steps are never allowed in a workflow: ' + BANNED_STEP_TYPES.join(', ') });
    const w = { id: nextId(), name: body.name, trigger_type: body.trigger_type || 'keyword', trigger_value: body.trigger_value || null, steps: normaliseSteps(body.steps), is_active: (body.is_active !== undefined ? !!body.is_active : true) };
    db.workflows.push(w); audit('operator', 'workflow', w.id, 'created'); return send(res, 201, w);
  }
  const workflowCopyMatch = p.match(/^\/api\/workflows\/(\d+)\/copy$/);
  if (workflowCopyMatch && req.method === 'POST') {
    const src = db.workflows.find((x) => x.id === Number(workflowCopyMatch[1]));
    if (!src) return send(res, 404, { error: 'workflow not found' });
    const w = { id: nextId(), name: src.name + ' (نسخة)', trigger_type: src.trigger_type, trigger_value: src.trigger_value, steps: JSON.parse(JSON.stringify(src.steps || [])), is_active: true };
    db.workflows.push(w); audit('operator', 'workflow', w.id, 'copied', { source_workflow_id: src.id }); return send(res, 201, w);
  }
  const workflowSingleMatch = p.match(/^\/api\/workflows\/(\d+)$/);
  if (workflowSingleMatch) {
    const w = db.workflows.find((x) => x.id === Number(workflowSingleMatch[1]));
    if (!w) return send(res, 404, { error: 'workflow not found' });
    if (req.method === 'GET') return send(res, 200, w);
    if (req.method === 'PUT' || req.method === 'PATCH') {
      if (body.steps !== undefined && hasBannedStep(body.steps)) return send(res, 400, { error: 'money steps are never allowed in a workflow: ' + BANNED_STEP_TYPES.join(', ') });
      if (body.name !== undefined) w.name = body.name;
      if (body.trigger_type !== undefined) w.trigger_type = body.trigger_type;
      if (body.trigger_value !== undefined) w.trigger_value = body.trigger_value;
      if (body.steps !== undefined) w.steps = normaliseSteps(body.steps);
      if (body.is_active !== undefined) w.is_active = !!body.is_active;
      audit('operator', 'workflow', w.id, 'updated'); save(); return send(res, 200, w);
    }
    if (req.method === 'DELETE') {
      db.workflows = db.workflows.filter((x) => x.id !== w.id);
      audit('operator', 'workflow', w.id, 'deleted'); return send(res, 200, { ok: true, deleted_id: w.id });
    }
  }

  // ---- Templates ----
  if (p === '/api/templates' && req.method === 'GET') return send(res, 200, db.templates);
  const templateSingleMatch = p.match(/^\/api\/templates\/(\d+)$/);
  if (templateSingleMatch) {
    const t = db.templates.find((x) => x.id === Number(templateSingleMatch[1]));
    if (!t) return send(res, 404, { error: 'template not found' });
    if (req.method === 'GET') return send(res, 200, t);
    if (req.method === 'PUT' || req.method === 'PATCH') {
      // Only approval_status may change through this endpoint.
      if (!TEMPLATE_STATUSES.includes(body.approval_status)) return send(res, 400, { error: 'approval_status must be one of: ' + TEMPLATE_STATUSES.join(', ') });
      t.approval_status = body.approval_status;
      audit('operator', 'template', t.id, 'approval_updated', { approval_status: t.approval_status }); save(); return send(res, 200, t);
    }
  }

  // ---- Automation rules + Kill Switch ----
  if (p === '/api/automation/rules' && req.method === 'GET') return send(res, 200, db.rules);
  if (p === '/api/automation/rules' && req.method === 'POST') {
    if (!body.name) return send(res, 400, { error: 'name is required' });
    if (hasBannedStep(body.steps) || hasBannedStep(body.actions)) return send(res, 400, { error: 'money steps are never allowed in an automation rule: ' + BANNED_STEP_TYPES.join(', ') });
    // Kill Switch on: creation is still allowed, but the rule is forced inactive.
    // No money action exists or executes in this backend.
    const forcedInactive = !!db.killSwitch;
    const r = { id: nextId(), name: body.name, category: body.category || 'general', trigger_type: body.trigger_type || null, trigger_value: body.trigger_value || null, steps: normaliseSteps(body.steps), actions: body.actions || [], is_active: (forcedInactive ? false : (body.is_active !== undefined ? !!body.is_active : true)), deactivated_by_kill_switch: forcedInactive, created_at: new Date().toISOString() };
    db.rules.push(r); audit('operator', 'automation_rule', r.id, 'created', { is_active: r.is_active, kill_switch_on: forcedInactive }); return send(res, 201, r);
  }
  const ruleToggleMatch = p.match(/^\/api\/automation\/rules\/(\d+)\/toggle$/);
  if (ruleToggleMatch && req.method === 'POST') {
    const r = db.rules.find((x) => x.id === Number(ruleToggleMatch[1]));
    if (!r) return send(res, 404, { error: 'automation rule not found' });
    r.is_active = db.killSwitch ? false : !r.is_active;
    r.deactivated_by_kill_switch = !!db.killSwitch && !r.is_active;
    audit('operator', 'automation_rule', r.id, 'toggled', { is_active: r.is_active }); save(); return send(res, 200, r);
  }
  const ruleSingleMatch = p.match(/^\/api\/automation\/rules\/(\d+)$/);
  if (ruleSingleMatch && req.method === 'GET') {
    const r = db.rules.find((x) => x.id === Number(ruleSingleMatch[1]));
    if (!r) return send(res, 404, { error: 'automation rule not found' });
    return send(res, 200, r);
  }

  // ---- Audit: GET only (any other method falls through to 404) ----
  if (p === '/api/audit' && req.method === 'GET') return send(res, 200, db.audit);

  // ---- Kill Switch (kept as-is) ----
  if (p === '/api/automation/kill-switch' && req.method === 'POST') { db.killSwitch = !!body.off; audit('operator', 'automation', 0, body.off ? 'kill_switch_on' : 'kill_switch_off'); return send(res, 200, { killSwitch: db.killSwitch }); }
  if (p === '/api/automation/kill-switch' && req.method === 'GET') return send(res, 200, { killSwitch: db.killSwitch });

  return send(res, 404, { error: 'not found' });
});

if (require.main === module) server.listen(PORT, () => console.log(`Pilot System listening on ${PORT}`));
module.exports = server;
