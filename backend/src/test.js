// Pilot System — acceptance tests, run twice for the "success twice" rule.
// Usage: node src/test.js  (starts the server on a test port, runs, exits)
// Original 42 checks are kept in behaviour; new checks cover auth,
// permissions and password hashing. The primary admin is seeded ONLY via
// environment variables read by the server at startup: when this harness
// is run without those variables set, it generates a throwaway test-only
// admin credential in-process (never written to any file) before requiring
// the server. No real or user-supplied credential appears in this file.
const { spawn } = require('child_process');
const crypto = require('crypto');
const PORT = 3456;
process.env.PORT = String(PORT);
delete process.env.WHATSAPP_APP_SECRET;
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_INITIAL_PASSWORD) {
  process.env.ADMIN_EMAIL = 'test-admin@pilot.local';
  process.env.ADMIN_INITIAL_PASSWORD = 'T' + crypto.randomBytes(16).toString('hex');
}
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD;
const genPass = () => 'T' + crypto.randomBytes(12).toString('hex');
const fs = require('fs');
const path = require('path');
// Fresh data for a repeatable test run
try { fs.unlinkSync(path.join(__dirname, 'data.json')); } catch {}
const server = require('./server.js');
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, cond, extra = '') { if (cond) { passed++; console.log('PASS', name); } else { failed++; console.log('FAIL', name, extra); } }
let token = null;
async function api(p, o = {}) {
  const { noAuth, ...rest } = o;
  const headers = { 'Content-Type': 'application/json' };
  if (token && !noAuth) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, { headers, ...rest });
  let body = {}; try { body = await r.json(); } catch {} return { status: r.status, body };
}
async function apiAs(tok, p, o = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (tok) headers.Authorization = 'Bearer ' + tok;
  const r = await fetch(base + p, { headers, ...(o || {}) });
  let body = {}; try { body = await r.json(); } catch {} return { status: r.status, body };
}
async function login(email, password) {
  return api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }), noAuth: true });
}
server.listen(PORT, async () => {
  try {
    const h = await api('/health', { noAuth: true }); check('health', h.status === 200 && h.body.ok);

    // ---- New: auth gate ----
    const unauth = await api('/api/contracts', { noAuth: true });
    check('unauthenticated API call rejected (401)', unauth.status === 401, JSON.stringify(unauth.body));
    const wrongPass = await login(ADMIN_EMAIL, 'wrong-password-not-valid');
    check('login with wrong password rejected (generic error)', wrongPass.status === 401 && wrongPass.body.error === 'invalid email or password', JSON.stringify(wrongPass.body));
    const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    check('login with seeded admin succeeds and returns a token', adminLogin.status === 200 && !!adminLogin.body.token && adminLogin.body.user && adminLogin.body.user.role === 'owner' && !('password_hash' in adminLogin.body.user), JSON.stringify(adminLogin.body.user));
    token = adminLogin.body.token;
    const me = await api('/api/auth/me');
    check('GET /api/auth/me returns the logged-in owner', me.status === 200 && me.body.email === ADMIN_EMAIL.toLowerCase() && Array.isArray(me.body.sections) && me.body.sections.includes('users'), JSON.stringify(me.body));
    const deps = await api('/api/departments');
    check('departments list has 4 departments', Array.isArray(deps.body) && deps.body.length === 4, JSON.stringify(deps.body));

    const c = await api('/api/contracts', { method: 'POST', body: JSON.stringify({ buyer_phone: '+967700000001', seller_phone: '+967700000002', product_description: 'هاتف تجريبي', amount: 100 }) });
    check('create contract draft', c.status === 201 && c.body.state === 'draft', JSON.stringify(c.body));
    const id = c.body.id;
    const origFingerprint = c.body.clause_fingerprint;
    const bad = await api(`/api/contracts/${id}/transition`, { method: 'POST', body: JSON.stringify({ to: 'payment_confirmed' }) });
    check('invalid transition rejected', bad.status === 400);
    await api(`/api/contracts/${id}/transition`, { method: 'POST', body: JSON.stringify({ to: 'issued' }) });
    await api(`/api/contracts/${id}/transition`, { method: 'POST', body: JSON.stringify({ to: 'accepted' }) });
    await api(`/api/contracts/${id}/transition`, { method: 'POST', body: JSON.stringify({ to: 'payment_pending' }) });
    const noRef = await api(`/api/contracts/${id}/transition`, { method: 'POST', body: JSON.stringify({ to: 'payment_confirmed' }) });
    check('payment without FI reference rejected', noRef.status === 400, JSON.stringify(noRef.body));
    const withRef = await api(`/api/contracts/${id}/transition`, { method: 'POST', body: JSON.stringify({ to: 'payment_confirmed', financial_reference: 'FI-TEST-2026-001' }) });
    check('payment with FI reference accepted', withRef.status === 200 && withRef.body.state === 'payment_confirmed');
    const moneyFlow = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'bad', steps: [{ step_type: 'release_money' }] }) });
    check('money step in workflow rejected', moneyFlow.status === 400);
    const goodFlow = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'إنشاء عقد', trigger_type: 'keyword', trigger_value: 'عقد جديد', steps: [{ step_type: 'text' }] }) });
    check('workflow created', goodFlow.status === 201);
    const audit = await api('/api/audit');
    check('audit log append-only and non-empty', Array.isArray(audit.body) && audit.body.length >= 5);
    const ks = await api('/api/automation/kill-switch', { method: 'POST', body: JSON.stringify({ off: true }) });
    check('kill switch', ks.body.killSwitch === true);
    const templates = await api('/api/templates');
    check('10 templates seeded', templates.body.length === 10, String(templates.body.length));

    // ---- New: contract amend creates a new version + fingerprint, old stays ----
    const amended = await api(`/api/contracts/${id}/amend`, { method: 'POST', body: JSON.stringify({ amount: 150, product_description: 'هاتف تجريبي معدل' }) });
    check('amend creates new version/fingerprint', amended.status === 200 && amended.body.version === 2 && amended.body.clause_fingerprint && amended.body.clause_fingerprint !== origFingerprint, JSON.stringify(amended.body));
    const versions = await api(`/api/contracts/${id}/versions`);
    check('version list keeps old version', versions.status === 200 && versions.body.length === 2 && versions.body[0].clause_fingerprint === origFingerprint && versions.body[1].version === 2, JSON.stringify(versions.body));

    // ---- New: contract file metadata only ----
    const badKind = await api(`/api/contracts/${id}/files`, { method: 'POST', body: JSON.stringify({ filename: 'x.pdf', kind: 'bogus' }) });
    check('file metadata invalid kind rejected', badKind.status === 400);
    const file = await api(`/api/contracts/${id}/files`, { method: 'POST', body: JSON.stringify({ filename: 'contract-signed.pdf', kind: 'buyer_signed', mime_type: 'application/pdf', size_bytes: 12345 }) });
    check('file metadata stored (no bytes)', file.status === 201 && file.body.kind === 'buyer_signed' && !('content' in file.body) && !('data' in file.body), JSON.stringify(file.body));
    const files = await api(`/api/contracts/${id}/attachments`);
    check('attachments list', files.status === 200 && files.body.length === 1 && files.body[0].filename === 'contract-signed.pdf');

    // ---- New: owner-protection guard ----
    const owner1Pass = genPass();
    const owner1 = await api('/api/users', { method: 'POST', body: JSON.stringify({ full_name: 'المالك الأول', email: 'owner1@test.local', role: 'owner', department: 'Administration', password: owner1Pass }) });
    check('owner user created', owner1.status === 201 && owner1.body.role === 'owner');
    const badRole = await api('/api/users', { method: 'POST', body: JSON.stringify({ full_name: 'X', email: 'x@test.local', role: 'superadmin', department: 'Operations', password: genPass() }) });
    check('invalid role rejected (5 roles only)', badRole.status === 400);
    // NOTE: with a seeded primary admin (an active owner who can never be
    // disabled/deleted) present, the old "only active owner" API scenario
    // cannot arise: the primary admin is always the fallback owner. The
    // only-owner guard stays in the server as defence-in-depth; the API
    // test now verifies the equivalent live protection (see the primary
    // admin checks at the end) plus disable/enable of a second owner.
    const disableOk = await api(`/api/users/${owner1.body.id}/disable`, { method: 'POST', body: JSON.stringify({}) });
    check('disable succeeds while primary admin remains active owner', disableOk.status === 200 && disableOk.body.is_active === false, JSON.stringify(disableOk.body));
    const enableOk = await api(`/api/users/${owner1.body.id}/enable`, { method: 'POST', body: JSON.stringify({}) });
    check('enable owner succeeds', enableOk.status === 200 && enableOk.body.is_active === true, JSON.stringify(enableOk.body));
    const owner2 = await api('/api/users', { method: 'POST', body: JSON.stringify({ full_name: 'المالك الثاني', email: 'owner2@test.local', role: 'owner', department: 'Administration', password: genPass() }) });
    check('second owner created', owner2.status === 201 && owner2.body.role === 'owner');

    // ---- New: seeded admin can create a user; new user can log in ----
    const empPass = genPass();
    const emp = await api('/api/users', { method: 'POST', body: JSON.stringify({ full_name: 'موظف اختبار', email: 'employee@test.local', role: 'ops_employee', department: 'Operations', password: empPass }) });
    check('seeded admin can create a user', emp.status === 201 && emp.body.email === 'employee@test.local' && !('password_hash' in emp.body), JSON.stringify(emp.body));
    const empLogin = await login('employee@test.local', empPass);
    check('new user can log in', empLogin.status === 200 && !!empLogin.body.token, JSON.stringify(empLogin.body));
    // Password stored hashed, never plaintext, in the data file.
    let storedHash = '';
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
      const stored = (raw.users || []).find((u) => u.email === 'employee@test.local');
      storedHash = stored ? (stored.password_hash || '') : '';
    } catch {}
    check('password stored hashed not plain', storedHash.startsWith('scrypt:') && !storedHash.includes(empPass), storedHash.slice(0, 20) + '...');
    // Disabled user cannot log in.
    await api(`/api/users/${emp.body.id}/disable`, { method: 'POST', body: JSON.stringify({}) });
    const disabledLogin = await login('employee@test.local', empPass);
    check('disabled user cannot log in', disabledLogin.status === 401 && disabledLogin.body.error === 'invalid email or password', JSON.stringify(disabledLogin.body));
    await api(`/api/users/${emp.body.id}/enable`, { method: 'POST', body: JSON.stringify({}) });

    // ---- New: user without a section permission is rejected by the backend (403) ----
    const viewerPass = genPass();
    const viewer = await api('/api/users', { method: 'POST', body: JSON.stringify({ full_name: 'مشاهد اختبار', email: 'viewer@test.local', role: 'viewer', department: 'Customer Support', password: viewerPass }) });
    const viewerLogin = await login('viewer@test.local', viewerPass);
    const viewerToken = viewerLogin.body.token;
    const viewerUsers = await apiAs(viewerToken, '/api/users');
    check('user without users permission rejected for users endpoint (403)', viewerUsers.status === 403, JSON.stringify(viewerUsers.body));
    const viewerCreate = await apiAs(viewerToken, '/api/contracts', { method: 'POST', body: JSON.stringify({ buyer_phone: '+967700000003', seller_phone: '+967700000004', product_description: 'x', amount: 10 }) });
    check('user without contracts:create rejected for contract creation (403)', viewerCreate.status === 403, JSON.stringify(viewerCreate.body));

    // ---- New: workflow copy, edit/reorder, settle_dispute rejected, delete ----
    const settle = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'bad2', steps: [{ step_type: 'settle_dispute' }] }) });
    check('settle_dispute step in workflow rejected', settle.status === 400);
    const copy = await api(`/api/workflows/${goodFlow.body.id}/copy`, { method: 'POST', body: JSON.stringify({}) });
    check('workflow copy', copy.status === 201 && copy.body.id !== goodFlow.body.id && copy.body.name.includes('نسخة'), JSON.stringify(copy.body));
    const reordered = await api(`/api/workflows/${goodFlow.body.id}`, { method: 'PUT', body: JSON.stringify({ steps: [{ step_type: 'text', order: 1 }, { step_type: 'template', order: 0 }] }) });
    check('workflow steps reorder via order field', reordered.status === 200 && reordered.body.steps[0].step_type === 'template' && reordered.body.steps[1].step_type === 'text', JSON.stringify(reordered.body));
    const deleted = await api(`/api/workflows/${copy.body.id}`, { method: 'DELETE' });
    check('workflow delete', deleted.status === 200 && deleted.body.ok === true);

    // ---- New: template approval update (only pending/approved/rejected) ----
    const tplBad = await api('/api/templates/1', { method: 'PUT', body: JSON.stringify({ approval_status: 'maybe' }) });
    check('template invalid approval_status rejected', tplBad.status === 400);
    const tplOk = await api('/api/templates/1', { method: 'PUT', body: JSON.stringify({ approval_status: 'approved' }) });
    check('template approval update', tplOk.status === 200 && tplOk.body.approval_status === 'approved' && tplOk.body.name === 'contract_created', JSON.stringify(tplOk.body));

    // ---- New: ops tasks create / complete / cancel ----
    const task = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ contract_id: id, title: 'متابعة تسليم', type: 'followup' }) });
    check('task created', task.status === 201 && task.body.status === 'open');
    const done = await api(`/api/tasks/${task.body.id}/complete`, { method: 'POST', body: JSON.stringify({}) });
    check('task complete', done.status === 200 && done.body.status === 'completed', JSON.stringify(done.body));
    const task2 = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'مهمة ملغاة' }) });
    const cancelled = await api(`/api/tasks/${task2.body.id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
    check('task cancel', cancelled.status === 200 && cancelled.body.status === 'cancelled');

    // ---- New: inbox filters, assignment, internal notes, unread counts ----
    const convs = await api('/api/conversations?status=new');
    check('conversation filter by status', convs.status === 200 && convs.body.length >= 2);
    const convId = convs.body[0].id;
    const assigned = await api(`/api/conversations/${convId}/assign`, { method: 'POST', body: JSON.stringify({ assigned_to: 'ops-1' }) });
    check('conversation assignment', assigned.status === 200 && assigned.body.assigned_to === 'ops-1');
    const byAssignee = await api('/api/conversations?assigned_to=ops-1');
    check('conversation filter by assigned_to', byAssignee.body.some((c) => c.id === convId));
    await api('/api/messages', { method: 'POST', body: JSON.stringify({ conversation_id: convId, direction: 'in', body: 'رسالة عميل' }) });
    const note = await api(`/api/conversations/${convId}/reply`, { method: 'POST', body: JSON.stringify({ body: 'ملاحظة داخلية', is_internal_note: true }) });
    check('internal note created with flag', note.status === 201 && note.body.is_internal_note === true);
    const custView = await api(`/api/customer/conversations/${convId}/messages`);
    check('customer view never returns internal notes', custView.body.every((m) => !m.is_internal_note) && custView.body.some((m) => m.body === 'رسالة عميل'));
    const opsFiltered = await api(`/api/messages?conversation_id=${convId}&internal=false`);
    check('messages ?internal=false excludes notes', opsFiltered.body.every((m) => !m.is_internal_note));
    const counts = await api('/api/inbox/unread-counts');
    check('unread counts', counts.status === 200 && counts.body.total_unread >= 1, JSON.stringify(counts.body));
    const reply = await api(`/api/conversations/${convId}/reply`, { method: 'POST', body: JSON.stringify({ template_name: 'payment_request', body: 'تم إرسال طلب الدفع' }) });
    check('template reply', reply.status === 201 && reply.body.template_name === 'payment_request');

    // ---- New: automation rule under kill switch is created but inactive ----
    const rule = await api('/api/automation/rules', { method: 'POST', body: JSON.stringify({ name: 'قاعدة اختبار', category: 'keyword', trigger_value: 'عقد جديد', steps: [{ step_type: 'text' }] }) });
    check('kill switch: rule creation allowed but inactive', rule.status === 201 && rule.body.is_active === false, JSON.stringify(rule.body));
    const rules = await api('/api/automation/rules');
    check('automation rules list', rules.body.length >= 1);

    // ---- New: connection checklist has exactly 10 steps ----
    const checklist = await api('/api/connection-checklist');
    check('connection checklist 10 steps', Array.isArray(checklist.body) && checklist.body.length === 10 && checklist.body[0].key === 'meta_business' && checklist.body[9].key === 'client_acceptance', JSON.stringify(checklist.body));

    // ---- New: audit is GET-only ----
    const auditPost = await api('/api/audit', { method: 'POST', body: JSON.stringify({}) });
    check('audit POST refused (GET only)', auditPost.status === 404);
    const audit2 = await api('/api/audit');
    check('audit non-empty after all mutations', audit2.body.length >= 20, String(audit2.body.length));

    // ---- New: primary admin cannot be disabled or deleted ----
    const meAgain = await api('/api/auth/me');
    const primaryDisable = await api(`/api/users/${meAgain.body.id}/disable`, { method: 'POST', body: JSON.stringify({}) });
    check('primary admin cannot be disabled', primaryDisable.status === 400, JSON.stringify(primaryDisable.body));
    const primaryDelete = await api(`/api/users/${meAgain.body.id}`, { method: 'DELETE' });
    check('primary admin cannot be deleted', primaryDelete.status === 400, JSON.stringify(primaryDelete.body));

    // ---- New: Meta WhatsApp integration (mocked Graph API, throwaway env) ----
    // All Meta env values below are generated in-process for this run only
    // and are never written to any file. The mock is plain Node http.
    const TEST_VERIFY = 'test-verify-' + crypto.randomBytes(8).toString('hex');
    const TEST_SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
    const TEST_TOKEN = 'test-token-' + crypto.randomBytes(16).toString('hex');
    process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY;
    process.env.WHATSAPP_APP_SECRET = TEST_SECRET;
    delete process.env.META_MOCK_BASE_URL;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    delete process.env.WHATSAPP_API_VERSION;
    const mockRequests = [];
    let mockSeq = 0;
    const mockHttp = require('http');
    const mockServer = mockHttp.createServer((mreq, mres) => {
      let b = '';
      mreq.on('data', (c) => { b += c; });
      mreq.on('end', () => {
        let parsed = null; try { parsed = b ? JSON.parse(b) : null; } catch {}
        mockRequests.push({ method: mreq.method, path: mreq.url, body: parsed });
        mres.writeHead(200, { 'Content-Type': 'application/json' });
        if (mreq.method === 'GET' && mreq.url.endsWith('/me')) return mres.end(JSON.stringify({ id: 'mock-me', name: 'Mock' }));
        if (mreq.method === 'POST' && mreq.url.endsWith('/messages')) return mres.end(JSON.stringify({ messages: [{ id: 'wamid.mock.' + (++mockSeq) }] }));
        if (mreq.method === 'GET' && mreq.url.includes('/message_templates')) return mres.end(JSON.stringify({ data: [{ name: 'contract_created', status: 'APPROVED', category: 'UTILITY', language: 'ar' }] }));
        if (mreq.method === 'POST' && mreq.url.endsWith('/message_templates')) return mres.end(JSON.stringify({ id: 'mock-template-1', status: 'PENDING' }));
        mres.end(JSON.stringify({}));
      });
    });
    await new Promise((r) => mockServer.listen(0, '127.0.0.1', r));
    const MOCK_PORT = mockServer.address().port;
    // The earlier suite leaves the Kill Switch on; Meta send tests need it off.
    await api('/api/automation/kill-switch', { method: 'POST', body: JSON.stringify({ off: false }) });
    const hmacFor = (raw) => 'sha256=' + crypto.createHmac('sha256', TEST_SECRET).update(raw).digest('hex');
    async function webhookRaw(raw, sig) {
      const headers = { 'Content-Type': 'application/json' };
      if (sig !== undefined) headers['x-hub-signature-256'] = sig;
      const r = await fetch(base + '/api/whatsapp/webhook', { method: 'POST', headers, body: raw });
      let body = {}; try { body = await r.json(); } catch {} return { status: r.status, body };
    }
    async function webhookGet(tokenVal) {
      const r = await fetch(base + `/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(tokenVal)}&hub.challenge=CHALLENGE123`, { method: 'GET' });
      return { status: r.status, text: await r.text() };
    }
    const inboundPayload = (from, wamid, text) => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba-test', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
    const statusPayload = (wamid, st) => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba-test', changes: [{ field: 'messages', value: { statuses: [{ id: wamid, status: st, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    const templateStatusPayload = (name, event) => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba-test', changes: [{ field: 'message_template_status_update', value: { message_template_name: name, event } }] }] });

    // Unauthenticated Meta endpoints rejected.
    const unauthStatus = await api('/api/whatsapp/status', { noAuth: true });
    check('unauthenticated whatsapp status rejected (401)', unauthStatus.status === 401);
    const unauthSend = await api('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ to: '+967700000001', body: 'hi' }), noAuth: true });
    check('unauthenticated whatsapp send rejected (401)', unauthSend.status === 401);
    const unauthTestToken = await api('/api/whatsapp/test-token', { method: 'POST', body: JSON.stringify({}), noAuth: true });
    check('unauthenticated whatsapp test-token rejected (401)', unauthTestToken.status === 401);

    // Webhook verification success / failure.
    const verifyOk = await webhookGet(TEST_VERIFY);
    check('webhook verification success echoes challenge', verifyOk.status === 200 && verifyOk.text === 'CHALLENGE123', verifyOk.status + ' ' + verifyOk.text);
    const verifyBad = await webhookGet('wrong-token');
    check('webhook verification failure rejected (403)', verifyBad.status === 403);

    // HMAC: bad signature, missing signature, invalid JSON, bad envelope.
    const badRaw = JSON.stringify(inboundPayload('967700000001', 'wamid.bad.1', 'bad sig'));
    const badSig = await webhookRaw(badRaw, 'sha256=' + '0'.repeat(64));
    check('webhook bad signature rejected (401)', badSig.status === 401, JSON.stringify(badSig.body));
    const missingSig = await webhookRaw(badRaw, undefined);
    check('webhook missing signature rejected when secret set (401)', missingSig.status === 401, JSON.stringify(missingSig.body));
    const invalidRaw = '{not json';
    const invalidJson = await webhookRaw(invalidRaw, hmacFor(invalidRaw));
    check('webhook invalid JSON rejected, not stored (400)', invalidJson.status === 400, JSON.stringify(invalidJson.body));
    const badEnvRaw = JSON.stringify({ object: 'something_else', entry: [] });
    const badEnv = await webhookRaw(badEnvRaw, hmacFor(badEnvRaw));
    check('webhook invalid envelope rejected (400)', badEnv.status === 400, JSON.stringify(badEnv.body));

    // Inbound to a matched contract conversation (buyer).
    const buyerConvsBefore = await api(`/api/conversations?contract_id=${id}&party=buyer`);
    const buyerConvId = buyerConvsBefore.body[0].id;
    const inRaw = JSON.stringify(inboundPayload('967700000001', 'wamid.in.1', 'مرحبا، أريد الاستفسار'));
    const inRes = await webhookRaw(inRaw, hmacFor(inRaw));
    check('webhook inbound accepted (200)', inRes.status === 200 && inRes.body.messages === 1, JSON.stringify(inRes.body));
    const buyerConvsAfter = await api(`/api/conversations?contract_id=${id}&party=buyer`);
    check('inbound routed to matched contract conversation + unread bump', buyerConvsAfter.body[0].unread_count >= 1 && !!buyerConvsAfter.body[0].last_inbound_at, JSON.stringify(buyerConvsAfter.body[0]));
    const buyerMsgs = await api(`/api/messages?conversation_id=${buyerConvId}`);
    check('inbound message stored in buyer conversation', buyerMsgs.body.some((m) => m.wamid === 'wamid.in.1' && m.body === 'مرحبا، أريد الاستفسار' && m.direction === 'in'), JSON.stringify(buyerMsgs.body));

    // Inbound to a general conversation (unknown phone, no contract created).
    const genRaw = JSON.stringify(inboundPayload('967799999999', 'wamid.gen.1', 'سؤال عام'));
    const genRes = await webhookRaw(genRaw, hmacFor(genRaw));
    check('webhook general inbound accepted (200)', genRes.status === 200 && genRes.body.messages === 1, JSON.stringify(genRes.body));
    const genConvs = await api('/api/conversations?party=general');
    check('inbound from unknown phone creates GENERAL conversation, no contract', genConvs.body.some((c) => c.contract_id === null && c.party === 'general'), JSON.stringify(genConvs.body));
    const contractsAfterGen = await api('/api/contracts');
    check('webhook never creates a contract automatically', contractsAfterGen.body.length === 1, String(contractsAfterGen.body.length));

    // wamid dedup: resending the same inbound payload stores nothing new.
    const beforeDup = (await api(`/api/messages?conversation_id=${buyerConvId}`)).body.length;
    const dupRes = await webhookRaw(inRaw, hmacFor(inRaw));
    const afterDup = (await api(`/api/messages?conversation_id=${buyerConvId}`)).body.length;
    check('wamid dedup skips duplicate inbound', dupRes.status === 200 && afterDup === beforeDup, `${beforeDup} -> ${afterDup}`);

    // ---- Unconfigured (dry-run) phase: mock server running but unused ----
    const statusUnconf = await api('/api/whatsapp/status');
    check('status extended: unconfigured, 7 wizard steps, api_version v26.0', statusUnconf.status === 200 && statusUnconf.body.meta_configured === false && statusUnconf.body.api_version === 'v26.0' && Array.isArray(statusUnconf.body.wizard_steps) && statusUnconf.body.wizard_steps.length === 7 && statusUnconf.body.templates_total === 10, JSON.stringify(statusUnconf.body));
    const ttDry = await api('/api/whatsapp/test-token', { method: 'POST', body: JSON.stringify({}) });
    check('test-token dry-run when unconfigured (no Meta call)', ttDry.status === 200 && ttDry.body.configured === false && ttDry.body.meta_ok === false && ttDry.body.dry_run === true, JSON.stringify(ttDry.body));
    const tplMarketing = await api('/api/whatsapp/templates', { method: 'POST', body: JSON.stringify({ name: 'promo_test', category: 'MARKETING', language: 'ar', body: 'اشتر الآن {{1}}' }) });
    check('template create rejects Marketing category', tplMarketing.status === 400, JSON.stringify(tplMarketing.body));
    const tplNew = await api('/api/whatsapp/templates', { method: 'POST', body: JSON.stringify({ name: 'test_notice', category: 'UTILITY', language: 'ar', body: 'تم إنشاء عقدك رقم {{1}}' }) });
    check('template create local draft (UTILITY, not_submitted)', tplNew.status === 201 && tplNew.body.meta_status === 'not_submitted' && tplNew.body.approval_status === 'pending', JSON.stringify(tplNew.body));
    const submitDry = await api(`/api/whatsapp/templates/${tplNew.body.id}/submit`, { method: 'POST', body: JSON.stringify({}) });
    check('template submit dry-run when unconfigured keeps not_submitted', submitDry.status === 200 && submitDry.body.dry_run === true && submitDry.body.template.meta_status === 'not_submitted', JSON.stringify(submitDry.body));
    const syncDry = await api('/api/whatsapp/templates/sync', { method: 'POST', body: JSON.stringify({}) });
    check('template sync dry-run when unconfigured', syncDry.status === 200 && syncDry.body.dry_run === true, JSON.stringify(syncDry.body));
    const sendDry = await api('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ to: '+967700000009', template_name: 'contract_created' }) });
    check('template send dry-run when unconfigured records locally, no Meta call', sendDry.status === 200 && sendDry.body.dry_run === true && sendDry.body.message && sendDry.body.message.dry_run === true && mockRequests.length === 0, JSON.stringify(sendDry.body));
    check('dry-run phase made zero Meta calls', mockRequests.length === 0, String(mockRequests.length));

    // ---- Mock-configured phase ----
    process.env.META_MOCK_BASE_URL = `http://127.0.0.1:${MOCK_PORT}`;
    process.env.WHATSAPP_ACCESS_TOKEN = TEST_TOKEN;
    process.env.WHATSAPP_PHONE_NUMBER_ID = '111222333';
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '444555666';
    const statusConf = await api('/api/whatsapp/status');
    check('status extended: meta_configured when env set', statusConf.status === 200 && statusConf.body.meta_configured === true && statusConf.body.phone_number_configured === true && statusConf.body.waba_configured === true && statusConf.body.whatsapp_access_configured === true, JSON.stringify(statusConf.body));
    const ttOk = await api('/api/whatsapp/test-token', { method: 'POST', body: JSON.stringify({}) });
    check('test-token success via mock, no token value in response', ttOk.status === 200 && ttOk.body.meta_ok === true && ttOk.body.dry_run === false && !JSON.stringify(ttOk.body).includes(TEST_TOKEN), JSON.stringify(ttOk.body));
    await api('/api/automation/kill-switch', { method: 'POST', body: JSON.stringify({ off: false }) });
    const sendText = await api('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ to: '+967700000001', body: 'رد داخل النافذة' }) });
    check('send text success via mock (in-window)', sendText.status === 200 && sendText.body.dry_run === false && typeof sendText.body.wamid === 'string' && sendText.body.wamid.startsWith('wamid.mock.'), JSON.stringify(sendText.body));
    const sentWamid = sendText.body.wamid;
    const sendTpl = await api('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ to: '+967700000001', template_name: 'contract_created', language: 'ar' }) });
    check('send template success via mock', sendTpl.status === 200 && sendTpl.body.dry_run === false && sendTpl.body.message.template_name === 'contract_created', JSON.stringify(sendTpl.body));
    check('mock received template send with template name', mockRequests.some((r) => r.body && r.body.type === 'template' && r.body.template && r.body.template.name === 'contract_created'), JSON.stringify(mockRequests.map((r) => r.body && r.body.type)));
    const outside = await api('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ to: '+967788888888', body: 'نص حر خارج النافذة' }) });
    check('free-text outside 24h window rejected', outside.status === 400 && outside.body.error === 'outside_24h_window_use_template', JSON.stringify(outside.body));
    const stRaw = JSON.stringify(statusPayload(sentWamid, 'delivered'));
    const stRes = await webhookRaw(stRaw, hmacFor(stRaw));
    check('status update ingestion accepted', stRes.status === 200 && stRes.body.statuses === 1, JSON.stringify(stRes.body));
    const stRaw2 = JSON.stringify(statusPayload(sentWamid, 'read'));
    await webhookRaw(stRaw2, hmacFor(stRaw2));
    const outMsgs = await api(`/api/messages?conversation_id=${buyerConvId}&direction=out`);
    check('status update moves outbound message to read', outMsgs.body.some((m) => m.wamid === sentWamid && m.meta_status === 'read'), JSON.stringify(outMsgs.body));
    const tplStRaw = JSON.stringify(templateStatusPayload('contract_created', 'APPROVED'));
    const tplStRes = await webhookRaw(tplStRaw, hmacFor(tplStRaw));
    check('template status ingestion accepted', tplStRes.status === 200 && tplStRes.body.templates === 1, JSON.stringify(tplStRes.body));
    const tplAfter = await api('/api/templates');
    const ccTpl = tplAfter.body.find((t) => t.name === 'contract_created');
    check('template status ingestion updates meta_status only', ccTpl && ccTpl.meta_status === 'approved' && ccTpl.approval_status === 'approved', JSON.stringify(ccTpl));
    const statusAfter = await api('/api/whatsapp/status');
    check('status templates_meta_approved counts Meta approvals', statusAfter.body.templates_meta_approved >= 1, JSON.stringify(statusAfter.body));
    check('no token value in any Meta response', !JSON.stringify([ttOk.body, sendText.body, sendTpl.body, statusConf.body]).includes(TEST_TOKEN));
    await api('/api/automation/kill-switch', { method: 'POST', body: JSON.stringify({ off: true }) });
    const ksSend = await api('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ to: '+967700000001', body: 'محظور' }) });
    check('send rejected while kill switch is on', ksSend.status === 400 && /kill_switch_on/.test(ksSend.body.error || ''), JSON.stringify(ksSend.body));
    await api('/api/automation/kill-switch', { method: 'POST', body: JSON.stringify({ off: false }) });
    mockServer.close();
  } catch (e) { failed++; console.log('FAIL exception', e); }
  console.log(`RESULT passed=${passed} failed=${failed}`);
  server.close(() => {
    try { fs.unlinkSync(path.join(__dirname, 'data.json')); } catch {}
    process.exit(failed ? 1 : 0);
  });
});
