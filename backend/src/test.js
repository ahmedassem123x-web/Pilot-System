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

    // ---- Unified: old 10-step checklist is only a redirect to the one 7-step wizard ----
    const checklist = await api('/api/connection-checklist');
    check('old checklist redirects to one wizard (deprecated flag)', checklist.status === 200 && checklist.body.deprecated === true && checklist.body.redirect === '/api/whatsapp/linking' && Array.isArray(checklist.body.steps) && checklist.body.steps.length === 7, JSON.stringify(checklist.body));
    const linking = await api('/api/whatsapp/linking');
    check('one linking wizard has exactly 7 server-driven steps', linking.status === 200 && Array.isArray(linking.body.steps) && linking.body.steps.length === 7 && linking.body.steps[0].key === 'meta_business' && linking.body.steps[6].key === 'test_message' && !JSON.stringify(linking.body).includes('WHATSAPP_ACCESS_TOKEN'), JSON.stringify(linking.body));

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
        if (mreq.method === 'GET' && mreq.url.includes('/oauth/access_token')) return mres.end(JSON.stringify({ access_token: 'mock-exchanged-token-xyz', token_type: 'bearer', expires_in: 3600 }));
        if (mreq.method === 'GET' && mreq.url.includes('/phone_numbers')) return mres.end(JSON.stringify({ data: [{ id: '111222333', display_name: 'Mock Business' }] }));
        if (mreq.method === 'GET' && mreq.url.endsWith('/me')) return mres.end(JSON.stringify({ id: 'mock-me', name: 'Mock' }));
        if (mreq.method === 'POST' && mreq.url.includes('/media')) return mres.end(JSON.stringify({ id: 'mock-media-123' }));
        if (mreq.method === 'GET' && /^\/v[^/]+\/[^/]+$/.test(mreq.url)) return mres.end(JSON.stringify({ url: 'https://mock.example/media/mock-media-123', mime_type: 'image/jpeg', file_size: 1234 }));
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
    // New send gate (Stage A): Meta-configured sends need Meta approval too,
    // so approve contract_created via the Meta webhook before sending it.
    const preApproveRaw = JSON.stringify(templateStatusPayload('contract_created', 'APPROVED'));
    await webhookRaw(preApproveRaw, hmacFor(preApproveRaw));
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

    // ---- Stage A: Embedded Signup + full template management + new send gate ----
    const embBefore = await api('/api/whatsapp/embedded-signup/config');
    check('embedded config reports not configured without app/config ids', embBefore.status === 200 && embBefore.body.embedded_configured === false && embBefore.body.launch === null && !JSON.stringify(embBefore.body).includes(TEST_SECRET), JSON.stringify(embBefore.body));
    const embNoCode = await api('/api/whatsapp/embedded-signup/callback', { method: 'POST', body: JSON.stringify({ code: 'x' }) });
    check('embedded callback without app/config ids rejected', embNoCode.status === 400 && /embedded_not_configured/.test(embNoCode.body.error || ''), JSON.stringify(embNoCode.body));
    process.env.WHATSAPP_APP_ID = 'mock-app-id-123';
    process.env.WHATSAPP_CONFIG_ID = 'mock-config-id-456';
    const embCfg = await api('/api/whatsapp/embedded-signup/config');
    check('embedded config ready with app/config ids, launch params public only', embCfg.status === 200 && embCfg.body.embedded_configured === true && embCfg.body.launch && embCfg.body.launch.client_id === 'mock-app-id-123' && embCfg.body.launch.config_id === 'mock-config-id-456' && !JSON.stringify(embCfg.body).includes(TEST_SECRET), JSON.stringify(embCfg.body));
    const embStatus = await api('/api/whatsapp/status');
    check('status carries embedded_signup booleans (manual vs embedded)', embStatus.status === 200 && embStatus.body.embedded_signup && embStatus.body.embedded_signup.configured === true && embStatus.body.meta_configured === true, JSON.stringify(embStatus.body.embedded_signup));
    const embNoCode2 = await api('/api/whatsapp/embedded-signup/callback', { method: 'POST', body: JSON.stringify({}) });
    check('embedded callback without code rejected', embNoCode2.status === 400 && embNoCode2.body.error === 'code is required', JSON.stringify(embNoCode2.body));
    const embOk = await api('/api/whatsapp/embedded-signup/callback', { method: 'POST', body: JSON.stringify({ code: 'mock-code-1', redirect_uri: 'http://127.0.0.1/' }) });
    check('embedded callback exchanges code, validates via /me, returns ids only', embOk.status === 200 && embOk.body.ok === true && embOk.body.tested === true && embOk.body.persisted === false && embOk.body.waba_id === '444555666' && embOk.body.phone_number_id === '111222333' && embOk.body.display_name === 'Mock Business', JSON.stringify(embOk.body));
    check('embedded callback never returns the exchanged token or app secret', !JSON.stringify(embOk.body).includes('mock-exchanged-token-xyz') && !JSON.stringify(embOk.body).includes(TEST_SECRET), JSON.stringify(embOk.body));
    let dataAfterEmb = '';
    try { dataAfterEmb = fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'); } catch {}
    check('embedded token not persisted to data file', !dataAfterEmb.includes('mock-exchanged-token-xyz'), 'token found in data file');
    const unauthEmb = await api('/api/whatsapp/embedded-signup/config', { noAuth: true });
    check('unauthenticated embedded config rejected (401)', unauthEmb.status === 401);
    const tplGap = await api('/api/whatsapp/templates', { method: 'POST', body: JSON.stringify({ name: 'gap_notice', category: 'UTILITY', language: 'ar', body: 'رقم {{1}} و {{3}} هنا' }) });
    check('template create rejects placeholder gap', tplGap.status === 400, JSON.stringify(tplGap.body));
    const tplBadName = await api('/api/whatsapp/templates', { method: 'POST', body: JSON.stringify({ name: 'Bad-Name', category: 'UTILITY', language: 'ar', body: 'نص سليم' }) });
    check('template create rejects uppercase/dash name', tplBadName.status === 400, JSON.stringify(tplBadName.body));
    const tplManyBtns = await api('/api/whatsapp/templates', { method: 'POST', body: JSON.stringify({ name: 'many_btns', category: 'UTILITY', language: 'ar', body: 'نص سليم', buttons: ['a', 'b', 'c', 'd'] }) });
    check('template create rejects more than 3 buttons', tplManyBtns.status === 400, JSON.stringify(tplManyBtns.body));
    const tplStage = await api('/api/whatsapp/templates', { method: 'POST', body: JSON.stringify({ name: 'stage_notice', category: 'UTILITY', language: 'ar', body: 'تم إنشاء عقدك رقم {{1}} بمبلغ {{2}} ريال', header_type: 'text', header_text: 'تنبيه عقد', footer: 'فريق Pilot', buttons: ['تأكيد', 'دعم'], sample_values: ['PS-1001', '250'] }) });
    check('template create with header/footer/buttons/samples', tplStage.status === 201 && tplStage.body.header_type === 'text' && tplStage.body.footer === 'فريق Pilot' && tplStage.body.sample_values.length === 2 && tplStage.body.meta_status === 'not_submitted', JSON.stringify(tplStage.body));
    const tplPrev = await api(`/api/whatsapp/templates/${tplStage.body.id}`);
    check('template preview renders sample values + sendable false while pending', tplPrev.status === 200 && tplPrev.body.preview && tplPrev.body.preview.includes('PS-1001') && tplPrev.body.preview.includes('250') && tplPrev.body.sendable === false && tplPrev.body.placeholders.length === 2, JSON.stringify(tplPrev.body));
    const tplEdit = await api(`/api/whatsapp/templates/${tplStage.body.id}`, { method: 'PUT', body: JSON.stringify({ footer: 'فريق Pilot المحدّث', sample_values: ['PS-2002', '300'] }) });
    check('template draft edit updates footer/samples', tplEdit.status === 200 && tplEdit.body.footer === 'فريق Pilot المحدّث' && tplEdit.body.sample_values[0] === 'PS-2002', JSON.stringify(tplEdit.body));
    const tplEditName = await api(`/api/whatsapp/templates/${tplStage.body.id}`, { method: 'PUT', body: JSON.stringify({ name: 'renamed' }) });
    check('template draft edit rejects name change', tplEditName.status === 400, JSON.stringify(tplEditName.body));
    const tplSubmit = await api(`/api/whatsapp/templates/${tplStage.body.id}/submit`, { method: 'POST', body: JSON.stringify({}) });
    check('template submit via mock sets pending + meta id', tplSubmit.status === 200 && tplSubmit.body.template.meta_status === 'pending' && tplSubmit.body.template.meta_template_id === 'mock-template-1', JSON.stringify(tplSubmit.body));
    const tplEditLocked = await api(`/api/whatsapp/templates/${tplStage.body.id}`, { method: 'PUT', body: JSON.stringify({ footer: 'محاولة بعد التقديم' }) });
    check('template pending at Meta is not draft-editable', tplEditLocked.status === 400 && /not_editable/.test(tplEditLocked.body.error || ''), JSON.stringify(tplEditLocked.body));
    const tplSync = await api('/api/whatsapp/templates/sync', { method: 'POST', body: JSON.stringify({}) });
    check('template sync via mock keeps pending template pending', tplSync.status === 200 && tplSync.body.configured === true, JSON.stringify(tplSync.body));
    await api(`/api/templates/${tplStage.body.id}`, { method: 'PUT', body: JSON.stringify({ approval_status: 'approved' }) });
    const gateSend = await api('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ to: '+967700000001', template_name: 'stage_notice', language: 'ar', parameters: ['PS-2002', '300'] }) });
    check('send gate: local-only approved rejected when Meta configured', gateSend.status === 400 && gateSend.body.error === 'template_not_meta_approved', JSON.stringify(gateSend.body));
    await webhookRaw(JSON.stringify(templateStatusPayload('stage_notice', 'APPROVED')), hmacFor(JSON.stringify(templateStatusPayload('stage_notice', 'APPROVED'))));
    const gateSendOk = await api('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ to: '+967700000001', template_name: 'stage_notice', language: 'ar', parameters: ['PS-2002', '300'] }) });
    check('send gate: Meta-approved allowed when Meta configured', gateSendOk.status === 200 && gateSendOk.body.dry_run === false && gateSendOk.body.message.template_name === 'stage_notice', JSON.stringify(gateSendOk.body));
    // ---- Stage B: automation execution + file upload ----
    // Deactivate the old storage-only workflow so its empty text step
    // cannot win a keyword race in the tests below.
    await api(`/api/workflows/${goodFlow.body.id}`, { method: 'PUT', body: JSON.stringify({ is_active: false }) });
    const moneyNested = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'banned-nested', trigger_type: 'keyword', trigger_value: 'x', steps: [{ step_type: 'condition', if_contains: 'نعم', then: [{ step_type: 'release_money' }], else: [] }] }) });
    check('Stage B save: nested money step in condition branch rejected', moneyNested.status === 400, JSON.stringify(moneyNested.body));
    const moneyRule = await api('/api/automation/rules', { method: 'POST', body: JSON.stringify({ name: 'banned-rule', trigger_type: 'keyword', trigger_value: 'x', steps: [{ step_type: 'refund_money' }] }) });
    check('Stage B save: money step in rule rejected', moneyRule.status === 400, JSON.stringify(moneyRule.body));
    const kwShort = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'kw-short', trigger_type: 'keyword', trigger_value: 'عقد', steps: [{ step_type: 'text', content: 'رد قصير' }] }) });
    const kwLong = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'kw-long', trigger_type: 'keyword', trigger_value: 'عقد جديد', steps: [{ step_type: 'text', content: 'رد طويل' }] }) });
    const kwContain = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'kw-contain', trigger_type: 'keyword', trigger_value: 'استفسار', steps: [{ step_type: 'text', content: 'رد استفسار' }] }) });
    check('Stage B keyword workflows created', kwShort.status === 201 && kwLong.status === 201 && kwContain.status === 201, JSON.stringify([kwShort.body, kwLong.body]));
    const genConvFor = async (phone) => { const all = await api('/api/conversations?party=general'); return all.body.find((c) => c.phone === phone || String(c.phone || '').replace(/^\+/, '') === phone.replace(/^\+/, '')); };
    const outBodiesFor = async (convId) => { const ms = await api(`/api/messages?conversation_id=${convId}&direction=out`); return ms.body.map((m) => m.body); };
    // Keyword: exact before contains, longest wins.
    await webhookRaw(JSON.stringify(inboundPayload('967711111111', 'wamid.b.kw1', 'عقد جديد')), hmacFor(JSON.stringify(inboundPayload('967711111111', 'wamid.b.kw1', 'عقد جديد'))));
    const kwConv = await genConvFor('967711111111');
    check('Stage B keyword longest/exact wins over short', kwConv && (await outBodiesFor(kwConv.id)).includes('رد طويل') && !(await outBodiesFor(kwConv.id)).includes('رد قصير'), JSON.stringify(kwConv));
    await webhookRaw(JSON.stringify(inboundPayload('967711111112', 'wamid.b.kw2', 'عندي استفسار عن السعر')), hmacFor(JSON.stringify(inboundPayload('967711111112', 'wamid.b.kw2', 'عندي استفسار عن السعر'))));
    const kwConv2 = await genConvFor('967711111112');
    check('Stage B keyword contains matches', kwConv2 && (await outBodiesFor(kwConv2.id)).includes('رد استفسار'), JSON.stringify(kwConv2));
    // Button/list reply trigger.
    const btnWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'btn-wf', trigger_type: 'button_reply', trigger_value: 'تأكيد الطلب', steps: [{ step_type: 'text', content: 'شكرا على التأكيد' }] }) });
    const btnPayload = { object: 'whatsapp_business_account', entry: [{ id: 'waba-test', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from: '967711111113', id: 'wamid.b.btn1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'confirm_order', title: 'تأكيد الطلب' } } }] } }] }] };
    await webhookRaw(JSON.stringify(btnPayload), hmacFor(JSON.stringify(btnPayload)));
    const btnConv = await genConvFor('967711111113');
    check('Stage B button reply trigger', btnConv && (await outBodiesFor(btnConv.id)).includes('شكرا على التأكيد'), JSON.stringify(btnConv));
    // Contract-event trigger (template step, Stage A gate respected).
    const ceWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'ce-wf', trigger_type: 'contract-event', trigger_value: 'preparing', steps: [{ step_type: 'template', template_name: 'stage_notice', parameters: ['PS-2002', '300'] }] }) });
    check('Stage B contract-event workflow created', ceWf.status === 201, JSON.stringify(ceWf.body));
    const toPrep = await api(`/api/contracts/${id}/transition`, { method: 'POST', body: JSON.stringify({ to: 'preparing' }) });
    check('Stage B contract transition to preparing accepted', toPrep.status === 200 && toPrep.body.state === 'preparing', JSON.stringify(toPrep.body));
    const buyerOut = await api(`/api/messages?conversation_id=${buyerConvId}&direction=out`);
    check('Stage B contract-event sends template to buyer conversation', buyerOut.body.some((m) => m.template_name === 'stage_notice' && m.automation === true), JSON.stringify(buyerOut.body.map((m) => m.template_name)));
    // Fallback after 2 unknowns (no first-message/business workflows active yet).
    const fbWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'fb-wf', trigger_type: 'fallback', steps: [{ step_type: 'text', content: 'لم أفهم، سيتواصل معك موظف' }] }) });
    await webhookRaw(JSON.stringify(inboundPayload('967711111114', 'wamid.b.fb1', 'xyz123unknown')), hmacFor(JSON.stringify(inboundPayload('967711111114', 'wamid.b.fb1', 'xyz123unknown'))));
    const fbConv = await genConvFor('967711111114');
    const fbOut1 = fbConv ? await outBodiesFor(fbConv.id) : [];
    await webhookRaw(JSON.stringify(inboundPayload('967711111114', 'wamid.b.fb2', 'abc987unknown')), hmacFor(JSON.stringify(inboundPayload('967711111114', 'wamid.b.fb2', 'abc987unknown'))));
    const fbOut2 = fbConv ? await outBodiesFor(fbConv.id) : [];
    check('Stage B fallback only after 2nd unknown message', fbConv && fbOut1.length === 0 && fbOut2.includes('لم أفهم، سيتواصل معك موظف'), JSON.stringify([fbOut1, fbOut2]));
    // Business-hours / away triggers.
    const bhWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'bh-wf', trigger_type: 'business_hours', trigger_value: '00:00-23:59', steps: [{ step_type: 'text', content: 'نحن متاحون الآن' }] }) });
    const awWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'aw-wf', trigger_type: 'away', trigger_value: '00:00-00:01', steps: [{ step_type: 'text', content: 'نحن خارج الدوام الآن' }] }) });
    await webhookRaw(JSON.stringify(inboundPayload('967711111115', 'wamid.b.bh1', 'مرحبا بالنهار')), hmacFor(JSON.stringify(inboundPayload('967711111115', 'wamid.b.bh1', 'مرحبا بالنهار'))));
    const bhConv = await genConvFor('967711111115');
    check('Stage B business-hours trigger', bhConv && (await outBodiesFor(bhConv.id)).includes('نحن متاحون الآن'), JSON.stringify(bhConv));
    await api(`/api/workflows/${bhWf.body.id}`, { method: 'PUT', body: JSON.stringify({ is_active: false }) });
    await webhookRaw(JSON.stringify(inboundPayload('967711111116', 'wamid.b.aw1', 'مرحبا بالليل')), hmacFor(JSON.stringify(inboundPayload('967711111116', 'wamid.b.aw1', 'مرحبا بالليل'))));
    const awConv = await genConvFor('967711111116');
    check('Stage B away trigger', awConv && (await outBodiesFor(awConv.id)).includes('نحن خارج الدوام الآن'), JSON.stringify(awConv));
    await api(`/api/workflows/${awWf.body.id}`, { method: 'PUT', body: JSON.stringify({ is_active: false }) });
    // First message trigger (and only the first).
    const fmWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'fm-wf', trigger_type: 'first_message', steps: [{ step_type: 'text', content: 'أهلا بك لأول مرة' }] }) });
    await webhookRaw(JSON.stringify(inboundPayload('967711111117', 'wamid.b.fm1', 'سلام')), hmacFor(JSON.stringify(inboundPayload('967711111117', 'wamid.b.fm1', 'سلام'))));
    const fmConv = await genConvFor('967711111117');
    const fmOut1 = fmConv ? await outBodiesFor(fmConv.id) : [];
    await webhookRaw(JSON.stringify(inboundPayload('967711111117', 'wamid.b.fm2', 'سلام مرة أخرى')), hmacFor(JSON.stringify(inboundPayload('967711111117', 'wamid.b.fm2', 'سلام مرة أخرى'))));
    const fmOut2 = fmConv ? await outBodiesFor(fmConv.id) : [];
    check('Stage B first message triggers once only', fmConv && fmOut1.includes('أهلا بك لأول مرة') && fmOut2.length === fmOut1.length, JSON.stringify([fmOut1, fmOut2]));
    await api(`/api/workflows/${fmWf.body.id}`, { method: 'PUT', body: JSON.stringify({ is_active: false }) });
    // Ask question and wait for reply, then continue.
    const askWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'ask-wf', trigger_type: 'keyword', trigger_value: 'سؤال', steps: [{ step_type: 'question_text', question: 'ما هو رقم طلبك؟' }, { step_type: 'text', content: 'شكرا، تم استلام رقم طلبك' }] }) });
    await webhookRaw(JSON.stringify(inboundPayload('967711111118', 'wamid.b.ask1', 'سؤال')), hmacFor(JSON.stringify(inboundPayload('967711111118', 'wamid.b.ask1', 'سؤال'))));
    const askConv = await genConvFor('967711111118');
    const askOut1 = askConv ? await outBodiesFor(askConv.id) : [];
    const askState1 = askConv ? await api(`/api/conversations/${askConv.id}/automation`) : null;
    await webhookRaw(JSON.stringify(inboundPayload('967711111118', 'wamid.b.ask2', '12345')), hmacFor(JSON.stringify(inboundPayload('967711111118', 'wamid.b.ask2', '12345'))));
    const askOut2 = askConv ? await outBodiesFor(askConv.id) : [];
    const askState2 = askConv ? await api(`/api/conversations/${askConv.id}/automation`) : null;
    check('Stage B ask question waits, then continues on reply', askConv && askOut1.length === 1 && askOut1[0] === 'ما هو رقم طلبك؟' && askState1 && askState1.body.waiting && askOut2.includes('شكرا، تم استلام رقم طلبك') && askState2 && !askState2.body.waiting, JSON.stringify([askOut1, askOut2, askState1 && askState1.body, askState2 && askState2.body]));
    // Condition / branch.
    const condWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'cond-wf', trigger_type: 'keyword', trigger_value: 'فرع', steps: [{ step_type: 'condition', if_contains: 'نعم', then: [{ step_type: 'text', content: 'اخترت نعم' }], else: [{ step_type: 'text', content: 'اخترت لا' }] }] }) });
    await webhookRaw(JSON.stringify(inboundPayload('967711111119', 'wamid.b.cd1', 'فرع نعم')), hmacFor(JSON.stringify(inboundPayload('967711111119', 'wamid.b.cd1', 'فرع نعم'))));
    const cdConv = await genConvFor('967711111119');
    await webhookRaw(JSON.stringify(inboundPayload('967711111120', 'wamid.b.cd2', 'فرع لا')), hmacFor(JSON.stringify(inboundPayload('967711111120', 'wamid.b.cd2', 'فرع لا'))));
    const cdConv2 = await genConvFor('967711111120');
    check('Stage B condition branches on reply text', cdConv && (await outBodiesFor(cdConv.id)).includes('اخترت نعم') && cdConv2 && (await outBodiesFor(cdConv2.id)).includes('اخترت لا'), JSON.stringify(cdConv));
    // Assign + label + note + task in one flow.
    const opsWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'ops-wf', trigger_type: 'keyword', trigger_value: 'تشغيل', steps: [{ step_type: 'assign', assigned_to: 'ops-stageb' }, { step_type: 'add_label', label: 'stageb-label' }, { step_type: 'add_note', content: 'ملاحظة أتمتة' }, { step_type: 'create_task', title: 'مهمة أتمتة مرحلة B' }] }) });
    await webhookRaw(JSON.stringify(inboundPayload('967711111121', 'wamid.b.ops1', 'تشغيل')), hmacFor(JSON.stringify(inboundPayload('967711111121', 'wamid.b.ops1', 'تشغيل'))));
    const opsConv = await genConvFor('967711111121');
    const opsConvAfter = opsConv ? await api(`/api/conversations/${opsConv.id}`) : null;
    const opsState = opsConv ? await api(`/api/conversations/${opsConv.id}/automation`) : null;
    const opsTasks = await api('/api/tasks?type=automation');
    const opsNotes = opsConv ? await api(`/api/messages?conversation_id=${opsConv.id}&internal=true`) : null;
    check('Stage B assign/label/note/task actions', opsConv && opsConvAfter && opsConvAfter.body.assigned_to === 'ops-stageb' && opsState && opsState.body.labels.includes('stageb-label') && opsTasks.body.some((t) => t.title === 'مهمة أتمتة مرحلة B') && opsNotes && opsNotes.body.some((m) => m.body === 'ملاحظة أتمتة'), JSON.stringify([opsConvAfter && opsConvAfter.body, opsState && opsState.body]));
    // Human handoff stops automation until a human resumes.
    const hoWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'ho-wf', trigger_type: 'keyword', trigger_value: 'تحويل', steps: [{ step_type: 'text', content: 'قبل التحويل' }, { step_type: 'handover', handover_note: 'إلى موظف' }, { step_type: 'text', content: 'بعد التحويل يجب ألا يرسل' }] }) });
    await webhookRaw(JSON.stringify(inboundPayload('967711111122', 'wamid.b.ho1', 'تحويل')), hmacFor(JSON.stringify(inboundPayload('967711111122', 'wamid.b.ho1', 'تحويل'))));
    const hoConv = await genConvFor('967711111122');
    const hoOut1 = hoConv ? await outBodiesFor(hoConv.id) : [];
    await webhookRaw(JSON.stringify(inboundPayload('967711111122', 'wamid.b.ho2', 'تحويل مرة أخرى')), hmacFor(JSON.stringify(inboundPayload('967711111122', 'wamid.b.ho2', 'تحويل مرة أخرى'))));
    const hoOut2 = hoConv ? await outBodiesFor(hoConv.id) : [];
    const resume = hoConv ? await api(`/api/conversations/${hoConv.id}/automation/resume`, { method: 'POST', body: JSON.stringify({}) }) : null;
    await webhookRaw(JSON.stringify(inboundPayload('967711111122', 'wamid.b.ho3', 'تحويل')), hmacFor(JSON.stringify(inboundPayload('967711111122', 'wamid.b.ho3', 'تحويل'))));
    const hoOut3 = hoConv ? await outBodiesFor(hoConv.id) : [];
    check('Stage B handoff stops automation until human resumes', hoConv && hoOut1.length === 1 && hoOut1[0] === 'قبل التحويل' && hoOut2.length === 1 && resume && resume.body.handed_off === false && hoOut3.length === 2, JSON.stringify([hoOut1, hoOut2, hoOut3]));
    // Kill Switch blocks all automation sends (and logs the block).
    await api('/api/automation/kill-switch', { method: 'POST', body: JSON.stringify({ off: true }) });
    const ksWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'ks-wf', trigger_type: 'keyword', trigger_value: 'اختبار إيقاف', steps: [{ step_type: 'text', content: 'يجب ألا يرسل' }] }) });
    await webhookRaw(JSON.stringify(inboundPayload('967711111123', 'wamid.b.ks1', 'اختبار إيقاف')), hmacFor(JSON.stringify(inboundPayload('967711111123', 'wamid.b.ks1', 'اختبار إيقاف'))));
    const ksConv = await genConvFor('967711111123');
    const ksOut = ksConv ? await outBodiesFor(ksConv.id) : [];
    const ksLogs = ksConv ? await api(`/api/automation/logs?conversation_id=${ksConv.id}&outcome=blocked_kill_switch`) : null;
    await api('/api/automation/kill-switch', { method: 'POST', body: JSON.stringify({ off: false }) });
    check('Stage B kill switch blocks automation sends and logs it', ksConv && ksOut.length === 0 && ksLogs && ksLogs.body.length >= 1, JSON.stringify([ksOut, ksLogs && ksLogs.body]));
    // Automation permission gating (viewer cannot manually run).
    const viewerRun = await apiAs(viewerToken, `/api/workflows/${kwLong.body.id}/run`, { method: 'POST', body: JSON.stringify({ conversation_id: kwConv.id }) });
    check('Stage B viewer cannot manually run automation (403)', viewerRun.status === 403, JSON.stringify(viewerRun.body));
    // Automation execution log is readable.
    const logs = await api(`/api/automation/logs?conversation_id=${kwConv.id}`);
    check('Stage B automation execution log recorded', logs.status === 200 && logs.body.some((x) => x.outcome === 'completed' || x.outcome === 'sent'), JSON.stringify(logs.body.map((x) => x.outcome)));
    // ---- Stage B file upload ----
    async function uploadMultipart({ filename, mime, data, to, conversation_id, caption, tok }) {
      const boundary = '----StageBTest' + crypto.randomBytes(6).toString('hex');
      const parts = [];
      const pushField = (name, value) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
      if (to) pushField('to', to);
      if (conversation_id) pushField('conversation_id', String(conversation_id));
      if (caption) pushField('caption', caption);
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`));
      parts.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
      const headers = { 'Content-Type': `multipart/form-data; boundary=${boundary}` };
      if (tok) headers.Authorization = 'Bearer ' + tok;
      else if (token) headers.Authorization = 'Bearer ' + token;
      const r = await fetch(base + '/api/whatsapp/upload', { method: 'POST', headers, body: Buffer.concat(parts) });
      let body = {}; try { body = await r.json(); } catch {} return { status: r.status, body };
    }
    const upBad = await uploadMultipart({ filename: 'evil.exe', mime: 'application/octet-stream', data: 'MZfake', to: '+967700000001' });
    check('Stage B upload rejects bad file type', upBad.status === 400 && /unsupported/.test(upBad.body.error || ''), JSON.stringify(upBad.body));
    const upBig = await uploadMultipart({ filename: 'big.png', mime: 'image/png', data: Buffer.alloc(16 * 1024 * 1024 + 1, 97) });
    check('Stage B upload rejects oversize file (16 MB cap)', upBig.status === 413, JSON.stringify(upBig.body).slice(0, 200));
    const upViewer = await uploadMultipart({ filename: 'ok.png', mime: 'image/png', data: Buffer.from('fakepng'), to: '+967700000001', tok: viewerToken });
    check('Stage B upload requires whatsapp:edit (viewer 403)', upViewer.status === 403, JSON.stringify(upViewer.body));
    const upSan = await uploadMultipart({ filename: '../../evil.png', mime: 'image/png', data: Buffer.from('fakepngdata'), to: '+967700000001', caption: 'صورة تجريبية' });
    check('Stage B upload sanitizes filename, gets media ID, sends by media ID', upSan.status === 200 && upSan.body.upload && upSan.body.upload.filename === 'evil.png' && !upSan.body.upload.stored_filename.includes('..') && upSan.body.upload.media_id === 'mock-media-123' && upSan.body.dry_run === false && typeof upSan.body.wamid === 'string', JSON.stringify(upSan.body));
    check('Stage B mock received media send by ID', mockRequests.some((r) => r.body && r.body.type === 'image' && r.body.image && r.body.image.id === 'mock-media-123'), JSON.stringify(mockRequests.slice(-3).map((r) => r.body)));
    const upOnly = await uploadMultipart({ filename: 'doc.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-fake') });
    check('Stage B upload without recipient stores media ID only', upOnly.status === 201 && upOnly.body.upload && upOnly.body.upload.media_id === 'mock-media-123' && upOnly.body.upload.kind === 'document', JSON.stringify(upOnly.body));
    const upList = await api('/api/whatsapp/uploads');
    check('Stage B uploads list contains sanitized upload', upList.status === 200 && upList.body.some((u) => u.filename === 'evil.png'), JSON.stringify(upList.body.map((u) => u.filename)));
    // Inbound media stores metadata (media ID, mime family via type, caption).
    const mediaPayload = { object: 'whatsapp_business_account', entry: [{ id: 'waba-test', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from: '967700000001', id: 'wamid.b.media1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'mock-in-media-1', caption: 'صورة المنتج' } }] } }] }] };
    await webhookRaw(JSON.stringify(mediaPayload), hmacFor(JSON.stringify(mediaPayload)));
    const mediaMsgs = await api(`/api/messages?conversation_id=${buyerConvId}`);
    check('Stage B inbound media metadata stored', mediaMsgs.body.some((m) => m.wamid === 'wamid.b.media1' && m.media_type === 'image' && m.media_id === 'mock-in-media-1' && m.media_caption === 'صورة المنتج'), JSON.stringify(mediaMsgs.body.filter((m) => m.wamid === 'wamid.b.media1')));
    const mediaUrl = await api('/api/whatsapp/media/mock-media-123');
    check('Stage B media download link via Meta when configured', mediaUrl.status === 200 && mediaUrl.body.configured === true && mediaUrl.body.download_url === 'https://mock.example/media/mock-media-123', JSON.stringify(mediaUrl.body));
    // ---- Stage B execution-time money rejection (banned workflow injected
    // into a fresh child server process, because the save-time gate
    // correctly refuses to create such a workflow through the API) ----
    let execMoneyOk = false;
    try {
      const dataPath = path.join(__dirname, 'data.json');
      const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      rawData.workflows.push({ id: 999001, name: 'banned-exec', trigger_type: 'manual', trigger_value: null, steps: [{ step_type: 'release_money' }], is_active: true });
      fs.writeFileSync(dataPath, JSON.stringify(rawData, null, 2));
      const { spawn: spawnChild } = require('child_process');
      const child = spawnChild(process.execPath, [path.join(__dirname, 'server.js')], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '3457' }, stdio: 'ignore' });
      const childBase = 'http://127.0.0.1:3457';
      let childUp = false;
      for (let i = 0; i < 50 && !childUp; i++) { try { const hr = await fetch(childBase + '/health'); if (hr.ok) childUp = true; } catch {} if (!childUp) await new Promise((r) => setTimeout(r, 100)); }
      if (childUp) {
        const cl = await fetch(childBase + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
        const clBody = await cl.json().catch(() => ({}));
        if (clBody.token) {
          const runRes = await fetch(childBase + '/api/workflows/999001/run', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + clBody.token }, body: JSON.stringify({ conversation_id: buyerConvId }) });
          const runBody = await runRes.json().catch(() => ({}));
          execMoneyOk = (runRes.status === 400 && /money/.test(runBody.error || ''));
        }
      }
      child.kill();
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) { execMoneyOk = false; }
    check('Stage B execution-time money step rejected at run', execMoneyOk, 'child run did not return money rejection');

    // ---- Stage C: contacts (contract-scoped only, whatsapp permission family) ----
    const cBuyer = await api('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'مشتري اختبار', phone: '+967700000001', labels: ['عميل متكرر', 'أولوية'], notes: 'ملاحظة اختبار' }) });
    check('Stage C contact created for contract buyer phone', cBuyer.status === 201 && cBuyer.body.phone === '+967700000001' && Array.isArray(cBuyer.body.roles) && cBuyer.body.roles.includes('buyer'), JSON.stringify(cBuyer.body));
    const cBad = await api('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'x', phone: 'abc' }) });
    check('Stage C contact invalid phone rejected (400)', cBad.status === 400, JSON.stringify(cBad.body));
    const cDup = await api('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'dup', phone: '967 700 000 001' }) });
    check('Stage C contact duplicate phone rejected (409, format-insensitive)', cDup.status === 409, JSON.stringify(cDup.body));
    const cSeller = await api('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'بائع اختبار', phone: '+967700000002', labels: ['عميل متكرر'] }) });
    check('Stage C contact created for contract seller phone', cSeller.status === 201 && cSeller.body.roles.includes('seller'), JSON.stringify(cSeller.body));
    const cStranger = await api('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'غريب', phone: '+967700000099' }) });
    check('Stage C contact without contract has no roles and is not eligible', cStranger.status === 201 && cStranger.body.roles.length === 0 && cStranger.body.utility_eligible === false && cStranger.body.contracts.length === 0, JSON.stringify(cStranger.body));
    const cSearch = await api('/api/contacts?q=' + encodeURIComponent('مشتري'));
    check('Stage C contacts search by name', cSearch.status === 200 && cSearch.body.some((x) => x.id === cBuyer.body.id) && !cSearch.body.some((x) => x.id === cSeller.body.id), JSON.stringify(cSearch.body.map((x) => x.name)));
    const cSeg = await api('/api/contacts?segment=' + encodeURIComponent('عميل متكرر'));
    check('Stage C contacts segment filter', cSeg.status === 200 && cSeg.body.some((x) => x.id === cBuyer.body.id) && cSeg.body.some((x) => x.id === cSeller.body.id) && !cSeg.body.some((x) => x.id === cStranger.body.id), JSON.stringify(cSeg.body.map((x) => x.name)));
    const cRoleB = await api('/api/contacts?role=buyer');
    check('Stage C contacts role=buyer filter', cRoleB.status === 200 && cRoleB.body.some((x) => x.id === cBuyer.body.id) && !cRoleB.body.some((x) => x.id === cSeller.body.id), JSON.stringify(cRoleB.body.map((x) => x.name)));
    const cRoleS = await api('/api/contacts?role=seller');
    check('Stage C contacts role=seller filter', cRoleS.status === 200 && cRoleS.body.some((x) => x.id === cSeller.body.id) && !cRoleS.body.some((x) => x.id === cBuyer.body.id), JSON.stringify(cRoleS.body.map((x) => x.name)));
    const cDetail = await api(`/api/contacts/${cBuyer.body.id}`);
    check('Stage C contact detail links conversations+contracts, eligible via prior inbound', cDetail.status === 200 && cDetail.body.contracts.some((x) => x.id === id && x.role === 'buyer') && cDetail.body.conversations.some((x) => x.id === buyerConvId) && cDetail.body.utility_eligible === true && cDetail.body.eligibility_basis === 'prior_inbound' && !!cDetail.body.last_contact_at, JSON.stringify(cDetail.body));
    const cLast = await api('/api/contacts?last_contact_after=2999-01-01T00:00:00.000Z');
    check('Stage C contacts last-contact filter excludes stale contacts', cLast.status === 200 && !cLast.body.some((x) => x.id === cBuyer.body.id), JSON.stringify(cLast.body.map((x) => x.id)));
    const cUpd = await api(`/api/contacts/${cStranger.body.id}`, { method: 'PUT', body: JSON.stringify({ labels: ['جديد'], notes: 'محدث' }) });
    check('Stage C contact update', cUpd.status === 200 && cUpd.body.labels.includes('جديد') && cUpd.body.notes === 'محدث', JSON.stringify(cUpd.body));
    const cUpdDup = await api(`/api/contacts/${cStranger.body.id}`, { method: 'PUT', body: JSON.stringify({ phone: '+967700000001' }) });
    check('Stage C contact update to duplicate phone rejected (409)', cUpdDup.status === 409, JSON.stringify(cUpdDup.body));
    const csvStageC = ['name,phone,labels,notes', 'مستورد أول,+967700000101,عميل متكرر,من CSV', 'مكرر موجود,+967700000001,عميل متكرر,', 'مكرر داخل الملف,+967700000101,,', 'صف سيئ,not-a-phone,,', 'مستورد ثان,+967700000102,,'].join('\n');
    const cImp = await api('/api/contacts/import', { method: 'POST', body: JSON.stringify({ csv: csvStageC }) });
    check('Stage C CSV import report: created/skipped/errors', cImp.status === 200 && cImp.body.created === 2 && cImp.body.skipped === 2 && cImp.body.errors === 1 && cImp.body.total === 5 && cImp.body.details.length === 5, JSON.stringify(cImp.body));
    check('Stage C CSV import details name reasons', cImp.body.details.some((d) => d.status === 'skipped' && d.reason === 'duplicate_existing') && cImp.body.details.some((d) => d.status === 'skipped' && d.reason === 'duplicate_in_file') && cImp.body.details.some((d) => d.status === 'error'), JSON.stringify(cImp.body.details));
    const expRes = await fetch(base + '/api/contacts/export', { headers: { Authorization: 'Bearer ' + token } });
    const expText = await expRes.text();
    check('Stage C contacts export is CSV with header + imported phone', expRes.status === 200 && /text\/csv/.test(expRes.headers.get('content-type') || '') && expText.includes('name,phone,labels') && expText.includes('+967700000101'), expText.slice(0, 300));
    const viewerContacts = await apiAs(viewerToken, '/api/contacts');
    check('Stage C viewer cannot list contacts (403, whatsapp family)', viewerContacts.status === 403, JSON.stringify(viewerContacts.body));
    const viewerContactCreate = await apiAs(viewerToken, '/api/contacts', { method: 'POST', body: JSON.stringify({ phone: '+967700000103' }) });
    check('Stage C viewer cannot create contacts (403)', viewerContactCreate.status === 403, JSON.stringify(viewerContactCreate.body));
    const unauthContacts = await api('/api/contacts', { noAuth: true });
    check('Stage C unauthenticated contacts rejected (401)', unauthContacts.status === 401, JSON.stringify(unauthContacts.body));
    const bc = await api('/api/contacts/broadcast', { method: 'POST', body: JSON.stringify({}) });
    check('Stage C no broadcast endpoint (404)', bc.status === 404, JSON.stringify(bc.body));
    const cDel = await api(`/api/contacts/${cStranger.body.id}`, { method: 'DELETE' });
    check('Stage C contact delete', cDel.status === 200 && cDel.body.ok === true, JSON.stringify(cDel.body));
    const cGone = await api(`/api/contacts/${cStranger.body.id}`);
    check('Stage C deleted contact returns 404', cGone.status === 404, JSON.stringify(cGone.body));
    let builtHtml = '';
    try { builtHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'index.html'), 'utf8'); } catch {}
    const waLabels = ['الربط والحسابات', 'الإنبكس', 'القوالب', 'الأتمتة', 'جهات الاتصال', 'الوسائط', 'الإعدادات'];
    check('Stage C frontend build contains all 7 WhatsApp sub-interface labels', waLabels.every((l) => builtHtml.includes(l)), waLabels.filter((l) => !builtHtml.includes(l)).join(','));
    check('Stage C frontend build contains contacts import/export strings', builtHtml.includes('استيراد CSV') && builtHtml.includes('تصدير CSV'), 'missing contacts strings');
    // Stage C test-data cleanup (the harness also removes data.json + uploads on exit).
    for (const cid of [cBuyer.body.id, cSeller.body.id, ...((cImp.body && cImp.body.created_ids) || [])]) { try { await api(`/api/contacts/${cid}`, { method: 'DELETE' }); } catch {} }


    // ---- Unified rebuild: workspace, tags, quick replies, macros, scheduled, reports ----
    const convsAll = await api('/api/conversations');
    const anyConv = convsAll.body[0];
    check('unified test precondition: a conversation exists', !!anyConv, JSON.stringify(convsAll.body.slice(0, 1)));
    const tagsSet = await api(`/api/conversations/${anyConv.id}/tags`, { method: 'POST', body: JSON.stringify({ labels: ['متابعة', 'vip'] }) });
    check('unified conversation tags set', tagsSet.status === 200 && tagsSet.body.labels.includes('متابعة'), JSON.stringify(tagsSet.body));
    const tagsBad = await api(`/api/conversations/${anyConv.id}/tags`, { method: 'POST', body: JSON.stringify({ labels: 'not-an-array' }) });
    check('unified conversation tags reject non-array', tagsBad.status === 400);
    const tagFilter = await api('/api/conversations?tag=' + encodeURIComponent('متابعة'));
    check('unified conversations filter by tag', tagFilter.status === 200 && tagFilter.body.some((c) => c.id === anyConv.id), JSON.stringify(tagFilter.body.map((c) => c.id)));
    const convSearch = await api('/api/conversations?q=' + encodeURIComponent('PS-'));
    check('unified conversations search by contract code', convSearch.status === 200 && convSearch.body.length >= 1, JSON.stringify(convSearch.body.map((c) => c.id)));
    const markerMsg = await api('/api/messages', { method: 'POST', body: JSON.stringify({ conversation_id: anyConv.id, direction: 'out', sender_name: 'operator', body: 'UNIFIED-SEARCH-MARKER-42', is_internal_note: false }) });
    check('unified marker message created', markerMsg.status === 201, JSON.stringify(markerMsg.body));
    const msgSearch = await api('/api/messages?q=UNIFIED-SEARCH-MARKER-42');
    check('unified in-chat/message search finds marker', msgSearch.status === 200 && msgSearch.body.some((m) => m.id === markerMsg.body.id), JSON.stringify(msgSearch.body.map((m) => m.id)));
    const qrCreate = await api('/api/quick-replies', { method: 'POST', body: JSON.stringify({ shortcut: '/welcome', body: 'أهلاً بك، كيف أخدمك؟' }) });
    check('unified quick reply created', qrCreate.status === 201 && qrCreate.body.shortcut === '/welcome', JSON.stringify(qrCreate.body));
    const qrDup = await api('/api/quick-replies', { method: 'POST', body: JSON.stringify({ shortcut: '/welcome', body: 'dup' }) });
    check('unified quick reply duplicate shortcut rejected (409)', qrDup.status === 409);
    const qrBad = await api('/api/quick-replies', { method: 'POST', body: JSON.stringify({ shortcut: 'welcome', body: 'no slash' }) });
    check('unified quick reply shortcut must start with /', qrBad.status === 400);
    const qrList = await api('/api/quick-replies');
    check('unified quick replies list contains new shortcut', qrList.status === 200 && qrList.body.some((q) => q.shortcut === '/welcome'), JSON.stringify(qrList.body));
    const macroMoney = await api('/api/automation/macros', { method: 'POST', body: JSON.stringify({ name: 'bad macro', steps: [{ step_type: 'condition', then: [{ step_type: 'release_money' }] }] }) });
    check('unified macro rejects money step nested in a branch (save-time)', macroMoney.status === 400, JSON.stringify(macroMoney.body));
    const macroOk = await api('/api/automation/macros', { method: 'POST', body: JSON.stringify({ name: 'ماكرو ترحيب', steps: [{ step_type: 'text', body: 'أهلاً بك' }] }) });
    check('unified macro created as one-engine workflow', macroOk.status === 201 && macroOk.body.category === 'macro', JSON.stringify(macroOk.body));
    const macroList = await api('/api/automation/macros');
    check('unified macros list returns only macros', macroList.status === 200 && macroList.body.some((w) => w.id === macroOk.body.id) && macroList.body.every((w) => w.category === 'macro'), JSON.stringify(macroList.body.map((w) => w.id)));
    const macroRun = await api(`/api/automation/macros/${macroOk.body.id}/run`, { method: 'POST', body: JSON.stringify({ conversation_id: anyConv.id }) });
    check('unified macro runs through the one engine', macroRun.status === 200 && macroRun.body.workflow_id === macroOk.body.id, JSON.stringify(macroRun.body));
    const schedWf = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'تذكير مجدول', trigger_type: 'scheduled_reminder', trigger_value: 'contract', steps: [{ step_type: 'text', body: 'تذكير بعقدك' }] }) });
    check('unified scheduled_reminder workflow created', schedWf.status === 201, JSON.stringify(schedWf.body));
    const schedRun = await api('/api/automation/scheduled-run', { method: 'POST', body: JSON.stringify({ contract_id: id }) });
    check('unified scheduled-run runs only contract-linked reminders', schedRun.status === 200 && schedRun.body.contract_id === id && schedRun.body.candidates >= 1 && Array.isArray(schedRun.body.results) && schedRun.body.results.length >= 1, JSON.stringify(schedRun.body));
    const schedNoContract = await api('/api/automation/scheduled-run', { method: 'POST', body: JSON.stringify({}) });
    check('unified scheduled-run without contract rejected (400)', schedNoContract.status === 400);
    const schedMoney = await api('/api/workflows', { method: 'POST', body: JSON.stringify({ name: 'sched bad', trigger_type: 'scheduled_reminder', steps: [{ step_type: 'condition', else: [{ step_type: 'confirm_payment' }] }] }) });
    check('unified scheduled workflow rejects money step in else branch', schedMoney.status === 400);
    const report = await api('/api/reports/summary');
    check('unified reports summary has real numbers only', report.status === 200 && typeof report.body.contracts_total === 'number' && report.body.contracts_total >= 1 && typeof report.body.unread_total === 'number' && report.body.first_response && 'avg_minutes' in report.body.first_response && typeof report.body.templates_meta_approved === 'number', JSON.stringify(report.body));
    const auditCsvRes = await fetch(base + '/api/reports/audit.csv', { headers: { Authorization: 'Bearer ' + token } });
    const auditCsvText = await auditCsvRes.text();
    check('unified audit CSV export has header + rows', auditCsvRes.status === 200 && /text\/csv/.test(auditCsvRes.headers.get('content-type') || '') && auditCsvText.includes('actor,entity') && auditCsvText.length > 100, auditCsvText.slice(0, 200));
    // Media delete must not delete messages that used the file.
    const upBoundary = '----UnifiedDel' + crypto.randomBytes(6).toString('hex');
    const upParts = [Buffer.from(`--${upBoundary}\r\nContent-Disposition: form-data; name="file"; filename="todelete.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from('fakepng'), Buffer.from(`\r\n--${upBoundary}--\r\n`)];
    const upRes = await fetch(base + '/api/whatsapp/upload', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${upBoundary}`, Authorization: 'Bearer ' + token }, body: Buffer.concat(upParts) });
    const upBody = await upRes.json().catch(() => ({}));
    check('unified upload for delete test stored', upRes.status === 201 && upBody.upload && upBody.upload.id, JSON.stringify(upBody));
    const msgsBefore = await api('/api/messages');
    const delUp = await api(`/api/whatsapp/uploads/${upBody.upload.id}`, { method: 'DELETE' });
    check('unified media delete succeeds', delUp.status === 200 && delUp.body.ok === true, JSON.stringify(delUp.body));
    const msgsAfter = await api('/api/messages');
    check('unified media delete never deletes messages', msgsAfter.body.length === msgsBefore.body.length, `${msgsBefore.body.length} vs ${msgsAfter.body.length}`);
    const delAgain = await api(`/api/whatsapp/uploads/${upBody.upload.id}`, { method: 'DELETE' });
    check('unified deleted media returns 404 on second delete', delAgain.status === 404);
    const qrDel = await api(`/api/quick-replies/${qrCreate.body.id}`, { method: 'DELETE' });
    check('unified quick reply deleted', qrDel.status === 200 && qrDel.body.ok === true, JSON.stringify(qrDel.body));
    // Module split: the new backend modules load and enforce the same rules.
    const autoMod = require('./automation.js');
    check('unified backend module: money step rejected recursively', autoMod.hasBannedStep([{ step_type: 'condition', then: [{ step_type: 'refund_money' }] }]) === true && autoMod.hasBannedStep([{ step_type: 'text' }]) === false);
    check('unified backend module: Arabic normalisation + exact-before-contains', autoMod.normalizeArabic('عَقْدٌ جديد') === autoMod.normalizeArabic('عقد جديد') && autoMod.keywordMatchKind('عقد', 'عقد جديد') === 'contains');
    const waMod = require('./whatsapp.js');
    check('unified backend module: 24h window + status ranking', waMod.within24h(new Date().toISOString()) === true && waMod.within24h('2020-01-01T00:00:00.000Z') === false && waMod.newerStatus('sent', 'delivered') === 'delivered' && waMod.newerStatus('read', 'sent') === 'read' && waMod.newerStatus('read', 'failed') === 'failed');
    const ctMod = require('./contracts.js');
    check('unified backend module: 12 states + transition guard', ctMod.STATES.length === 12 && ctMod.canTransition('draft', 'issued') === true && ctMod.canTransition('draft', 'completed') === false);

    mockServer.close();

  } catch (e) { failed++; console.log('FAIL exception', e); }
  console.log(`RESULT passed=${passed} failed=${failed}`);
  server.close(() => {
    try { fs.unlinkSync(path.join(__dirname, 'data.json')); } catch {}
    try { fs.rmSync(path.join(__dirname, '..', 'uploads'), { recursive: true, force: true }); } catch {}
    process.exit(failed ? 1 : 0);
  });
});
