// Pilot System — acceptance tests, run twice for the "success twice" rule.
// Usage: node src/test.js  (starts the server on a test port, runs, exits)
// Original 10 checks are kept verbatim in behaviour; new checks cover the
// extended backend (amend, owner guard, workflow copy, template approval,
// task complete, plus inbox, checklist, rules/kill-switch, files, reorder).
const { spawn } = require('child_process');
const PORT = 3456;
process.env.PORT = String(PORT);
delete process.env.WHATSAPP_APP_SECRET;
const fs = require('fs');
const path = require('path');
// Fresh data for a repeatable test run
try { fs.unlinkSync(path.join(__dirname, 'data.json')); } catch {}
const server = require('./server.js');
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, cond, extra = '') { if (cond) { passed++; console.log('PASS', name); } else { failed++; console.log('FAIL', name, extra); } }
async function api(p, o) { const r = await fetch(base + p, { headers: { 'Content-Type': 'application/json' }, ...(o || {}) }); let body = {}; try { body = await r.json(); } catch {} return { status: r.status, body }; }
server.listen(PORT, async () => {
  try {
    const h = await api('/health'); check('health', h.status === 200 && h.body.ok);
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
    const owner1 = await api('/api/users', { method: 'POST', body: JSON.stringify({ full_name: 'المالك الأول', email: 'owner1@test.local', role: 'owner' }) });
    check('owner user created', owner1.status === 201 && owner1.body.role === 'owner');
    const badRole = await api('/api/users', { method: 'POST', body: JSON.stringify({ full_name: 'X', email: 'x@test.local', role: 'superadmin' }) });
    check('invalid role rejected (5 roles only)', badRole.status === 400);
    const disableOnly = await api(`/api/users/${owner1.body.id}/disable`, { method: 'POST', body: JSON.stringify({}) });
    check('owner-protection: disable only active owner refused', disableOnly.status === 400, JSON.stringify(disableOnly.body));
    const deleteOnly = await api(`/api/users/${owner1.body.id}`, { method: 'DELETE' });
    check('owner-protection: delete only active owner refused', deleteOnly.status === 400, JSON.stringify(deleteOnly.body));
    const owner2 = await api('/api/users', { method: 'POST', body: JSON.stringify({ full_name: 'المالك الثاني', email: 'owner2@test.local', role: 'owner' }) });
    const disableOk = await api(`/api/users/${owner1.body.id}/disable`, { method: 'POST', body: JSON.stringify({}) });
    check('disable succeeds once a second active owner exists', disableOk.status === 200 && disableOk.body.is_active === false, JSON.stringify(disableOk.body));

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
  } catch (e) { failed++; console.log('FAIL exception', e); }
  console.log(`RESULT passed=${passed} failed=${failed}`);
  server.close(() => process.exit(failed ? 1 : 0));
});
