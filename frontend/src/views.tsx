import { useMemo, useState } from 'react';
import { api, local } from './api';
import { Badge, Card, Empty, Field, LocalNote, fmt, stateTone } from './components';
import {
  CHECKLIST, ROLE_AR, ROLES, STATE_AR, TEMPLATE_AR, TRANSITIONS,
  type AuditEntry, type Contract, type Conversation, type Message, type State, type Template, type User, type Workflow,
} from './types';

export interface Bundle {
  contracts: Contract[]; conversations: Conversation[]; messages: Message[];
  tasks: { id: number; contract_id: number; title: string; type: string; status: string; financial_reference?: string }[];
  workflows: Workflow[]; templates: Template[]; users: User[]; audit: AuditEntry[];
  killSwitch: boolean; healthOk: boolean;
}
export function contractById(b: Bundle, id: number) { return b.contracts.find((c) => c.id === id); }

/* ---------------- Dashboard ---------------- */
export function Dashboard({ b, reload }: { b: Bundle; reload: () => void }) {
  const openTasks = b.tasks.filter((t) => (local.taskOverrides()[t.id] || t.status) === 'open').length;
  const unread = b.conversations.reduce((s, c) => s + (c.unread_count || 0), 0);
  const byState = useMemo(() => {
    const m: Record<string, number> = {}; b.contracts.forEach((c) => { m[c.state] = (m[c.state] || 0) + 1; }); return m;
  }, [b.contracts]);
  const latest = [...b.contracts].slice(-5).reverse();
  return <>
    <div className="stats">
      <div className="stat"><b>{b.contracts.length}</b><span>إجمالي العقود</span></div>
      <div className="stat"><b>{b.conversations.length}</b><span>محادثات (مشتري/بائع)</span></div>
      <div className="stat"><b>{unread}</b><span>رسائل غير مقروءة</span></div>
      <div className="stat"><b>{openTasks}</b><span>مهام مفتوحة</span></div>
      <div className="stat"><b>{b.templates.filter((t) => t.approval_status === 'approved').length} / {b.templates.length}</b><span>قوالب معتمدة</span></div>
      <div className="stat danger"><b>{b.killSwitch ? 'مُفعّل' : 'متوقف'}</b><span>مفتاح إيقاف الأتمتة</span></div>
    </div>
    <Card title="حالة الخادم" sub="لا تأكيد مالي بدون مرجع مؤسسة، ولا خطوة آلية تلمس المال أبداً." actions={<button className="btn ghost" onClick={reload}>تحديث</button>}>
      <p>الاتصال بالخادم: {b.healthOk ? <Badge tone="ok">متصل</Badge> : <Badge tone="bad">غير متصل</Badge>} — مفتاح الإيقاف: {b.killSwitch ? <Badge tone="bad">الأتمتة موقوفة</Badge> : <Badge tone="ok">الأتمتة تعمل</Badge>}</p>
      <div className="chips">{Object.entries(byState).map(([s, n]) => <span key={s} className="chip">{STATE_AR[s as State] || s}: {n}</span>)}</div>
    </Card>
    <Card title="أحدث العقود">
      {latest.length === 0 ? <Empty text="لا عقود بعد — أنشئ أول عقد من صفحة العقود." /> :
        <table><thead><tr><th>الكود</th><th>المنتج</th><th>المبلغ</th><th>الحالة</th><th>أُنشئ</th></tr></thead>
        <tbody>{latest.map((c) => <tr key={c.id}><td><b>{c.code}</b></td><td>{c.product_description}</td><td>{c.amount} {c.currency}</td><td><Badge tone={stateTone(c.state)}>{STATE_AR[c.state]}</Badge></td><td>{fmt(c.created_at)}</td></tr>)}</tbody></table>}
    </Card>
  </>;
}

/* ---------------- Contracts ---------------- */
export function Contracts({ b, reload }: { b: Bundle; reload: () => void }) {
  const [form, setForm] = useState({ buyer_phone: '', seller_phone: '', product_description: '', amount: '', currency: 'SAR', delivery_point: '' });
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('all');
  const [selId, setSelId] = useState<number | null>(null);
  const [fiRef, setFiRef] = useState('');
  const [actor, setActor] = useState('operator');
  const [amend, setAmend] = useState({ product_description: '', amount: '', delivery_point: '' });
  const sel = b.contracts.find((c) => c.id === selId) || null;
  const list = b.contracts.filter((c) => filter === 'all' || c.state === filter);
  const drafts = local.amendDrafts(); const atts = local.attachments();

  async function create(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    try {
      const c = await api.createContract({ buyer_phone: form.buyer_phone, seller_phone: form.seller_phone, product_description: form.product_description, amount: Number(form.amount), currency: form.currency, delivery_point: form.delivery_point || undefined });
      setMsg(`تم إنشاء العقد ${c.code} بحالة مسودة.`); setForm({ buyer_phone: '', seller_phone: '', product_description: '', amount: '', currency: 'SAR', delivery_point: '' }); reload();
    } catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  async function go(to: State) {
    if (!sel) return;
    if (to === 'payment_confirmed' && !fiRef.trim()) { setMsg('تأكيد الدفع يتطلب مرجع المؤسسة المالية — أدخل المرجع أولاً.'); return; }
    try {
      await api.transition(sel.id, { to, financial_reference: to === 'payment_confirmed' ? fiRef.trim() : undefined, actor });
      setMsg(`تم انتقال ${sel.code} إلى ${STATE_AR[to]}.`); setFiRef(''); reload();
    } catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  function openAmend(c: Contract) {
    setSelId(c.id);
    const d = drafts[c.id]; setAmend(d ? { product_description: d.product_description, amount: d.amount, delivery_point: d.delivery_point } : { product_description: c.product_description, amount: String(c.amount), delivery_point: c.delivery_point || '' });
  }
  return <>
    <Card title="عقد جديد" sub="الحقول المطلوبة في الخادم: رقم المشتري، رقم البائع، وصف المنتج، المبلغ.">
      <form onSubmit={create} className="grid2">
        <Field label="رقم المشتري"><input required value={form.buyer_phone} onChange={(e) => setForm({ ...form, buyer_phone: e.target.value })} placeholder="+967…" /></Field>
        <Field label="رقم البائع"><input required value={form.seller_phone} onChange={(e) => setForm({ ...form, seller_phone: e.target.value })} placeholder="+967…" /></Field>
        <Field label="وصف المنتج"><input required value={form.product_description} onChange={(e) => setForm({ ...form, product_description: e.target.value })} /></Field>
        <Field label="المبلغ"><input required type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
        <Field label="العملة"><select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option>SAR</option><option>YER</option><option>USD</option></select></Field>
        <Field label="نقطة التسليم (اختياري)"><input value={form.delivery_point} onChange={(e) => setForm({ ...form, delivery_point: e.target.value })} /></Field>
        <button className="btn" type="submit">إنشاء العقد</button>
      </form>
      {msg && <p className="msg">{msg}</p>}
    </Card>

    <Card title="العقود" actions={<select value={filter} onChange={(e) => setFilter(e.target.value)} className="inline-select"><option value="all">كل الحالات</option>{Object.entries(STATE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}>
      {list.length === 0 ? <Empty text="لا عقود مطابقة." /> :
        <table><thead><tr><th>الكود</th><th>المشتري / البائع</th><th>المنتج</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead>
        <tbody>{list.map((c) => <tr key={c.id} className={selId === c.id ? 'row-sel' : ''}>
          <td><b>{c.code}</b></td><td><div className="small">{c.buyer_phone}</div><div className="small">{c.seller_phone}</div></td>
          <td>{c.product_description}</td><td>{c.amount} {c.currency}</td>
          <td><Badge tone={stateTone(c.state)}>{STATE_AR[c.state]}</Badge></td>
          <td><button className="btn small" onClick={() => { setSelId(c.id); setMsg(''); }}>تفاصيل</button> <button className="btn small ghost" onClick={() => openAmend(c)}>تعديل / إصدارات</button></td>
        </tr>)}</tbody></table>}
    </Card>

    {sel && <Card title={`تفاصيل ${sel.code}`} sub={`بصمة البنود (SHA-256): ${sel.clause_fingerprint}`}>
      <div className="grid2">
        <p><b>المنتج:</b> {sel.product_description}</p><p><b>المبلغ:</b> {sel.amount} {sel.currency}</p>
        <p><b>المشتري:</b> {sel.buyer_phone}</p><p><b>البائع:</b> {sel.seller_phone}</p>
        <p><b>نقطة التسليم:</b> {sel.delivery_point || '—'}</p><p><b>أُنشئ:</b> {fmt(sel.created_at)}</p>
        {sel.version !== undefined && <p><b>إصدار العقد (من الخادم):</b> v{sel.version}</p>}
      </div>
      <h3>الانتقالات المتاحة من «{STATE_AR[sel.state]}»</h3>
      {TRANSITIONS[sel.state].length === 0 ? <p className="muted">حالة نهائية — لا انتقالات متاحة.</p> : <>
        <div className="btn-row">
          {TRANSITIONS[sel.state].map((to) => <button key={to} className="btn" onClick={() => go(to)}>← {STATE_AR[to]}</button>)}
        </div>
        <div className="grid2">
          <Field label="مرجع المؤسسة المالية (إلزامي فقط عند تأكيد الدفع)"><input value={fiRef} onChange={(e) => setFiRef(e.target.value)} placeholder="مثال: FI-2026-001" /></Field>
          <Field label="اسم المنفّذ (يُسجَّل في التدقيق)"><input value={actor} onChange={(e) => setActor(e.target.value)} /></Field>
        </div>
        <p className="muted">تنبيه: لا يوجد زر إفراج أو استرداد أو تأكيد دفع هنا — تأكيد الدفع يقبل فقط مرجعاً صادراً من المؤسسة المالية الخارجية، وأي تنفيذ مالي لاحق يتم يدوياً خارج النظام.</p>
      </>}
      <h3>سجل إصدارات العقد (من سجل التدقيق)</h3>
      {b.audit.filter((a) => a.entity === 'contract' && a.entity_id === sel.id).length === 0 ? <Empty text="لا أحداث تدقيق لهذا العقد بعد." /> :
        <ul className="timeline">{b.audit.filter((a) => a.entity === 'contract' && a.entity_id === sel.id).map((a) => <li key={a.id}>{fmt(a.created_at)} — {a.actor}: {a.action} {a.details?.to ? `← ${STATE_AR[a.details.to as State] || String(a.details.to)}` : ''} {a.details?.financial_reference ? `(مرجع: ${String(a.details.financial_reference)})` : ''}</li>)}</ul>}

      <h3>مسودة تعديل (محلية)</h3>
      <LocalNote>الخادم الحالي لا يوفّر endpoint لتعديل عقد قائم؛ هذه المسودة تُحفظ في المتصفح فقط، ويمكن إنشاء عقد جديد منها بالزر أدناه بعد مراجعة بشرية.</LocalNote>
      <div className="grid2">
        <Field label="وصف المنتج المعدّل"><input value={amend.product_description} onChange={(e) => setAmend({ ...amend, product_description: e.target.value })} /></Field>
        <Field label="المبلغ المعدّل"><input type="number" value={amend.amount} onChange={(e) => setAmend({ ...amend, amount: e.target.value })} /></Field>
        <Field label="نقطة التسليم المعدّلة"><input value={amend.delivery_point} onChange={(e) => setAmend({ ...amend, delivery_point: e.target.value })} /></Field>
      </div>
      <div className="btn-row">
        <button className="btn ghost" onClick={() => { local.saveAmendDraft(sel.id, amend); setMsg('تم حفظ مسودة التعديل محلياً.'); }}>حفظ المسودة محلياً</button>
        <button className="btn" onClick={async () => { try { const c = await api.createContract({ buyer_phone: sel.buyer_phone, seller_phone: sel.seller_phone, product_description: amend.product_description || sel.product_description, amount: Number(amend.amount) || sel.amount, currency: sel.currency, delivery_point: amend.delivery_point || undefined }); setMsg(`تم إنشاء عقد جديد ${c.code} من المسودة المعدّلة (العقد الأصلي ${sel.code} لم يتغير).`); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>إنشاء عقد جديد من المسودة</button>
      </div>
      {drafts[sel.id] && <p className="muted">آخر حفظ محلي: {fmt(drafts[sel.id].saved_at)}</p>}

      <h3>المرفقات (بيانات وصفية فقط)</h3>
      <LocalNote>لا يوجد endpoint رفع ملفات في الخادم الحالي؛ تُحفظ بيانات الملف الوصفية في المتصفح فقط ولا يُرفع محتوى الملف إلى أي خادم.</LocalNote>
      <input type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) { local.addAttachment(sel.id, { name: f.name, size: f.size, type: f.type || 'غير معروف' }); setMsg(`تم تسجيل بيانات الملف «${f.name}» محلياً.`); } }} />
      {(atts[sel.id] || []).length === 0 ? <Empty text="لا مرفقات مسجلة لهذا العقد." /> :
        <table><thead><tr><th>اسم الملف</th><th>النوع</th><th>الحجم</th><th>أُضيف</th></tr></thead>
        <tbody>{atts[sel.id].map((a, i) => <tr key={i}><td>{a.name}</td><td>{a.type}</td><td>{(a.size / 1024).toFixed(1)} KB</td><td>{fmt(a.added_at)}</td></tr>)}</tbody></table>}
      {msg && <p className="msg">{msg}</p>}
    </Card>}
  </>;
}

/* ---------------- Inbox ---------------- */
export function Inbox({ b, reload }: { b: Bundle; reload: () => void }) {
  const [party, setParty] = useState('all');
  const [status, setStatus] = useState('all');
  const [selId, setSelId] = useState<number | null>(null);
  const [body, setBody] = useState('');
  const [template, setTemplate] = useState('');
  const [internal, setInternal] = useState(false);
  const [sender, setSender] = useState('operator');
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0);
  const assignees = local.assignees();
  const convs = b.conversations.filter((c) => (party === 'all' || c.party === party) && (status === 'all' || c.status === status));
  const sel = b.conversations.find((c) => c.id === selId) || null;
  const thread = sel ? b.messages.filter((m) => m.conversation_id === sel.id).sort((x, y) => x.id - y.id) : [];
  const unreadTotal = b.conversations.reduce((s, c) => s + (c.unread_count || 0), 0);
  return <div className="inbox-layout">
    <Card title="المحادثات" sub={`إجمالي غير المقروء: ${unreadTotal} — محادثة مستقلة لكل طرف في كل عقد.`} actions={<button className="btn ghost small" onClick={reload}>تحديث</button>}>
      <div className="btn-row">
        <select className="inline-select" value={party} onChange={(e) => setParty(e.target.value)}><option value="all">كل الأطراف</option><option value="buyer">المشتري</option><option value="seller">البائع</option></select>
        <select className="inline-select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">كل الحالات</option>{[...new Set(b.conversations.map((c) => c.status))].map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </div>
      {convs.length === 0 ? <Empty text="لا محادثات مطابقة. تُنشأ محادثتا مشتري وبائع تلقائياً عند إنشاء كل عقد." /> :
        <ul className="conv-list">{convs.map((c) => {
          const contract = contractById(b, c.contract_id);
          return <li key={c.id} className={selId === c.id ? 'sel' : ''} onClick={() => setSelId(c.id)}>
            <div><b>{contract?.code || `عقد ${c.contract_id}`}</b> — {c.party === 'buyer' ? 'المشتري' : c.party === 'seller' ? 'البائع' : c.party} <span className="muted">({c.status})</span></div>
            <div className="small">{contract?.product_description || ''} {c.assigned_to ? `• مكلَّف به (من الخادم): ${c.assigned_to}` : assignees[c.id] ? `• مكلَّف به (محلي): ${assignees[c.id]}` : ''}</div>
            {(c.unread_count || 0) > 0 && <span className="unread">{c.unread_count} غير مقروءة</span>}
          </li>;
        })}</ul>}
      <LocalNote>الخادم الحالي لا يوفّر endpoint لتغيير حالة المحادثة أو تصفير عدّاد غير المقروء؛ العدّادات المعروضة هي القيم المُعادة من الخادم كما هي.</LocalNote>
    </Card>
    <Card title={sel ? `محادثة ${sel.party === 'buyer' ? 'المشتري' : 'البائع'} — ${contractById(b, sel.contract_id)?.code || ''}` : 'اختر محادثة'}>
      {!sel ? <Empty text="اختر محادثة من القائمة لعرض رسائلها والرد عليها." /> : <>
        <Field label="المكلَّف بالمحادثة (محلي — إضافة عرض فقط)"><select value={assignees[sel.id] || ''} onChange={(e) => { local.setAssignee(sel.id, e.target.value); setTick(tick + 1); }}>
          <option value="">غير مكلَّف محلياً</option>{b.users.map((u) => <option key={u.id} value={u.full_name}>{u.full_name} ({ROLE_AR[u.role]})</option>)}
        </select></Field>
        {sel.assigned_to && <p className="muted">المكلَّف من الخادم: {sel.assigned_to}</p>}
        <div className="thread">
          {thread.length === 0 ? <Empty text="لا رسائل في هذه المحادثة بعد." /> : thread.map((m) => <div key={m.id} className={`bubble ${m.direction === 'in' ? 'in' : 'out'} ${m.is_internal_note ? 'internal' : ''}`}>
            <div className="bubble-head">{m.is_internal_note ? '📝 ملاحظة داخلية فقط — لا تُرسل للعميل' : m.direction === 'in' ? 'وارد' : 'صادر'} • {m.sender_name || '—'} {m.template_name ? `• قالب: ${m.template_name}` : ''}</div>
            <div>{m.body}</div><div className="small">{fmt(m.created_at)}</div>
          </div>)}
        </div>
        <div className="grid2">
          <Field label="المرسل"><input value={sender} onChange={(e) => setSender(e.target.value)} /></Field>
          <Field label="قالب واتساب (اختياري)"><select value={template} onChange={(e) => setTemplate(e.target.value)}><option value="">رد حر بدون قالب</option>{b.templates.map((t) => <option key={t.id} value={t.name}>{TEMPLATE_AR[t.name] || t.name} ({t.approval_status})</option>)}</select></Field>
        </div>
        <Field label="نص الرد"><textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={template ? 'نص إضافي مع القالب (اختياري)' : 'اكتب الرد هنا…'} /></Field>
        <label className="check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> ملاحظة داخلية فقط (is_internal_note) — تُحفظ في السجل ولا تُعامل كرسالة للعميل</label>
        <button className="btn" onClick={async () => {
          if (!body.trim() && !template) { setMsg('اكتب نصاً أو اختر قالباً.'); return; }
          try {
            await api.sendMessage({ conversation_id: sel.id, direction: 'out', sender_name: sender || 'operator', body: body.trim() || `قالب: ${template}`, template_name: template || null, is_internal_note: internal });
            setMsg(internal ? 'تم حفظ الملاحظة الداخلية.' : 'تم إرسال الرد.'); setBody(''); setTemplate(''); reload();
          } catch (err) { setMsg('خطأ: ' + (err as Error).message); }
        }}>{internal ? 'حفظ ملاحظة داخلية' : 'إرسال الرد'}</button>
        {msg && <p className="msg">{msg}</p>}
      </>}
    </Card>
  </div>;
}

/* ---------------- Tasks ---------------- */
export function Tasks({ b, reload }: { b: Bundle; reload: () => void }) {
  const [filter, setFilter] = useState('all');
  const [tick, setTick] = useState(0);
  const overrides = local.taskOverrides();
  // الخادم يرسل أحياناً status=completed وأحياناً done للمنجز؛ نعاملهما كمنجز.
  const norm = (s: string) => s === 'completed' ? 'done' : s;
  const eff = (t: { status: string; id: number }) => overrides[t.id] || norm(t.status);
  const list = b.tasks.filter((t) => filter === 'all' || eff(t) === filter);
  return <Card title="مهام التشغيل" sub="المهام تُنشأ تلقائياً من الخادم عند إنشاء العقد وتغيّر حالته." actions={<><select className="inline-select" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">كل الحالات</option><option value="open">مفتوحة</option><option value="done">منجزة</option><option value="cancelled">ملغاة</option></select> <button className="btn ghost small" onClick={reload}>تحديث</button></>}>
    <LocalNote>الإكمال والإلغاء يتمّان عبر الخادم نفسه (POST /api/tasks/:id/complete و /cancel) ويُسجَّلان في سجل التدقيق.</LocalNote>
    {list.length === 0 ? <Empty text="لا مهام مطابقة." /> :
      <table><thead><tr><th>المهمة</th><th>العقد</th><th>النوع</th><th>الحالة</th><th>مرجع المؤسسة</th><th></th></tr></thead>
      <tbody>{list.map((t) => <tr key={t.id}><td>{t.title}</td><td>{contractById(b, t.contract_id)?.code || t.contract_id}</td><td>{t.type}</td>
        <td><Badge tone={eff(t) === 'done' ? 'ok' : eff(t) === 'cancelled' ? 'bad' : 'warn'}>{eff(t) === 'done' ? 'منجزة' : eff(t) === 'cancelled' ? 'ملغاة' : 'مفتوحة'}{overrides[t.id] ? ' (محلي)' : ''}</Badge></td>
        <td>{t.financial_reference || '—'}</td>
        <td>{eff(t) === 'open' && <><button className="btn small" onClick={async () => { try { await api.taskAction(t.id, 'complete'); reload(); } catch (err) { alert('خطأ: ' + (err as Error).message); } }}>إكمال</button> <button className="btn small ghost" onClick={async () => { try { await api.taskAction(t.id, 'cancel'); reload(); } catch (err) { alert('خطأ: ' + (err as Error).message); } }}>إلغاء</button></>}</td>
      </tr>)}</tbody></table>}
  </Card>;
}

/* ---------------- Templates ---------------- */
export function Templates({ b }: { b: Bundle }) {
  const tone = (s: string) => s === 'approved' ? 'ok' as const : s === 'rejected' ? 'bad' as const : 'warn' as const;
  const ar = (s: string) => s === 'approved' ? 'معتمد' : s === 'rejected' ? 'مرفوض' : 'بانتظار الاعتماد';
  return <Card title="قوالب واتساب Utility" sub="10 قوالب من الخادم — حالة الاعتماد تُعرض كما يرسلها الخادم؛ لا يوجد endpoint لتغييرها من هنا (الاعتماد يتم في Meta).">
    {b.templates.length === 0 ? <Empty text="لا قوالب — تُزرع القوالب العشرة تلقائياً عند أول تشغيل للخادم." /> :
      <table><thead><tr><th>اسم القالب</th><th>الوصف</th><th>اللغة</th><th>الفئة</th><th>حالة الاعتماد</th></tr></thead>
      <tbody>{b.templates.map((t) => <tr key={t.id}><td><code>{t.name}</code></td><td>{TEMPLATE_AR[t.name] || '—'}</td><td>{t.language}</td><td>{t.category}</td><td><Badge tone={tone(t.approval_status)}>{ar(t.approval_status)}</Badge></td></tr>)}</tbody></table>}
    <p className="muted">ملاحظة: الخادم يرسل اسم القالب ولغته وفئته وحالة اعتماده فقط، ولا يرسل نص القالب — لذا لا يُعرض نص هنا ولا يُختلق نص.</p>
  </Card>;
}

/* ---------------- Automation ---------------- */
export function Automation({ b, reload }: { b: Bundle; reload: () => void }) {
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);
  async function toggle(off: boolean) {
    try { await api.killSwitchSet(off); setMsg(off ? 'تم تفعيل مفتاح الإيقاف — الأتمتة موقوفة الآن.' : 'تم إيقاف مفتاح الإيقاف — الأتمتة تعمل.'); setConfirm(false); reload(); }
    catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  return <>
    <Card title="مفتاح إيقاف الأتمتة (Kill Switch)" sub="يعمل فعلاً عبر الخادم: POST /api/automation/kill-switch — ويُسجَّل كل تبديل في سجل التدقيق.">
      <p>الحالة الحالية: {b.killSwitch ? <Badge tone="bad">مُفعّل — الأتمتة موقوفة</Badge> : <Badge tone="ok">متوقف — الأتمتة تعمل</Badge>}</p>
      {!confirm ? <button className={`btn ${b.killSwitch ? '' : 'danger'}`} onClick={() => setConfirm(true)}>{b.killSwitch ? 'إعادة تشغيل الأتمتة' : 'إيقاف الأتمتة فوراً'}</button> :
        <div className="btn-row"><span>تأكيد {b.killSwitch ? 'إعادة التشغيل' : 'الإيقاف الفوري'}؟</span>
          <button className="btn danger" onClick={() => toggle(!b.killSwitch)}>تأكيد</button>
          <button className="btn ghost" onClick={() => setConfirm(false)}>إلغاء</button></div>}
      {msg && <p className="msg">{msg}</p>}
    </Card>
    <Card title="قواعد الأتمتة" sub="الخادم الحالي لا يوفّر endpoint لقائمة القواعد (GET /api/rules غير موجود) — لذا لا تُعرض قواعد وهمية. القواعد التالية هي ضوابط النظام المؤكدة في الخادم نفسه.">
      <ul>
        <li>خطوات المال مرفوضة في التدفقات: release_money و refund_money و confirm_payment — يرفضها الخادم بخطأ 400.</li>
        <li>لا انتقال إلى payment_confirmed بدون financial_reference من المؤسسة المالية الخارجية.</li>
        <li>لا إفراج ولا استرداد ولا حسم نزاع آلياً أبداً — كلها يدوية خارج النظام.</li>
        <li>سجل التدقيق إلحاقي فقط: الخادم لا يعدّله ولا يحذف منه أبداً.</li>
        <li>Webhook واتساب يتحقق بتوقيع HMAC-SHA256 عند ضبط WHATSAPP_APP_SECRET.</li>
      </ul>
      <p className="muted">قائمة قواعد أتمتة قابلة للإدارة (إنشاء/تعديل/تعطيل) تتطلب endpoint قواعد في الخادم — غير موجود حالياً. مفتاح الإيقاف أعلاه هو عنصر التحكم الفعلي المتاح.</p>
    </Card>
  </>;
}

/* ---------------- Users ---------------- */
export function Users({ b, reload }: { b: Bundle; reload: () => void }) {
  const [form, setForm] = useState({ full_name: '', email: '', role: 'ops_employee' });
  const [msg, setMsg] = useState('');
  return <>
    <Card title="مستخدم جديد" sub="الأدوار الخمسة المعتمدة في الخادم — أي دور خارجها يرفضه الخادم.">
      <form className="grid2" onSubmit={async (e) => { e.preventDefault(); try { const u = await api.createUser(form); setMsg(`تم إنشاء المستخدم ${u.full_name} بدور ${ROLE_AR[u.role]}.`); setForm({ full_name: '', email: '', role: 'ops_employee' }); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
        <Field label="الاسم الكامل"><input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
        <Field label="البريد الإلكتروني"><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="الدور"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_AR[r]}</option>)}</select></Field>
        <button className="btn" type="submit">إضافة المستخدم</button>
      </form>
      {msg && <p className="msg">{msg}</p>}
    </Card>
    <Card title="المستخدمون">
      {b.users.length === 0 ? <Empty text="لا مستخدمين بعد." /> :
        <table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>نشط</th></tr></thead>
        <tbody>{b.users.map((u) => <tr key={u.id}><td>{u.full_name}</td><td>{u.email}</td><td>{ROLE_AR[u.role]}</td><td>{u.is_active ? 'نعم' : 'لا'}</td></tr>)}</tbody></table>}
    </Card>
  </>;
}

/* ---------------- Checklist ---------------- */
export function Checklist() {
  const [tick, setTick] = useState(0);
  const done = local.checklist();
  const n = CHECKLIST.filter((_, i) => done[i]).length;
  return <Card title="قائمة الربط — 10 خطوات" sub={`مكتمل: ${n} من 10 — التقدم يُحفظ في المتصفح فقط؛ بيانات الربط نفسها تُدخل في متغيرات بيئة الخادم أبداً هنا.`}>
    <ol className="checklist">{CHECKLIST.map((s, i) => <li key={i}>
      <label className="check"><input type="checkbox" checked={!!done[i]} onChange={(e) => { local.setChecklist(i, e.target.checked); setTick(tick + 1); }} /><b>{i + 1}. {s.title}</b></label>
      <p className="muted">{s.detail}</p></li>)}
    </ol>
    <div className="progress"><div style={{ width: `${n * 10}%` }} /></div>
  </Card>;
}

/* ---------------- Audit ---------------- */
export function Audit({ b }: { b: Bundle }) {
  const [entity, setEntity] = useState('all');
  const [q, setQ] = useState('');
  const list = [...b.audit].reverse().filter((a) => (entity === 'all' || a.entity === entity) && (q === '' || a.actor.includes(q) || a.action.includes(q) || String(a.entity_id).includes(q)));
  return <Card title="سجل التدقيق (قراءة فقط)" sub="سجل إلحاقي — لا توجد أزرار تعديل أو حذف هنا أبداً، والخادم نفسه لا يعدّله ولا يحذف منه." actions={<><select className="inline-select" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="all">كل الكيانات</option>{[...new Set(b.audit.map((a) => a.entity))].map((e2) => <option key={e2} value={e2}>{e2}</option>)}</select> <input className="inline-input" placeholder="بحث بالمنفّذ أو الإجراء أو الرقم" value={q} onChange={(e) => setQ(e.target.value)} /></>}>
    {list.length === 0 ? <Empty text="لا سجلات تدقيق بعد." /> :
      <table><thead><tr><th>الوقت</th><th>المنفّذ</th><th>الكيان</th><th>الرقم</th><th>الإجراء</th><th>التفاصيل</th></tr></thead>
      <tbody>{list.map((a) => <tr key={a.id}><td className="small">{fmt(a.created_at)}</td><td>{a.actor}</td><td>{a.entity}</td><td>{a.entity_id}</td><td>{a.action}</td><td className="small">{JSON.stringify(a.details || {})}</td></tr>)}</tbody></table>}
  </Card>;
}
