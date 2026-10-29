import { useEffect, useMemo, useState } from 'react';
import { api, local, type AutomationRule, type WhatsAppStatus } from './api';
import { Badge, Card, Empty, Field, LocalNote, fmt, stateTone } from './components';
import { IconChat, IconCheckSquare, IconDoc, IconInbox, IconPower, IconTemplate } from './icons';
import {
  ACTION_AR, CHECKLIST, DEPARTMENTS, ROLE_AR, ROLES, SECTIONS_AR, SECTIONS_LIST, STATE_AR, TEMPLATE_AR, TRANSITIONS,
  type AuditEntry, type Contract, type Conversation, type MeUser, type Message, type State, type Template, type User, type Workflow,
} from './types';

export function NoPermission() {
  return <Card title="لا صلاحية">
    <p>لا صلاحية لديك لعرض هذا القسم — تواصل مع المسؤول إذا كنت تحتاج الوصول إليه.</p>
  </Card>;
}
export function hasSection(me: MeUser | null, section: string) {
  return !!me && (me.sections || []).includes(section);
}
export function hasAction(me: MeUser | null, section: string, action: string) {
  if (!me) return false;
  if (me.is_primary_admin || me.role === 'owner') return true;
  return (me.actions?.[section] || []).includes(action);
}

export interface Bundle {
  contracts: Contract[]; conversations: Conversation[]; messages: Message[];
  tasks: { id: number; contract_id: number; title: string; type: string; status: string; financial_reference?: string }[];
  workflows: Workflow[]; templates: Template[]; users: User[]; audit: AuditEntry[];
  killSwitch: boolean; healthOk: boolean;
}
export function contractById(b: Bundle, id: number) { return b.contracts.find((c) => c.id === id); }

/* ---------------- Dashboard ---------------- */
export function Dashboard({ b, reload, onOpenDesigner }: { b: Bundle; reload: () => void; onOpenDesigner?: () => void }) {
  const openTasks = b.tasks.filter((t) => (local.taskOverrides()[t.id] || t.status) === 'open').length;
  const unread = b.conversations.reduce((s, c) => s + (c.unread_count || 0), 0);
  const byState = useMemo(() => {
    const m: Record<string, number> = {}; b.contracts.forEach((c) => { m[c.state] = (m[c.state] || 0) + 1; }); return m;
  }, [b.contracts]);
  const latest = [...b.contracts].slice(-5).reverse();
  // Every number below comes from the backend API bundle (b.*) only.
  // When the system starts empty they read 0 — no demo number is ever shown.
  // 0 is rendered with the same large type, spacing and icon treatment.
  const approvedTemplates = b.templates.filter((t) => t.approval_status === 'approved').length;
  return <>
    <div className="page-head">
      <h1>لوحة القيادة</h1>
      <div className="btn-row">
        {onOpenDesigner && <button className="btn" onClick={onOpenDesigner}>فتح مصمّم الورك فلو</button>}
        <span className={`pill ${b.healthOk ? 'ok' : 'danger'}`}><span className="dot" />{b.healthOk ? 'متصل' : 'غير متصل'}</span>
      </div>
    </div>
    <div className="stats">
      <div className="stat"><div className="stat-top"><b>{b.contracts.length}</b><span className="stat-icon-box"><IconDoc /></span></div><span className="stat-label">إجمالي العقود</span><span className="stat-sub">جميع الحالات — من الخادم</span></div>
      <div className="stat"><div className="stat-top"><b>{b.conversations.length}</b><span className="stat-icon-box"><IconChat /></span></div><span className="stat-label">محادثات</span><span className="stat-sub">محادثة مستقلة لكل طرف في كل عقد</span></div>
      <div className="stat"><div className="stat-top"><b>{unread}</b><span className="stat-icon-box"><IconInbox /></span></div><span className="stat-label">رسائل غير مقروءة</span><span className={`stat-sub ${unread > 0 ? 'attention' : ''}`}>{unread === 0 ? 'لا رسائل بانتظار القراءة' : 'بانتظار القراءة والرد'}</span></div>
      <div className="stat"><div className="stat-top"><b>{openTasks}</b><span className="stat-icon-box"><IconCheckSquare /></span></div><span className="stat-label">مهام مفتوحة</span><span className={`stat-sub ${openTasks > 0 ? 'attention' : ''}`}>مهام تشغيل لم تُنجز بعد</span></div>
      <div className="stat"><div className="stat-top"><b>{approvedTemplates} / {b.templates.length}</b><span className="stat-icon-box"><IconTemplate /></span></div><span className="stat-label">قوالب معتمدة</span><span className="stat-sub">من قوالب واتساب في الخادم</span></div>
      <div className="stat danger"><div className="stat-top"><b>{b.killSwitch ? 'مُفعّل' : 'متوقف'}</b><span className="stat-icon-box"><IconPower /></span></div><span className="stat-label">مفتاح إيقاف الأتمتة</span><span className="stat-sub">{b.killSwitch ? 'الأتمتة موقوفة الآن' : 'الأتمتة تعمل'}</span></div>
    </div>
    <Card title="حالة الخادم" sub="لا تأكيد مالي بدون مرجع مؤسسة، ولا خطوة آلية تلمس المال أبداً." actions={<button className="btn ghost" onClick={reload}>تحديث</button>}>
      <p>الاتصال بالخادم: {b.healthOk ? <Badge tone="ok">متصل</Badge> : <Badge tone="bad">غير متصل</Badge>} — مفتاح الإيقاف: {b.killSwitch ? <Badge tone="bad">الأتمتة موقوفة</Badge> : <Badge tone="ok">الأتمتة تعمل</Badge>}</p>
      <div className="chips">{Object.entries(byState).map(([s, n]) => <span key={s} className="chip">{STATE_AR[s as State] || s}: {n}</span>)}</div>
    </Card>
    <Card title="عبء الفريق — محادثات مكلَّف بها">
      {(() => {
        const byAssignee: Record<string, number> = {};
        b.conversations.forEach((c) => { if (c.assigned_to) byAssignee[c.assigned_to] = (byAssignee[c.assigned_to] || 0) + 1; });
        const entries = Object.entries(byAssignee);
        return entries.length === 0 ? <Empty text="لا محادثات مكلَّف بها بعد — التعيين يتم من صفحة الإنبكس." /> :
          <div className="chips">{entries.map(([name, n]) => <span key={name} className="chip">{name}: {n} محادثة</span>)}</div>;
      })()}
      <p className="muted">محادثات مفتوحة: {b.conversations.filter((c) => c.status === 'open' || c.status === 'new').length} — مهام مفتوحة: {openTasks} — رسائل غير مقروءة: {unread}</p>
    </Card>
    <Card title="أحدث العقود" sub="آخر 5 عقود من الخادم — افتح صفحة العقود لعرض القائمة الكاملة والتفاصيل.">
      {latest.length === 0 ? <Empty text="لا عقود بعد — أنشئ أول عقد من صفحة العقود." /> :
        <div className="table-wrap"><table><thead><tr><th>العقد</th><th>المنتج</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th></tr></thead>
        <tbody>{latest.map((c) => <tr key={c.id}><td><b>{c.code}</b></td><td>{c.product_description}</td><td>{c.amount} {c.currency}</td><td><Badge tone={stateTone(c.state)}>{STATE_AR[c.state]}</Badge></td><td className="small">{fmt(c.created_at)}</td></tr>)}</tbody></table></div>}
    </Card>
  </>;
}

/* ---------------- Contracts ---------------- */
export function Contracts({ b, reload, sub }: { b: Bundle; reload: () => void; sub?: 'list' | 'new' | 'versions' }) {
  const showCreate = !sub || sub === 'new';
  const showList = !sub || sub === 'list';
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
    {showCreate && <Card title="عقد جديد" sub="الحقول المطلوبة في الخادم: رقم المشتري، رقم البائع، وصف المنتج، المبلغ.">
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
    </Card>}

    {showList && <Card title="العقود" actions={<select value={filter} onChange={(e) => setFilter(e.target.value)} className="inline-select"><option value="all">كل الحالات</option>{Object.entries(STATE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}>
      {list.length === 0 ? <Empty text="لا عقود مطابقة." /> :
        <table><thead><tr><th>الكود</th><th>المشتري / البائع</th><th>المنتج</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead>
        <tbody>{list.map((c) => <tr key={c.id} className={selId === c.id ? 'row-sel' : ''}>
          <td><b>{c.code}</b></td><td><div className="small">{c.buyer_phone}</div><div className="small">{c.seller_phone}</div></td>
          <td>{c.product_description}</td><td>{c.amount} {c.currency}</td>
          <td><Badge tone={stateTone(c.state)}>{STATE_AR[c.state]}</Badge></td>
          <td><button className="btn small" onClick={() => { setSelId(c.id); setMsg(''); }}>تفاصيل</button> <button className="btn small ghost" onClick={() => openAmend(c)}>تعديل / إصدارات</button></td>
        </tr>)}</tbody></table>}
    </Card>}

    {showList && sel && <Card title={`تفاصيل ${sel.code}`} sub={`بصمة البنود (SHA-256): ${sel.clause_fingerprint}`}>
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

/* ---------------- Contract versions ---------------- */
export function ContractVersions({ b }: { b: Bundle }) {
  const [selId, setSelId] = useState<number | null>(null);
  const [versions, setVersions] = useState<Record<string, unknown>[]>([]);
  const [msg, setMsg] = useState('');
  async function load(id: number) {
    setSelId(id); setMsg('');
    try { setVersions(await api.contractVersions(id)); }
    catch (err) { setMsg('خطأ: ' + (err as Error).message); setVersions([]); }
  }
  return <Card title="نسخ العقود" sub="كل تعديل يقفل النسخ السابقة وينشئ نسخة جديدة ببصمة بنود SHA-256 جديدة — النسخ القديمة تبقى قابلة للعرض.">
    {b.contracts.length === 0 ? <Empty text="لا عقود بعد." /> : <>
      <Field label="اختر عقداً"><select value={selId || ''} onChange={(e) => load(Number(e.target.value))}>
        <option value="">— اختر —</option>
        {b.contracts.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.product_description}</option>)}
      </select></Field>
      {selId !== null && (versions.length === 0 ? <Empty text="لا نسخ لهذا العقد." /> :
        <table><thead><tr><th>الإصدار</th><th>المنتج</th><th>المبلغ</th><th>البصمة</th><th>مقفلة</th><th>أُنشئت</th></tr></thead>
        <tbody>{versions.map((v) => {
          const snap = (v.snapshot || {}) as Record<string, unknown>;
          return <tr key={String(v.id)}><td>v{String(v.version)}</td><td>{String(snap.product_description || '')}</td><td>{String(snap.amount || '')} {String(snap.currency || '')}</td><td className="small">{String(v.clause_fingerprint || '').slice(0, 16)}…</td><td>{v.is_locked ? 'نعم' : 'لا'}</td><td>{fmt(String(v.created_at || ''))}</td></tr>;
        })}</tbody></table>)}
    </>}
    {msg && <p className="msg">{msg}</p>}
  </Card>;
}

/* ---------------- Inbox ---------------- */
export function Inbox({ b, reload, me, sub }: { b: Bundle; reload: () => void; me: MeUser | null; sub?: 'conversations' | 'chat' | 'assigned' | 'notes' }) {
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
  const isMine = (c: Conversation) => !!me && (c.assigned_to === me.full_name || c.assigned_to === me.email || c.assigned_to === String(me.id));
  const convs = b.conversations.filter((c) => (party === 'all' || c.party === party) && (status === 'all' || c.status === status) && (sub !== 'assigned' || isMine(c)));
  const showList = sub !== 'chat' && sub !== 'notes';
  const showChat = sub !== 'conversations' && sub !== 'notes';
  if (sub === 'notes') {
    const notes = b.messages.filter((m) => m.is_internal_note).sort((x, y) => y.id - x.id);
    return <Card title="الملاحظات الداخلية" sub="ملاحظات الفريق فقط — لا تُرسل للعميل ولا تظهر في عرض العميل أبداً.">
      {notes.length === 0 ? <Empty text="لا ملاحظات داخلية بعد — تُنشأ من عرض الدردشة بتفعيل خيار «ملاحظة داخلية فقط»." /> :
        <table><thead><tr><th>المحادثة</th><th>المرسل</th><th>الملاحظة</th><th>الوقت</th></tr></thead>
        <tbody>{notes.map((m) => <tr key={m.id}><td>{contractById(b, m.conversation_id || 0)?.code || m.conversation_id}</td><td>{m.sender_name || '—'}</td><td>{m.body}</td><td className="small">{fmt(m.created_at)}</td></tr>)}</tbody></table>}
    </Card>;
  }
  const sel = b.conversations.find((c) => c.id === selId) || null;
  const thread = sel ? b.messages.filter((m) => m.conversation_id === sel.id).sort((x, y) => x.id - y.id) : [];
  const unreadTotal = b.conversations.reduce((s, c) => s + (c.unread_count || 0), 0);
  return <div className="inbox-layout">
    {showList && <Card title={sub === 'assigned' ? 'المحادثات المعيّنة لي' : 'المحادثات'} sub={`إجمالي غير المقروء: ${unreadTotal} — محادثة مستقلة لكل طرف في كل عقد.`} actions={<button className="btn ghost small" onClick={reload}>تحديث</button>}>
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
      <p className="muted">التعيين وتغيير الحالة وتصفير غير المقروء تتم عبر الخادم وتُسجَّل في التدقيق.</p>
    </Card>}
    {showChat && <Card title={sel ? `محادثة ${sel.party === 'buyer' ? 'المشتري' : 'البائع'} — ${contractById(b, sel.contract_id)?.code || ''}` : 'اختر محادثة'}>
      {!sel ? <><Empty text="اختر محادثة من القائمة لعرض رسائلها والرد عليها." />
        <Field label="أو اختر محادثة مباشرة"><select value="" onChange={(e) => { if (e.target.value) setSelId(Number(e.target.value)); }}>
          <option value="">— اختر —</option>{b.conversations.map((c) => <option key={c.id} value={c.id}>{contractById(b, c.contract_id)?.code || c.contract_id} — {c.party === 'buyer' ? 'المشتري' : 'البائع'} ({c.status})</option>)}
        </select></Field></> : <>
        <div className="grid2">
          <Field label="المكلَّف بالمحادثة (في الخادم)"><select value={sel.assigned_to || ''} onChange={async (e) => {
            try { await api.assignConversation(sel.id, e.target.value); setMsg(`تم تعيين المحادثة إلى ${e.target.value || 'غير مكلَّف'}.`); setTick(tick + 1); reload(); }
            catch (err) { setMsg('خطأ: ' + (err as Error).message); }
          }}>
            <option value="">غير مكلَّف</option>
            {me && <option value={me.full_name}>{me.full_name} (أنا)</option>}
            {b.users.map((u) => <option key={u.id} value={u.full_name}>{u.full_name} ({ROLE_AR[u.role]})</option>)}
          </select></Field>
          <Field label="حالة المحادثة"><select value={sel.status} onChange={async (e) => {
            try { const r = await fetch(`/api/conversations/${sel.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('ps_token') ? { Authorization: 'Bearer ' + localStorage.getItem('ps_token') } : {}) }, body: JSON.stringify({ status: e.target.value }) });
              if (!r.ok) throw new Error('خطأ ' + r.status); setMsg('تم تحديث حالة المحادثة.'); reload(); }
            catch (err) { setMsg('خطأ: ' + (err as Error).message); }
          }}>
            {['new', 'open', 'pending', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select></Field>
        </div>
        {(sel.unread_count || 0) > 0 && <button className="btn ghost small" onClick={async () => { try { await api.readConversation(sel.id); setMsg('تم تعيين المحادثة كمقروءة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تعيين كمقروءة ({sel.unread_count})</button>}
        <div className="thread">
          {thread.length === 0 ? <Empty text="لا رسائل في هذه المحادثة بعد." /> : thread.map((m) => <div key={m.id} className={`bubble ${m.direction === 'in' ? 'in' : 'out'} ${m.is_internal_note ? 'internal' : ''}`}>
            <div className="bubble-head">{m.is_internal_note ? 'ملاحظة داخلية فقط — لا تُرسل للعميل' : m.direction === 'in' ? 'وارد' : 'صادر'} • {m.sender_name || '—'} {m.template_name ? `• قالب: ${m.template_name}` : ''}</div>
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
    </Card>}
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
// Two statuses are shown side by side and never conflated:
//  - approval_status = LOCAL status only (PUT /api/templates/:id, edited here).
//  - meta_status = Meta status (approved / pending / rejected / not_submitted),
//    set only by Submit / Sync against Meta — never by the local dropdown.
export function Templates({ b, reload, canEdit }: { b: Bundle; reload?: () => void; canEdit?: boolean }) {
  const localTone = (s: string) => s === 'approved' ? 'ok' as const : s === 'rejected' ? 'bad' as const : 'warn' as const;
  const localAr = (s: string) => s === 'approved' ? 'معتمد محلياً' : s === 'rejected' ? 'مرفوض محلياً' : 'بانتظار الاعتماد المحلي';
  const metaTone = (s?: string) => s === 'approved' ? 'ok' as const : s === 'rejected' ? 'bad' as const : s === 'not_submitted' ? 'neutral' as const : 'warn' as const;
  const metaAr = (s?: string) => s === 'approved' ? 'معتمد لدى Meta' : s === 'rejected' ? 'مرفوض لدى Meta' : s === 'not_submitted' ? 'غير مقدَّم إلى Meta' : s === 'pending' ? 'قيد المراجعة لدى Meta' : 'حالة Meta غير معروفة';
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ name: '', body: '', buttons: '' });
  const [busy, setBusy] = useState(false);
  async function submitToMeta(t: Template) {
    setBusy(true); setMsg('');
    try { const r = await api.submitWhatsAppTemplate(t.id);
      setMsg(r.ok ? (r.dry_run ? `وضع تجريبي: لم يُقدَّم قالب ${t.name} إلى Meta لأن الربط غير مكتمل — بقيت حالته «غير مقدَّم».` : `تم تقديم قالب ${t.name} إلى Meta — حالة Meta الآن: ${metaAr(r.meta_status || r.template?.meta_status)}.`) : `لم يُقدَّم قالب ${t.name}: ${r.error || 'خطأ غير معروف'}.`);
      reload?.(); } catch (err) { setMsg('خطأ في التقديم إلى Meta: ' + (err as Error).message + ' — إذا كان الخادم لا يوفّر هذا الـ endpoint بعد، فالواجهة جاهزة والخادم ما زال قيد التنفيذ.'); }
    finally { setBusy(false); }
  }
  async function syncFromMeta() {
    setBusy(true); setMsg('');
    try { const r = await api.syncWhatsAppTemplates();
      setMsg(r.ok ? `تمت المزامنة من Meta${r.dry_run ? ' (وضع تجريبي: لم تُقرأ حالة حقيقية من Meta).' : ''}${typeof r.updated === 'number' ? ` — حدّثت ${r.updated} قالباً.` : '.'}` : `فشلت المزامنة من Meta: ${r.error || 'خطأ غير معروف'}.`);
      reload?.(); } catch (err) { setMsg('خطأ في المزامنة من Meta: ' + (err as Error).message + ' — إذا كان الخادم لا يوفّر هذا الـ endpoint بعد، فالواجهة جاهزة والخادم ما زال قيد التنفيذ.'); }
    finally { setBusy(false); }
  }
  return <>
    <Card title="قوالب واتساب Utility" sub="فئة Utility فقط، بالعربية. خارج نافذة 24 ساعة لا يُرسل إلا قالب معتمد لدى Meta فعلاً — الحالة المحلية وحدها لا تكفي أبداً.">
      <p className="local-note">الحالتان مختلفتان: «الحالة المحلية» يغيّرها المشرف يدوياً ولا تعني موافقة Meta. «حالة Meta» تأتي من Meta فقط عبر «تقديم إلى Meta» و«مزامنة من Meta».</p>
      <div className="btn-row">
        <button className="btn" disabled={!canEdit || busy} onClick={syncFromMeta}>مزامنة من Meta</button>
        {!canEdit && <span className="muted">المزامنة والتقديم والإنشاء تتطلب صلاحية تعديل واتساب (whatsapp:edit).</span>}
      </div>
      {b.templates.length === 0 ? <Empty text="لا قوالب — تُزرع القوالب العشرة تلقائياً عند أول تشغيل للخادم." /> :
        <div className="table-wrap"><table><thead><tr><th>اسم القالب</th><th>الوصف</th><th>اللغة</th><th>الفئة</th><th>الحالة المحلية (LOCAL)</th><th>حالة Meta</th><th>نص القالب</th>{canEdit && <th>تحديث محلي / تقديم</th>}</tr></thead>
        <tbody>{b.templates.map((t) => <tr key={t.id}><td><code>{t.name}</code></td><td>{TEMPLATE_AR[t.name] || '—'}</td><td>{t.language}</td><td>{t.category}</td>
          <td><Badge tone={localTone(t.approval_status)}>{localAr(t.approval_status)}</Badge></td>
          <td><Badge tone={metaTone(t.meta_status)}>{metaAr(t.meta_status)}</Badge>{t.rejection_reason ? <div className="small">سبب الرفض: {t.rejection_reason}</div> : null}</td>
          <td>{t.body ? <span className="small">{t.body}</span> : <span className="muted">— لا نص محفوظ في الخادم —</span>}</td>
          {canEdit && <td><select className="inline-select" value={t.approval_status} onChange={async (e) => {
            try { await api.updateTemplate(t.id, e.target.value); setMsg(`تم تحديث الحالة المحلية (فقط) لقالب ${t.name} إلى ${localAr(e.target.value)} — هذا لا يغيّر حالة Meta.`); reload?.(); }
            catch (err) { setMsg('خطأ: ' + (err as Error).message); }
          }}><option value="pending">بانتظار (محلي)</option><option value="approved">معتمد (محلي)</option><option value="rejected">مرفوض (محلي)</option></select>{' '}
          <button className="btn small" disabled={busy} onClick={() => submitToMeta(t)}>تقديم إلى Meta</button></td>}</tr>)}</tbody></table></div>}
      {msg && <p className="msg">{msg}</p>}
    </Card>
    {canEdit && <Card title="إنشاء قالب جديد (مسودة محلية)" sub="يُنشأ كمسودة محلية بحالة Meta «غير مقدَّم» — لا يصبح قابلاً للإرسال خارج النافذة إلا بعد تقديمه وموافقة Meta عليه. لا توجد هنا أي بيانات سرية.">
      <form className="grid2" onSubmit={async (e) => { e.preventDefault(); if (!/^[a-z0-9_]+$/.test(form.name.trim())) { setMsg('اسم القالب: أحرف صغيرة وأرقام وشرطات سفلية فقط.'); return; } if (!form.body.trim()) { setMsg('أدخل نص القالب.'); return; } setBusy(true); try {
        const buttons = form.buttons.split(',').map((x) => x.trim()).filter(Boolean);
        const t = await api.createWhatsAppTemplate({ name: form.name.trim(), category: 'UTILITY', language: 'ar', body: form.body.trim(), ...(buttons.length ? { buttons } : {}) });
        setMsg(`تم إنشاء مسودة القالب «${t.name}» — حالة Meta: غير مقدَّم. قدّمه من الجدول أعلاه بعد مراجعة نصه.`); setForm({ name: '', body: '', buttons: '' }); reload?.();
      } catch (err) { setMsg('خطأ في إنشاء القالب: ' + (err as Error).message + ' — إذا كان الخادم لا يوفّر هذا الـ endpoint بعد، فالواجهة جاهزة والخادم ما زال قيد التنفيذ.'); } finally { setBusy(false); } }}>
        <Field label="اسم القالب (أحرف صغيرة وأرقام و_ فقط)"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: order_update" /></Field>
        <Field label="الفئة (ثابتة)"><input disabled value="UTILITY — إشعار معاملة (Utility)" /></Field>
        <Field label="اللغة (ثابتة)"><input disabled value="ar — العربية" /></Field>
        <Field label="أزرار (اختياري — عناوين مفصولة بفواصل)"><input value={form.buttons} onChange={(e) => setForm({ ...form, buttons: e.target.value })} placeholder="مثال: تأكيد، تواصل مع الدعم" /></Field>
        <div style={{ gridColumn: '1 / -1' }}><Field label="نص القالب — استخدم {{1}} و{{2}}… للمتغيرات بالتسلسل، ولا تبدأ النص بمتغير ولا تنهِ به إن أمكن"><textarea rows={4} required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="مثال: تم إنشاء عقدك رقم {{1}} — سنبلغك عند تأكيد الدفع من المؤسسة المالية." /></Field></div>
        <button className="btn" type="submit" disabled={busy}>إنشاء مسودة محلية</button>
      </form>
      {msg && <p className="msg">{msg}</p>}
    </Card>}
    <Card title="عند رفض Meta لقالب — ماذا تفعل؟" sub="لا تعيد تقديم النص نفسه دون تغيير، ولا تعلّم القالب «معتمداً» محلياً لتجاوز الرفض.">
      <ul>
        <li><b>مشكلة صيغة:</b> راجع ترقيم المتغيرات {'{{1}}'} و{'{{2}}'}… بالتسلسل دون تكرار أو فجوة، وأصلح قيم الأمثلة إن طُلبت.</li>
        <li><b>فئة خاطئة:</b> إذا كان النص ترويجياً أو دعوة للشراء أو سؤالاً مفتوحاً، أعد كتابته كإشعار محايد مرتبط بمعاملة موجودة — Utility إشعار مباشر فقط، لا ترويج ولا إلحاح.</li>
        <li><b>سياسة:</b> أزل أي رابط مختصر أو رابط wa.me، ولا تطلب بيانات حساسة (بطاقات، كلمات سر، رموز تحقق).</li>
        <li>بعد الإصلاح أعد التقديم وانتظر قرار Meta (خطّط على 24 ساعة). إن كنت متأكداً أن النص مطابق للسياسة، استخدم الاعتراض (Appeal) في WhatsApp Manager بدل إعادة التقديم العشوائية.</li>
        <li>أثناء الرفض، الميزة التي تعتمد على القالب متوقفة لذلك القالب: لا يُرسل القالب المرفوض أبداً، ولا يُستبدل برسالة حرة خارج نافذة 24 ساعة.</li>
      </ul>
    </Card>
  </>;
}

/* ---------------- Automation ---------------- */
export function Automation({ b, reload, only }: { b: Bundle; reload: () => void; only?: 'rules' | 'killswitch' }) {
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [ruleForm, setRuleForm] = useState({ name: '', category: 'general', trigger_value: '' });
  const loadRules = async () => { try { setRules(await api.automationRules()); } catch { setRules([]); } };
  useEffect(() => { loadRules(); }, []);
  async function toggle(off: boolean) {
    try { await api.killSwitchSet(off); setMsg(off ? 'تم تفعيل مفتاح الإيقاف — الأتمتة موقوفة الآن.' : 'تم إيقاف مفتاح الإيقاف — الأتمتة تعمل.'); setConfirm(false); reload(); }
    catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  return <>
    {(!only || only === 'killswitch') && <Card title="مفتاح إيقاف الأتمتة (Kill Switch)" sub="يعمل فعلاً عبر الخادم: POST /api/automation/kill-switch — ويُسجَّل كل تبديل في سجل التدقيق.">
      <p>الحالة الحالية: {b.killSwitch ? <Badge tone="bad">مُفعّل — الأتمتة موقوفة</Badge> : <Badge tone="ok">متوقف — الأتمتة تعمل</Badge>}</p>
      {!confirm ? <button className={`btn ${b.killSwitch ? '' : 'danger'}`} onClick={() => setConfirm(true)}>{b.killSwitch ? 'إعادة تشغيل الأتمتة' : 'إيقاف الأتمتة فوراً'}</button> :
        <div className="btn-row"><span>تأكيد {b.killSwitch ? 'إعادة التشغيل' : 'الإيقاف الفوري'}؟</span>
          <button className="btn danger" onClick={() => toggle(!b.killSwitch)}>تأكيد</button>
          <button className="btn ghost" onClick={() => setConfirm(false)}>إلغاء</button></div>}
      {msg && <p className="msg">{msg}</p>}
    </Card>}
    {(!only || only === 'rules') && <Card title="قواعد الأتمتة الداخلية" sub="قواعد داخلية فقط (ردود، مهام، تحويل بشري) — لا توجد قاعدة مالية أبداً، وأي قاعدة تُنشأ أثناء تفعيل مفتاح الإيقاف تُنشأ معطّلة.">
      <form className="grid2" onSubmit={async (e) => { e.preventDefault(); if (!ruleForm.name.trim()) { setMsg('أدخل اسم القاعدة.'); return; } try { const r = await api.createRule({ name: ruleForm.name.trim(), category: ruleForm.category, trigger_value: ruleForm.trigger_value || null, steps: [{ step_type: 'text' }] }); setMsg(`تم إنشاء القاعدة «${r.name}» (نشطة: ${r.is_active ? 'نعم' : 'لا'}).`); setRuleForm({ name: '', category: 'general', trigger_value: '' }); loadRules(); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
        <Field label="اسم القاعدة"><input value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} /></Field>
        <Field label="الفئة"><select value={ruleForm.category} onChange={(e) => setRuleForm({ ...ruleForm, category: e.target.value })}><option value="general">عامة</option><option value="keyword">كلمة مفتاحية</option><option value="contract-event">حدث عقد</option><option value="handover">تحويل بشري</option></select></Field>
        <Field label="قيمة المشغّل"><input value={ruleForm.trigger_value} onChange={(e) => setRuleForm({ ...ruleForm, trigger_value: e.target.value })} placeholder="مثال: عقد جديد" /></Field>
        <button className="btn" type="submit">إنشاء القاعدة</button>
      </form>
      {rules.length === 0 ? <Empty text="لا قواعد أتمتة بعد." /> :
        <table><thead><tr><th>القاعدة</th><th>الفئة</th><th>المشغّل</th><th>نشطة</th><th></th></tr></thead>
        <tbody>{rules.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.category}</td><td>{r.trigger_value || '—'}</td><td>{r.is_active ? 'نعم' : 'لا'}</td>
          <td><button className="btn small ghost" onClick={async () => { try { const u = await api.toggleRule(r.id); setMsg(`القاعدة «${u.name}» أصبحت ${u.is_active ? 'نشطة' : 'معطّلة'}.`); loadRules(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>{r.is_active ? 'تعطيل' : 'تفعيل'}</button></td></tr>)}</tbody></table>}
      {msg && <p className="msg">{msg}</p>}
    </Card>}
    <Card title="ضوابط الأتمتة المؤكدة في الخادم" sub="القواعد التالية هي ضوابط النظام المؤكدة في الخادم نفسه.">
      <ul>
        <li>خطوات المال مرفوضة في التدفقات: release_money و refund_money و confirm_payment — يرفضها الخادم بخطأ 400.</li>
        <li>لا انتقال إلى payment_confirmed بدون financial_reference من المؤسسة المالية الخارجية.</li>
        <li>لا إفراج ولا استرداد ولا حسم نزاع آلياً أبداً — كلها يدوية خارج النظام.</li>
        <li>سجل التدقيق إلحاقي فقط: الخادم لا يعدّله ولا يحذف منه أبداً.</li>
        <li>Webhook واتساب يتحقق بتوقيع HMAC-SHA256 عند ضبط WHATSAPP_APP_SECRET.</li>
      </ul>
      <p className="muted">القواعد أعلاه تُدار عبر الخادم (GET/POST /api/automation/rules) ومفتاح الإيقاف يوقفها كلها فوراً.</p>
    </Card>
  </>;
}

/* ---------------- Users ---------------- */
export function Users({ b, reload, sub, me }: { b: Bundle; reload: () => void; sub?: 'list' | 'add' | 'passwords' | 'permissions' | 'departments'; me: MeUser | null }) {
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'ops_employee', department: 'Operations' });
  const [sections, setSections] = useState<string[]>([]);
  const [actions, setActions] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', email: '', role: 'ops_employee', department: 'Operations' });
  const [departments, setDepartments] = useState<{ key: string; label_ar: string }[]>([]);
  const [resetUserId, setResetUserId] = useState<number | ''>('');
  const [resetPass, setResetPass] = useState('');
  const [ownPass, setOwnPass] = useState({ current: '', next: '' });
  useEffect(() => { api.departments().then(setDepartments).catch(() => setDepartments(DEPARTMENTS.map((d) => ({ key: d.key, label_ar: d.ar })))); }, []);
  const deptAr = (k?: string | null) => DEPARTMENTS.find((d) => d.key === k)?.ar || k || '—';
  const toggleSection = (s: string) => setSections(sections.includes(s) ? sections.filter((x) => x !== s) : [...sections, s]);
  const toggleAction = (sec: string, a: string) => {
    const cur = actions[sec] || [];
    setActions({ ...actions, [sec]: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] });
  };

  if (sub === 'add') return <Card title="إضافة مستخدم" sub="لا يستطيع أحد الدخول إلا بعد أن يضيفه المسؤول هنا. كلمة السر 8 أحرف على الأقل، وتُحفظ مشفّرة (scrypt) ولا تُعرض أبداً. إن لم تختر أقساماً/إجراءات، تُطبَّق افتراضات الدور.">
    <form className="grid2" onSubmit={async (e) => { e.preventDefault(); try {
      const payload: { full_name: string; email: string; password: string; role: string; department: string; sections?: string[]; actions?: Record<string, string[]> } =
        { full_name: form.full_name, email: form.email, password: form.password, role: form.role, department: form.department };
      if (sections.length) payload.sections = sections;
      const acts: Record<string, string[]> = {};
      for (const s of sections) if ((actions[s] || []).length) acts[s] = actions[s];
      if (Object.keys(acts).length) payload.actions = acts;
      const u = await api.createUser(payload);
      setMsg(`تم إنشاء المستخدم ${u.full_name} بدور ${ROLE_AR[u.role]}.`); setForm({ full_name: '', email: '', password: '', role: 'ops_employee', department: 'Operations' }); setSections([]); setActions({}); reload();
    } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
      <Field label="الاسم الكامل"><input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
      <Field label="البريد الإلكتروني"><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field label="كلمة السر (8 أحرف على الأقل)"><input required type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
      <Field label="الدور"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_AR[r]}</option>)}</select></Field>
      <Field label="القسم"><select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d.key} value={d.key}>{d.ar}</option>)}</select></Field>
      <button className="btn" type="submit">إضافة المستخدم</button>
    </form>
    <h3>أقسام ظاهرة مخصصة (اختياري — تقيّد افتراضات الدور)</h3>
    <div className="btn-row">{SECTIONS_LIST.map((s) => <label key={s} className="check"><input type="checkbox" checked={sections.includes(s)} onChange={() => toggleSection(s)} /> {SECTIONS_AR[s]}</label>)}</div>
    {sections.map((s) => <div key={s}><b>{SECTIONS_AR[s]}:</b> <span className="btn-row">{['view', 'create', 'edit', 'approve', 'manage'].map((a) => <label key={a} className="check"><input type="checkbox" checked={(actions[s] || []).includes(a)} onChange={() => toggleAction(s, a)} /> {ACTION_AR[a]}</label>)}</span></div>)}
    {msg && <p className="msg">{msg}</p>}
  </Card>;

  if (sub === 'passwords') return <>
    <Card title="تغيير كلمة سرّي" sub="كلمة السر الجديدة 8 أحرف على الأقل.">
      <form className="grid2" onSubmit={async (e) => { e.preventDefault(); try { await api.changePassword(ownPass.current, ownPass.next); setMsg('تم تغيير كلمة سرّك.'); setOwnPass({ current: '', next: '' }); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
        <Field label="كلمة السر الحالية"><input required type="password" value={ownPass.current} onChange={(e) => setOwnPass({ ...ownPass, current: e.target.value })} /></Field>
        <Field label="كلمة السر الجديدة"><input required type="password" minLength={8} value={ownPass.next} onChange={(e) => setOwnPass({ ...ownPass, next: e.target.value })} /></Field>
        <button className="btn" type="submit">تغيير كلمة سرّي</button>
      </form>
      {msg && <p className="msg">{msg}</p>}
    </Card>
    <Card title="إعادة تعيين كلمة سر مستخدم (للمسؤول)" sub="المسؤول فقط — تُسجَّل إعادة التعيين في سجل التدقيق.">
      <form className="grid2" onSubmit={async (e) => { e.preventDefault(); if (!resetUserId || resetPass.length < 8) { setMsg('اختر مستخدماً وكلمة سر 8 أحرف على الأقل.'); return; } try { await api.resetPassword(Number(resetUserId), resetPass); setMsg('تمت إعادة تعيين كلمة السر.'); setResetPass(''); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
        <Field label="المستخدم"><select value={resetUserId} onChange={(e) => setResetUserId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">— اختر —</option>{b.users.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
        </select></Field>
        <Field label="كلمة السر الجديدة"><input required type="password" minLength={8} value={resetPass} onChange={(e) => setResetPass(e.target.value)} /></Field>
        <button className="btn" type="submit">إعادة تعيين</button>
      </form>
      {msg && <p className="msg">{msg}</p>}
    </Card>
  </>;

  if (sub === 'permissions') return <PermissionsEditor users={b.users} reload={reload} />;

  if (sub === 'departments') return <Card title="الأقسام" sub="أربعة أقسام ثابتة — القسم يُحفظ على سجل المستخدم ويظهر في صلاحياته.">
    <table><thead><tr><th>القسم</th><th>الاسم (EN)</th><th>عدد المستخدمين</th></tr></thead>
    <tbody>{(departments.length ? departments : DEPARTMENTS.map((d) => ({ key: d.key, label_ar: d.ar }))).map((d) => <tr key={d.key}><td>{d.label_ar}</td><td>{d.key}</td><td>{b.users.filter((u) => u.department === d.key).length}</td></tr>)}</tbody></table>
    <p className="muted">افتراضات الأدوار: المالك كل الأقسام وكل الإجراءات؛ مشرف التشغيل لوحة القيادة والعقود والإنبكس والمهام والأتمتة والتدقيق (عرض/إنشاء/تعديل واعتماد العقود والمهام)؛ موظف التشغيل لوحة القيادة والعقود والإنبكس والمهام (دون اعتماد)؛ المنسّق المالي عرض فقط للوحة والعقود والإنبكس والمهام والتدقيق؛ المشاهد عرض فقط للوحة والعقود والإنبكس والتدقيق. التعديلات الفردية هنا تقيّد/تستبدل افتراضات الدور، والخادم يفرضها على كل endpoint — ليست إخفاءً في الواجهة فقط.</p>
  </Card>;

  return <>
    <Card title="المستخدمون" sub="المسؤول الأساسي لا يمكن تعطيله أو حذفه، والمالك النشط الوحيد محمي أيضاً. لا تُعرض كلمات سر ولا تجزئاتها أبداً.">
      {b.users.length === 0 ? <Empty text="لا مستخدمين بعد." /> :
        <table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>القسم</th><th>نشط</th><th>أساسي</th><th></th></tr></thead>
        <tbody>{b.users.map((u) => <tr key={u.id}><td>{u.full_name}</td><td>{u.email}</td><td>{ROLE_AR[u.role]}</td><td>{deptAr(u.department)}</td><td>{u.is_active ? 'نعم' : 'لا'}</td><td>{u.is_primary_admin ? 'نعم' : '—'}</td>
          <td>
            <button className="btn small" onClick={() => { setEditingId(u.id); setEditForm({ full_name: u.full_name, email: u.email, role: u.role, department: u.department || 'Operations' }); }}>تعديل</button>{' '}
            {u.is_active
              ? <button className="btn small ghost" onClick={async () => { try { await api.disableUser(u.id); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تعطيل</button>
              : <button className="btn small ghost" onClick={async () => { try { await api.enableUser(u.id); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تفعيل</button>}{' '}
            <button className="btn small ghost" onClick={async () => { try { await api.deleteUser(u.id); setMsg(`تم حذف المستخدم ${u.full_name}.`); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>حذف</button>
          </td></tr>)}</tbody></table>}
      {msg && <p className="msg">{msg}</p>}
    </Card>
    {editingId !== null && <Card title="تعديل مستخدم">
      <form className="grid2" onSubmit={async (e) => { e.preventDefault(); try { await api.updateUser(editingId, { full_name: editForm.full_name, email: editForm.email, role: editForm.role, department: editForm.department }); setMsg('تم تحديث المستخدم (تغيير الدور دون أقسام مخصصة يعيد افتراضات الدور الجديد).'); setEditingId(null); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
        <Field label="الاسم الكامل"><input required value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} /></Field>
        <Field label="البريد الإلكتروني"><input required type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></Field>
        <Field label="الدور"><select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_AR[r]}</option>)}</select></Field>
        <Field label="القسم"><select value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d.key} value={d.key}>{d.ar}</option>)}</select></Field>
        <button className="btn" type="submit">حفظ التعديل</button>
        <button className="btn ghost" type="button" onClick={() => setEditingId(null)}>إلغاء</button>
      </form>
      {msg && <p className="msg">{msg}</p>}
    </Card>}
    {me && <p className="muted">أنت مسجّل كـ {me.full_name} ({ROLE_AR[me.role]}) — قسم {deptAr(me.department)}.</p>}
  </>;
}

export function PermissionsEditor({ users, reload }: { users: User[]; reload: () => void }) {
  const [userId, setUserId] = useState<number | ''>('');
  const [sections, setSections] = useState<string[]>([]);
  const [actions, setActions] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState('');
  function loadUser(id: number) {
    const u = users.find((x) => x.id === id);
    setUserId(id);
    setSections(u?.sections || []);
    setActions(u?.actions || {});
  }
  const toggleSection = (s: string) => setSections(sections.includes(s) ? sections.filter((x) => x !== s) : [...sections, s]);
  const toggleAction = (sec: string, a: string) => {
    const cur = actions[sec] || [];
    setActions({ ...actions, [sec]: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] });
  };
  return <Card title="محرر الصلاحيات" sub="اختر مستخدماً ثم حدّد الأقسام الظاهرة والإجراءات لكل قسم — الحفظ يستبدل إعدادات المستخدم (دون المساس بكلمة سره) ويفرضها الخادم فوراً.">
    <Field label="المستخدم"><select value={userId} onChange={(e) => { if (e.target.value) loadUser(Number(e.target.value)); }}>
      <option value="">— اختر —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({ROLE_AR[u.role]})</option>)}
    </select></Field>
    {userId !== '' && <>
      <h3>الأقسام الظاهرة</h3>
      <div className="btn-row">{SECTIONS_LIST.map((s) => <label key={s} className="check"><input type="checkbox" checked={sections.includes(s)} onChange={() => toggleSection(s)} /> {SECTIONS_AR[s]}</label>)}</div>
      {sections.map((s) => <div key={s}><b>{SECTIONS_AR[s]}:</b> <span className="btn-row">{['view', 'create', 'edit', 'approve', 'manage'].map((a) => <label key={a} className="check"><input type="checkbox" checked={(actions[s] || []).includes(a)} onChange={() => toggleAction(s, a)} /> {ACTION_AR[a]}</label>)}</span></div>)}
      <div className="btn-row"><button className="btn" onClick={async () => {
        try {
          const acts: Record<string, string[]> = {};
          for (const s of sections) if ((actions[s] || []).length) acts[s] = actions[s];
          await api.updateUser(Number(userId), { sections, actions: acts });
          setMsg('تم حفظ الصلاحيات.'); reload();
        } catch (err) { setMsg('خطأ: ' + (err as Error).message); }
      }}>حفظ الصلاحيات</button></div>
    </>}
    {msg && <p className="msg">{msg}</p>}
  </Card>;
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

/* ---------------- WhatsApp ---------------- */
// Stage 5 Connection Wizard: 7 steps driven by GET /api/whatsapp/status
// `wizard_steps` (done = green, pending = amber, blocked = red). If the
// backend does not yet return wizard_steps, statuses are derived from the
// old booleans so the wizard still renders honestly — nothing is invented
// as "done". NO token/secret/WABA/phone input field exists anywhere here:
// credentials live ONLY in Render Environment Variables (see Step 4).
const WIZARD_SPEC: { key: string; fallbackTitle: string; detail: string }[] = [
  { key: 'meta_business', fallbackTitle: 'حساب Meta Business', detail: 'افتح business.facebook.com بحساب العميل، وتحقق من الحساب التجاري الحالي قبل إنشاء أي حساب جديد. التوثيق يبدأ من اليوم الأول — لا تنتظر اكتماله لتنفيذ بقية الخطوات، لكن لا تطلق لعملاء حقيقيين قبل فهم حدّ المراسلة.' },
  { key: 'waba', fallbackTitle: 'حساب WhatsApp Business (WABA)', detail: 'أنشئ WABA داخل Portfolio العميل أو اختر الموجود إن كان صحيحاً. كل الأصول باسم العميل (المالك النهائي) — لا تُنشأ باسم المطوّر ثم تُنقل لاحقاً.' },
  { key: 'dedicated_number', fallbackTitle: 'رقم مخصص للخدمة', detail: 'رقم تملكه وتستطيع استقبال رمز تحقق عليه، وليس رقمك الشخصي ولا رقماً مسجلاً حالياً في تطبيق واتساب أو WhatsApp Business. إن كان مسجلاً في التطبيق، احذفه من التطبيق أولاً أو اختر رقماً آخر — المشاركة بين التطبيق والـ API غير مدعومة في هذا الإعداد اليدوي. ثم أدخل Display Name مطابقاً للعلامة.' },
  { key: 'app_token', fallbackTitle: 'التطبيق ورمز الوصول الدائم', detail: 'في Business Settings ← Users ← System Users: أنشئ System User بدور Admin، امنحه التطبيق وWABA بصلاحية Full Control، ثم Generate Token بانتهاء Never وبالصلاحيتين فقط whatsapp_business_messaging وwhatsapp_business_management.' },
  { key: 'webhook', fallbackTitle: 'Webhook', detail: 'في التطبيق ← WhatsApp ← Configuration: أدخل Callback URL أدناه وVerify Token مطابقاً حرفياً لما في بيئة الاستضافة، ثم Verify and Save. اشترك في: messages وmessage_status وmessage_template_status_update وphone_number_quality_update وphone_number_name_update وaccount_update وbusiness_capability_update.' },
  { key: 'test_message', fallbackTitle: 'رسالة الاختبار', detail: 'ابدأ برقم الاختبار وقالب hello_world في Meta، ثم أرسل رسالة اختبار من النموذج أدناه. لا تنتقل للتشغيل قبل نجاح: واردة في الإنبكس، ردّ يصل فعلاً للهاتف، وقالب خارج النافذة، ورفض النص الحر خارج النافذة.' },
  { key: 'templates_approval', fallbackTitle: 'اعتماد القوالب لدى Meta', detail: 'القوالب العشرة Utility بالعربية. لا يُرسل أي قالب قبل اعتماده لدى Meta، ولا يُرسل قالب لأي شخص خارج علاقة الدعوة/العقد. راجع تبويب «القوالب» لحالتي كل قالب (المحلية وMeta).' },
];
const LIVE_WEBHOOK_EXAMPLE = 'https://pilot-system-z5vc.onrender.com/api/whatsapp/webhook';
export function WhatsApp({ b, reload, me, sub }: { b: Bundle; reload: () => void; me: MeUser | null; sub?: 'connection' | 'templates' | 'settings' | 'webhook' }) {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [err, setErr] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [tokenMsg, setTokenMsg] = useState('');
  const [testingToken, setTestingToken] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendForm, setSendForm] = useState({ to: '', mode: 'text' as 'text' | 'template', body: '', template_name: '' });
  const canEdit = hasAction(me, 'whatsapp', 'edit');
  useEffect(() => {
    api.whatsappStatus().then(setStatus).catch((e) => setErr((e as Error).message));
  }, []);
  const refresh = () => { api.whatsappStatus().then(setStatus).catch((e) => setErr((e as Error).message)); reload(); };
  if (sub === 'templates') return <Templates b={b} reload={reload} canEdit={canEdit} />;
  if (sub === 'settings') return <Card title="إعدادات واتساب" sub="أسماء متغيرات البيئة فقط — القيم تعيش في بيئة الخادم حصراً ولا تُكتب هنا ولا في أي ملف ولا في المحادثة.">
    <ul>
      <li><code>WHATSAPP_VERIFY_TOKEN</code> — رمز تحقق Webhook (يُطابق ما يُدخل في Meta).</li>
      <li><code>WHATSAPP_APP_SECRET</code> — سر التطبيق للتحقق من توقيع HMAC-SHA256.</li>
      <li><code>WHATSAPP_ACCESS_TOKEN</code> — رمز الوصول الدائم (System User Token) للرسائل الصادرة.</li>
      <li><code>WHATSAPP_PHONE_NUMBER_ID</code> — معرّف الرقم المخصص للخدمة.</li>
      <li><code>WHATSAPP_BUSINESS_ACCOUNT_ID</code> — معرّف حساب WhatsApp Business.</li>
      <li><code>WHATSAPP_API_VERSION</code> — إصدار Graph API (الافتراضي عند التنفيذ: v26.0).</li>
      <li><code>APP_BASE_URL</code> — عنوان الموقع الحي، يُستخدم لبناء عنوان Webhook.</li>
      <li><code>JWT_SECRET</code> — سر توقيع رموز الدخول (8 ساعات).</li>
    </ul>
    <p className="muted">تُضبط هذه المتغيرات في لوحة Render (Environment) ثم يُعاد النشر — المتغيرات لا تسري قبل إعادة النشر. لا يوجد في هذه الواجهة أي حقل لإدخال رمز أو سر، عمداً.</p>
  </Card>;
  if (sub === 'webhook') return <Card title="حالة Webhook" sub="حالة فقط — لا تُعرض أي قيمة سرية هنا أبداً.">
    <p>الخادم: {b.healthOk ? <Badge tone="ok">متصل</Badge> : <Badge tone="bad">غير متصل</Badge>}</p>
    {status ? <ul>
      <li>رمز التحقق مضبوط: {status.webhook_verify_configured ? 'نعم' : 'لا'}</li>
      <li>التحقق بتوقيع HMAC مفعّل: {status.webhook_hmac_configured ? 'نعم' : 'لا'}</li>
      <li>رمز الوصول مضبوط: {status.whatsapp_access_configured ? 'نعم' : 'لا'}</li>
      <li>رقم الهاتف مضبوط: {status.phone_number_configured === undefined ? 'غير معروف (الخادم القديم لا يرسل هذا الحقل)' : status.phone_number_configured ? 'نعم' : 'لا'}</li>
      <li>حساب WABA مضبوط: {status.waba_configured === undefined ? 'غير معروف (الخادم القديم لا يرسل هذا الحقل)' : status.waba_configured ? 'نعم' : 'لا'}</li>
      <li>إصدار API: {status.api_version || 'غير معروف (الخادم القديم لا يرسل هذا الحقل)'}</li>
      <li>قوالب معتمدة محلياً: {status.templates_approved} من {status.templates_total}</li>
      <li>قوالب معتمدة لدى Meta: {status.templates_meta_approved === undefined ? 'غير معروف (الخادم القديم لا يرسل هذا الحقل)' : `${status.templates_meta_approved} من ${status.templates_total}`}</li>
    </ul> : <p className="muted">{err ? 'تعذر جلب حالة Webhook: ' + err : 'جارٍ الجلب…'}</p>}
    <p className="muted">نقطة Webhook: <code>GET/POST /api/whatsapp/webhook</code> — التحقق GET يقارن رمز Meta، والوارد POST يتحقق من توقيع <code>x-hub-signature-256</code> عند ضبط السر.</p>
    <p className="muted">عنوان Webhook الكامل (استخدم نطاقك الحي إن تغيّر عن Render): <code>{status?.app_base_url ? status.app_base_url.replace(/\/$/, '') + '/api/whatsapp/webhook' : LIVE_WEBHOOK_EXAMPLE}</code>{!status?.app_base_url && ' — هذا مثال بالنطاق الحي الحالي؛ إن كان نطاقك مختلفاً، استبدل النطاق فقط واحتفظ بالمسار.'}</p>
  </Card>;
  // --- Connection wizard (default sub) ---
  // When the backend returns wizard_steps, those 7 steps (keys, titles,
  // statuses) are rendered verbatim, in the backend's order — the UI never
  // renames or reorders them. The fallback spec below is used only when the
  // backend does not yet return wizard_steps.
  const apiSteps = status?.wizard_steps || [];
  const API_DETAIL: Record<string, string> = {
    meta_business: WIZARD_SPEC[0].detail,
    dedicated_number: WIZARD_SPEC[2].detail,
    env_vars: 'اضبط المتغيرات في Render فقط (Environment ← Add Environment Variable ثم Redeploy): WHATSAPP_VERIFY_TOKEN وWHATSAPP_APP_SECRET وWHATSAPP_ACCESS_TOKEN وWHATSAPP_PHONE_NUMBER_ID وWHATSAPP_BUSINESS_ACCOUNT_ID وWHATSAPP_API_VERSION وAPP_BASE_URL. لا تلصق أي قيمة هنا — لا يوجد حقل رمز أو سر في هذه الواجهة عمداً.',
    webhook: WIZARD_SPEC[4].detail,
    meta_connection: 'يتحقق الخادم من الرمز الدائم لدى Meta بقراءة فقط — دون عرض الرمز أو حفظه هنا. إذا رُفض الرمز، يعيد المالك إنشاء System User Token ولصقه في بيئة الاستضافة فقط.',
    templates: WIZARD_SPEC[6].detail,
    test_message: WIZARD_SPEC[5].detail,
  };
  const steps = apiSteps.length
    ? apiSteps.map((s) => ({ key: s.key, title: s.title_ar, status: s.status, detail: API_DETAIL[s.key] || 'خطوة ربط من الخادم — اتبع إرشادات Meta في حساب العميل لإكمالها.' }))
    : WIZARD_SPEC.map((spec) => {
        let derived: 'done' | 'pending' | 'blocked' = 'pending';
        if (spec.key === 'app_token') derived = status?.whatsapp_access_configured ? 'done' : 'pending';
        if (spec.key === 'webhook') derived = status && status.webhook_verify_configured && status.webhook_hmac_configured ? 'done' : 'pending';
        if (spec.key === 'templates_approval') derived = status && status.templates_total > 0 && status.templates_meta_approved !== undefined && status.templates_meta_approved >= status.templates_total ? 'done' : 'pending';
        if (spec.key === 'waba') derived = status?.waba_configured ? 'done' : 'pending';
        if (spec.key === 'dedicated_number') derived = status?.phone_number_configured ? 'done' : 'pending';
        return { key: spec.key, title: spec.fallbackTitle, status: derived, detail: spec.detail };
      });
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const blockedCount = steps.filter((s) => s.status === 'blocked').length;
  const stepTone = (s: string) => s === 'done' ? 'ok' as const : s === 'blocked' ? 'bad' as const : 'warn' as const;
  const stepAr = (s: string) => s === 'done' ? 'مكتمل' : s === 'blocked' ? 'متعذّر' : 'بانتظار';
  const webhookUrl = status?.app_base_url ? status.app_base_url.replace(/\/$/, '') + '/api/whatsapp/webhook' : LIVE_WEBHOOK_EXAMPLE;
  async function testToken() {
    setTestingToken(true); setTokenMsg('');
    try { const r = await api.whatsappTestToken();
      if (r.meta_ok) setTokenMsg(`نتيجة اختبار الرمز: ناجح — الرمز مضبوط ومقبول لدى Meta.${r.dry_run ? ' (وضع تجريبي).' : ''} لم يُعرض الرمز ولم يُحفظ في أي مكان.`);
      else setTokenMsg(`نتيجة اختبار الرمز: ${r.dry_run ? 'وضع تجريبي — Meta غير موصول، لم يُجرَ اختبار حقيقي. ' : 'فشل — '}${!r.configured ? 'الرمز غير مضبوط في بيئة الاستضافة. اضبط WHATSAPP_ACCESS_TOKEN في Render ثم أعد النشر.' : r.error || 'الرمز مرفوض من Meta — على المالك إعادة إنشاء الرمز الدائم (System User Token) وإعادة لصقه في بيئة الاستضافة فقط.'} لم يُعرض أي رمز.`);
    } catch (err) { setTokenMsg('خطأ في اختبار الرمز: ' + (err as Error).message + ' — إذا كان الخادم لا يوفّر هذا الـ endpoint بعد، فالواجهة جاهزة والخادم ما زال قيد التنفيذ.'); }
    finally { setTestingToken(false); }
  }
  async function sendTest(e: React.FormEvent) {
    e.preventDefault(); setSending(true); setTestMsg('');
    if (!sendForm.to.trim()) { setTestMsg('أدخل رقم المستقبل بصيغة دولية.'); setSending(false); return; }
    try {
      const payload = sendForm.mode === 'template'
        ? { to: sendForm.to.trim(), template_name: sendForm.template_name, language: 'ar' }
        : { to: sendForm.to.trim(), body: sendForm.body.trim() };
      if (sendForm.mode === 'text' && !sendForm.body.trim()) { setTestMsg('أدخل نص الرسالة أو اختر «قالب».'); setSending(false); return; }
      if (sendForm.mode === 'template' && !sendForm.template_name) { setTestMsg('اختر قالباً.'); setSending(false); return; }
      const r = await api.whatsappSend(payload);
      if (r.ok) setTestMsg(`نتيجة الإرسال: ${r.dry_run ? 'لم يُرسل إلى واتساب — وضع تجريبي لأن Meta غير موصول. (تمت المحاكاة محلياً فقط.)' : `أُرسل إلى واتساب — معرّف الرسالة: ${r.wamid || r.message_id || '—'}.`}`);
      else if (r.error === 'outside_24h_window_use_template') setTestMsg('لم يُرسل: خارج نافذة 24 ساعة — لا يمكن إرسال نص حر الآن. أرسل قالباً معتمداً لدى Meta بدل النص الحر (اختر «قالب» أعلاه)، أو انتظر رسالة جديدة من العميل تفتح نافذة جديدة.');
      else if (r.error === 'template_not_approved') setTestMsg('لم يُرسل: القالب غير معتمد محلياً لدى الخادم — الخادم يرفض إرسال قالب حالته المحلية ليست «معتمد». راجع حالتي القالب في تبويب «القوالب» (المحلية وMeta) قبل إعادة المحاولة.');
      else if (r.error === 'template_not_found') setTestMsg('لم يُرسل: القالب غير موجود في الخادم — اختر قالباً من القائمة.');
      else setTestMsg(`لم يُرسل: ${r.error || 'خطأ غير معروف'}.`);
    } catch (err) { setTestMsg('خطأ في الإرسال: ' + (err as Error).message + ' — إذا كان الخادم لا يوفّر هذا الـ endpoint بعد، فالواجهة جاهزة والخادم ما زال قيد التنفيذ.'); }
    finally { setSending(false); }
  }
  return <>
    <Card title={`معالج ربط واتساب — ${steps.length} خطوات`} sub={`مكتمل: ${doneCount} من ${steps.length}${blockedCount ? ` — متعذّر: ${blockedCount}` : ''} — الحالة من الخادم (GET /api/whatsapp/status)، وليست من المتصفح. لا يوجد هنا أي حقل لإدخال رمز أو سر.`}>
      {!status && <p className="muted">{err ? 'تعذر جلب حالة الربط: ' + err : 'جارٍ جلب حالة الربط من الخادم…'}</p>}
      {status && !status.wizard_steps && <p className="local-note">الخادم الحالي لا يرسل wizard_steps بعد — الخطوات أدناه مشتقة من الحقول القديمة فقط (بانتظار ما لم يثبته الخادم)، وستُعرض حالة الخادم الحقيقية فور توفر الـ endpoint الجديد.</p>}
      <ol className="wizard">
        {steps.map((s, i) => <li key={s.key} className="wizard-step">
          <div className="wizard-head"><b>{i + 1}. {s.title}</b><Badge tone={stepTone(s.status)}>{stepAr(s.status)}</Badge></div>
          <p className="muted">{s.detail}</p>
          {(s.key === 'app_token' || s.key === 'meta_connection') && <>
            <p className="local-note">⚠️ اضبط WHATSAPP_ACCESS_TOKEN (وأي متغير آخر) في Render فقط: Environment ← Add Environment Variable ثم Redeploy. لا تلصق أي رمز في هذا النموذج — لا يوجد حقل رمز هنا عمداً، ولا يُعرض الرمز أبداً.</p>
            {canEdit && <div className="btn-row"><button className="btn" disabled={testingToken} onClick={testToken}>{testingToken ? 'جارٍ الاختبار…' : 'اختبار الرمز (Test Token)'}</button></div>}
            {!canEdit && <p className="muted">اختبار الرمز يتطلب صلاحية تعديل واتساب (whatsapp:edit).</p>}
            {tokenMsg && <p className="msg">{tokenMsg}</p>}
          </>}
          {s.key === 'env_vars' && <p className="local-note">⚠️ القيم تُضبط في Render فقط ثم يُعاد النشر — لا يوجد حقل لإدخال أي قيمة هنا، ولا تُعرض أي قيمة أبداً. بعد ضبطها، اضغط «اختبار الرمز» في خطوة اختبار اتصال Meta.</p>}
          {s.key === 'webhook' && <>
            <p>عنوان Webhook الكامل: <code>{webhookUrl}</code></p>
            {!status?.app_base_url && <p className="muted">الخادم لا يرسل APP_BASE_URL بعد — العنوان أعلاه مثال بالنطاق الحي الحالي (https://pilot-system-z5vc.onrender.com). إن كان نطاقك الحي مختلفاً، استخدم نطاقك أنت واحتفظ بالمسار /api/whatsapp/webhook.</p>}
            <ul>
              <li>رمز التحقق (Verify Token) مضبوط: {status ? (status.webhook_verify_configured ? 'نعم' : 'لا') : 'جارٍ الجلب…'}</li>
              <li>توقيع HMAC (App Secret) مضبوط: {status ? (status.webhook_hmac_configured ? 'نعم' : 'لا') : 'جارٍ الجلب…'}</li>
            </ul>
            <p className="muted">تُعرض هنا حالة الضبط فقط (نعم/لا) — لا تُعرض أي قيمة أبداً.</p>
          </>}
          {s.key === 'test_message' && <>
            {canEdit ? <form className="grid2" onSubmit={sendTest}>
              <Field label="رقم المستقبل (صيغة دولية، بدون + وبدون مسافات)"><input required value={sendForm.to} onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })} placeholder="مثال: 9677xxxxxxxx" /></Field>
              <Field label="نوع الرسالة"><select value={sendForm.mode} onChange={(e) => setSendForm({ ...sendForm, mode: e.target.value as 'text' | 'template' })}><option value="text">نص حر (داخل نافذة 24 ساعة فقط)</option><option value="template">قالب معتمد (خارج النافذة أيضاً)</option></select></Field>
              {sendForm.mode === 'text'
                ? <div style={{ gridColumn: '1 / -1' }}><Field label="نص الرسالة"><textarea rows={3} value={sendForm.body} onChange={(e) => setSendForm({ ...sendForm, body: e.target.value })} /></Field></div>
                : <Field label="القالب"><select value={sendForm.template_name} onChange={(e) => setSendForm({ ...sendForm, template_name: e.target.value })}><option value="">— اختر قالباً —</option>{b.templates.map((t) => <option key={t.id} value={t.name}>{t.name} ({TEMPLATE_AR[t.name] || t.name}) — حالة Meta: {t.meta_status || 'غير معروفة'}، حالة محلية: {t.approval_status}</option>)}</select></Field>}
              <button className="btn" type="submit" disabled={sending}>{sending ? 'جارٍ الإرسال…' : 'إرسال رسالة اختبار'}</button>
            </form> : <p className="muted">إرسال رسالة الاختبار يتطلب صلاحية تعديل واتساب (whatsapp:edit).</p>}
            {testMsg && <p className="msg">{testMsg}</p>}
          </>}
          {(s.key === 'templates_approval' || s.key === 'templates') && <p className="muted">قوالب معتمدة لدى Meta: {status?.templates_meta_approved === undefined ? 'غير معروف (الخادم القديم لا يرسل هذا الحقل)' : `${status.templates_meta_approved} من ${status.templates_total}`} — التفاصيل في تبويب «القوالب».</p>}
        </li>)}
      </ol>
      <div className="btn-row"><button className="btn ghost" onClick={refresh}>تحديث الحالة من الخادم</button></div>
      <p className="muted">قواعد ثابتة: لا محفظة داخلية، لا متجر، لا إجراء مالي آلي، واجهة العميل واتساب فقط، رقم مخصص للخدمة، بدون وسيط (BSP)، وكل الحسابات باسم العميل.</p>
    </Card>
  </>;
}

/* ---------------- System settings ---------------- */
export function SystemSettings() {
  return <Card title="إعدادات النظام" sub="إعدادات أمنية ثابتة — تُضبط في بيئة الخادم فقط، وليس من هذه الواجهة.">
    <ul>
      <li>انتهاء رمز الدخول: 8 ساعات، موقّع بـ HMAC مع <code>JWT_SECRET</code> (عند غيابه يستخدم الخادم سراً عشوائياً لكل عملية تشغيل مع تحذير — لا يوجد سر افتراضي مكتوب).</li>
      <li>حد حجم جسم الطلب: 1 MB (أكبر يُرفض بـ 413).</li>
      <li>حد محاولات الدخول الفاشلة: 10 محاولات لكل عنوان IP كل 15 دقيقة، ورسالة خطأ واحدة عامة لكل فشل.</li>
      <li>ترويسات الأمان على كل رد: CSP، X-Content-Type-Options، X-Frame-Options، Referrer-Policy، وCache-Control: no-store على /api.</li>
      <li>سجل التدقيق إلحاقي فقط (GET فقط)، وكلمات السر scrypt فقط، ولا تُعاد تجزئة كلمة سر إلى الواجهة أبداً.</li>
      <li>المسؤول الأساسي يُزرع عند أول تشغيل فقط عندما تكون <code>ADMIN_EMAIL</code> و<code>ADMIN_INITIAL_PASSWORD</code> مضبوطتين في البيئة — لا توجد بيانات دخول مكتوبة في أي ملف.</li>
    </ul>
    <p className="muted">إذا لم تُضبط متغيرات المسؤول قبل أول تشغيل ولم يوجد أي مستخدم، لن يستطيع أحد الدخول — أعد التشغيل والمتغيرات مضبوطة قبل إنشاء أي مستخدم.</p>
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
