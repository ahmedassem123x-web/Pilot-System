import { useEffect, useMemo, useState } from 'react';
import { api, local, type AutomationRule, type WhatsAppStatus } from './api';
import { WhatsAppWorkspace } from './whatsapp-workspace';
import { Badge, Card, Empty, Field, LocalNote, fmt, stateTone } from './components';
import { IconChat, IconCheckSquare, IconDoc, IconInbox, IconPower, IconTemplate } from './icons';
import {
  ACTION_AR, CONTRACT_TYPE_AR, DEPARTMENTS, ROLE_AR, ROLES, SECTIONS_AR, SECTIONS_LIST, STATE_AR, TEMPLATE_AR, TRANSITIONS,
  type AuditEntry, type Contact, type ContactImportReport, type Contract, type Conversation, type EmbeddedSignupConfig, type MeUser, type Message, type State, type Template, type User, type Workflow,
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
  tasks: { id: number; contract_id: number; title: string; type: string; status: string; financial_reference?: string; assigned_to?: string | null }[];
  workflows: Workflow[]; templates: Template[]; users: User[]; audit: AuditEntry[];
  killSwitch: boolean; healthOk: boolean;
}
export function contractById(b: Bundle, id: number) { return b.contracts.find((c) => c.id === id); }

/* ---------------- Dashboard ---------------- */
export function Dashboard({ b, reload, onOpenDesigner }: { b: Bundle; reload: () => void; onOpenDesigner?: () => void }) {
  const openTasks = b.tasks.filter((t) => (local.taskOverrides()[t.id] || t.status) === 'open').length;
  const realConvs = b.conversations.filter((c) => !c.is_demo);
  const unread = realConvs.reduce((s, c) => s + (c.unread_count || 0), 0);
  const byState = useMemo(() => {
    const m: Record<string, number> = {}; b.contracts.forEach((c) => { m[c.state] = (m[c.state] || 0) + 1; }); return m;
  }, [b.contracts]);
  const realContracts = b.contracts.filter((c) => !c.is_demo);
  const latest = [...realContracts].slice(-5).reverse();
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
      <div className="stat"><div className="stat-top"><b>{realContracts.length}</b><span className="stat-icon-box"><IconDoc /></span></div><span className="stat-label">إجمالي العقود</span><span className="stat-sub">جميع الحالات — من الخادم، التجريبي لا يُحتسب</span></div>
      <div className="stat"><div className="stat-top"><b>{realConvs.length}</b><span className="stat-icon-box"><IconChat /></span></div><span className="stat-label">محادثات</span><span className="stat-sub">محادثة مستقلة لكل طرف في كل عقد — التجريبية لا تُحتسب</span></div>
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
        realConvs.forEach((c) => { if (c.assigned_to) byAssignee[c.assigned_to] = (byAssignee[c.assigned_to] || 0) + 1; });
        const entries = Object.entries(byAssignee);
        return entries.length === 0 ? <Empty text="لا محادثات مكلَّف بها بعد — التعيين يتم من صفحة الإنبكس." /> :
          <div className="chips">{entries.map(([name, n]) => <span key={name} className="chip">{name}: {n} محادثة</span>)}</div>;
      })()}
      <p className="muted">محادثات مفتوحة: {realConvs.filter((c) => c.status === 'open' || c.status === 'new').length} — مهام مفتوحة: {openTasks} — رسائل غير مقروءة: {unread}</p>
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
  const [form, setForm] = useState({ buyer_phone: '', seller_phone: '', product_description: '', amount: '', currency: 'SAR', delivery_point: '', contract_type: 'general', quantity: '', specifications: '', service_duration: '', delivery_stages: '' });
  const [signing, setSigning] = useState<{ pdf_sent_at: string | null; buyer_signed: boolean; seller_signed: boolean; both_signed: boolean } | null>(null);
  const [signParty, setSignParty] = useState<'buyer' | 'seller'>('buyer');
  const [signFile, setSignFile] = useState('');
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('all');
  const [selId, setSelId] = useState<number | null>(null);
  useEffect(() => { if (selId) api.contractSigning(selId).then(setSigning).catch(() => setSigning(null)); else setSigning(null); }, [selId]);
  const [fiRef, setFiRef] = useState('');
  const [actor, setActor] = useState('operator');
  const [amend, setAmend] = useState({ product_description: '', amount: '', delivery_point: '' });
  const sel = b.contracts.find((c) => c.id === selId) || null;
  const list = b.contracts.filter((c) => filter === 'all' || c.state === filter);
  const drafts = local.amendDrafts(); const atts = local.attachments();

  async function create(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    try {
      const c = await api.createContract({ buyer_phone: form.buyer_phone, seller_phone: form.seller_phone, product_description: form.product_description, amount: Number(form.amount), currency: form.currency, delivery_point: form.delivery_point || undefined, contract_type: form.contract_type, quantity: form.quantity.trim() || undefined, specifications: form.specifications.trim() || undefined, service_duration: form.service_duration.trim() || undefined, delivery_stages: form.delivery_stages.trim() || undefined });
      setMsg(`تم إنشاء العقد ${c.code} بحالة مسودة — نوعه: ${CONTRACT_TYPE_AR[form.contract_type]}.`); setForm({ buyer_phone: '', seller_phone: '', product_description: '', amount: '', currency: 'SAR', delivery_point: '', contract_type: 'general', quantity: '', specifications: '', service_duration: '', delivery_stages: '' }); reload();
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
        <Field label="نوع العقد — يحدد صيغة PDF"><select value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}><option value="goods_sale">بيع بضاعة</option><option value="service">تقديم خدمة</option><option value="supply">توريد</option><option value="general">تنفيذ صفقة عام</option></select></Field>
        <Field label="الكمية (بيع بضاعة)"><input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="مثال: 50 قطعة" /></Field>
        <Field label="المواصفات (بيع بضاعة)"><input value={form.specifications} onChange={(e) => setForm({ ...form, specifications: e.target.value })} /></Field>
        <Field label="مدة الخدمة (تقديم خدمة)"><input value={form.service_duration} onChange={(e) => setForm({ ...form, service_duration: e.target.value })} placeholder="مثال: 30 يوماً" /></Field>
        <Field label="مراحل/دفعات التوريد (توريد)"><input value={form.delivery_stages} onChange={(e) => setForm({ ...form, delivery_stages: e.target.value })} placeholder="مثال: دفعتان — 60% ثم 40%" /></Field>
        <button className="btn" type="submit">إنشاء العقد</button>
      </form>
      <div className="btn-row">
        {b.contracts.some((c) => c.is_demo)
          ? <><span className="wa-demo-badge">عقد تجريبي موجود</span><button className="btn small ghost" onClick={async () => { try { const r = await api.deleteDemoContract(); setMsg(`تم حذف العقد التجريبي — ${r.contracts_deleted} عقد.`); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>حذف العقد التجريبي</button></>
          : <button className="btn small ghost" onClick={async () => { try { const r = await api.createDemoContract(); setMsg(r.already ? 'العقد التجريبي موجود أصلاً.' : `تم إنشاء العقد التجريبي ${r.contract.code} — تجريبي فقط، لا يُحتسب في التقارير.`); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>إنشاء عقد تجريبي للعرض</button>}
      </div>
      <p className="muted">العقد التجريبي موسوم «تجريبي»، بلا عميل حقيقي، ولا يُحتسب في التقارير، ويُحذف بزر واحد — ليُحكم على النظام كاملاً قبل الربط مع Meta.</p>
      {msg && <p className="msg">{msg}</p>}
    </Card>}

    {showList && <Card title="العقود" actions={<select value={filter} onChange={(e) => setFilter(e.target.value)} className="inline-select"><option value="all">كل الحالات</option>{Object.entries(STATE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}>
      {list.length === 0 ? <Empty text="لا عقود مطابقة." /> :
        <div className="table-wrap"><table><thead><tr><th>الكود</th><th>النوع</th><th>المشتري / البائع</th><th>المنتج</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead>
        <tbody>{list.map((c) => <tr key={c.id} className={selId === c.id ? 'row-sel' : ''}>
          <td><b>{c.code}</b>{c.is_demo && <span className="wa-demo-badge"> تجريبي</span>}</td><td>{CONTRACT_TYPE_AR[c.contract_type || 'general']}</td><td><div className="small">{c.buyer_phone}</div><div className="small">{c.seller_phone}</div></td>
          <td>{c.product_description}</td><td>{c.amount} {c.currency}</td>
          <td><Badge tone={stateTone(c.state)}>{STATE_AR[c.state]}</Badge></td>
          <td><button className="btn small" onClick={() => { setSelId(c.id); setMsg(''); }}>تفاصيل</button> <button className="btn small ghost" onClick={() => openAmend(c)}>تعديل / إصدارات</button> <button className="btn small ghost" onClick={async () => { try { const blob = await api.downloadContractPdf(c.id); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `contract-${c.code}.pdf`; a.click(); URL.revokeObjectURL(url); setMsg(`تم تنزيل PDF العقد ${c.code}.`); } catch (err) { setMsg('خطأ في تنزيل PDF: ' + (err as Error).message); } }}>تنزيل PDF</button></td>
        </tr>)}</tbody></table></div>}
    </Card>}

    {showList && sel && <Card title={`تفاصيل ${sel.code}${sel.is_demo ? ' — تجريبي' : ''}`} sub={`بصمة البنود (SHA-256): ${sel.clause_fingerprint}`} actions={<button className="btn small" onClick={async () => { try { const blob = await api.downloadContractPdf(sel.id); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `contract-${sel.code}.pdf`; a.click(); URL.revokeObjectURL(url); setMsg(`تم تنزيل PDF العقد ${sel.code}.`); } catch (err) { setMsg('خطأ في تنزيل PDF: ' + (err as Error).message); } }}>تنزيل العقد PDF</button>}>
      <div className="grid2">
        <p><b>المنتج:</b> {sel.product_description}</p><p><b>المبلغ:</b> {sel.amount} {sel.currency}</p>
        <p><b>المشتري:</b> {sel.buyer_phone}</p><p><b>البائع:</b> {sel.seller_phone}</p>
        <p><b>نقطة التسليم:</b> {sel.delivery_point || '—'}</p><p><b>أُنشئ:</b> {fmt(sel.created_at)}</p>
        {sel.version !== undefined && <p><b>إصدار العقد (من الخادم):</b> v{sel.version}</p>}
      </div>
      <h3>نوع العقد وصيغة PDF</h3>
      <p><b>النوع:</b> {CONTRACT_TYPE_AR[sel.contract_type || 'general']}{sel.quantity ? ` — الكمية: ${sel.quantity}` : ''}{sel.specifications ? ` — المواصفات: ${sel.specifications}` : ''}{sel.service_duration ? ` — مدة الخدمة: ${sel.service_duration}` : ''}{sel.delivery_stages ? ` — مراحل التوريد: ${sel.delivery_stages}` : ''}</p>
      <h3>تدفق التوقيع على PDF</h3>
      <p className="small">الخطوات: 1) نزّل PDF العقد من الأعلى وأرسله للطرف. 2) يملأ الطرف بياناته ويوقّع. 3) يرسل لنا PDF الموقّع فنرفعه هنا كنسخة منفصلة — الأصل المقفل لا يُستبدل أبداً. {signing ? <>حالة الإرسال: {signing.pdf_sent_at ? `أُرسل ${signing.pdf_sent_at.slice(0, 10)}` : 'لم يُسجَّل إرساله بعد'} • توقيع المشتري: {signing.buyer_signed ? 'موقّع' : 'بانتظار'} • توقيع البائع: {signing.seller_signed ? 'موقّع' : 'بانتظار'} • {signing.both_signed ? 'موقّع من الطرفين' : 'لم يكتمل التوقيع بعد'}.</> : 'جارٍ جلب حالة التوقيع…'}</p>
      <div className="btn-row">
        <button className="btn small" onClick={async () => { try { const r = await api.sendContractPdf(sel.id); setMsg(r.already ? 'إرسال PDF مسجَّل أصلاً لهذا العقد.' : 'تم تسجيل إرسال PDF العقد — بانتظار النسخة الموقعة.'); const sg = await api.contractSigning(sel.id); setSigning(sg); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تسجيل إرسال PDF</button>
        <select className="inline-select" value={signParty} onChange={(e) => setSignParty(e.target.value as 'buyer' | 'seller')}><option value="buyer">نسخة موقعة من المشتري</option><option value="seller">نسخة موقعة من البائع</option></select>
        <input className="inline-input" placeholder="اسم ملف PDF الموقّع، مثال: signed-buyer.pdf" value={signFile} onChange={(e) => setSignFile(e.target.value)} />
        <button className="btn small ghost" onClick={async () => { if (!signFile.trim()) { setMsg('أدخل اسم ملف PDF الموقّع أولاً.'); return; } try { await api.uploadContractFile(sel.id, { filename: signFile.trim(), kind: signParty === 'buyer' ? 'buyer_signed' : 'seller_signed' }); setMsg('تم تسجيل النسخة الموقعة كإصدار منفصل — الأصل لم يتغير.'); setSignFile(''); const sg = await api.contractSigning(sel.id); setSigning(sg); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تسجيل النسخة الموقعة</button>
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
/* ---------------- Inbox: ONE component ---------------- */
// The inbox lives in exactly one place: WhatsAppWorkspace
// (frontend/src/whatsapp-workspace.tsx). This export is only the entry
// point used by every nav route (main Inbox tab and WhatsApp section);
// it does NOT duplicate the workspace. The 'notes' sub-view is the
// internal-notes filter over the same messages.
export function Inbox({ b, reload, me }: { b: Bundle; reload: () => void; me: MeUser | null }) {
  // Round 3: the triptych IS the inbox. The old notes card and the old
  // sub-tab views are DELETED — notes live in the thread (as system
  // notices) and in the details panel, filters live in the list header.
  return <WhatsAppWorkspace b={b} reload={reload} me={me} />;
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
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const filteredTemplates = b.templates.filter((t) => {
    const hay = `${t.name} ${(TEMPLATE_AR[t.name] || '')} ${t.body || ''}`.toLowerCase();
    if (q.trim() && !hay.includes(q.trim().toLowerCase())) return false;
    if (statusFilter === 'sendable') return t.approval_status === 'approved' && t.meta_status === 'approved';
    if (statusFilter === 'local_approved') return t.approval_status === 'approved';
    if (statusFilter === 'meta_approved') return t.meta_status === 'approved';
    if (statusFilter === 'not_submitted') return t.meta_status === 'not_submitted';
    return true;
  });
  const [form, setForm] = useState({ name: '', body: '', buttons: '', header_type: '', header_text: '', header_link: '', footer: '', sample_values: '' });
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ body: '', header_type: '', header_text: '', header_link: '', footer: '', buttons: '', sample_values: '' });
  const previewOf = (t: Template) => String(t.body || '').replace(/\{\{(\d+)\}\}/g, (_, n) => (t.sample_values || [])[Number(n) - 1] || `[مثال ${n}]`);
  const sendableOf = (t: Template) => t.approval_status === 'approved' && t.meta_status === 'approved';
  async function startEdit(t: Template) {
    setBusy(true); setMsg('');
    try { const full = await api.getWhatsAppTemplate(t.id); setEditId(t.id);
      setEditForm({ body: full.body || '', header_type: full.header_type || '', header_text: full.header_text || '', header_link: full.header_link || '', footer: full.footer || '', buttons: Array.isArray(full.buttons) ? (full.buttons as { title?: string }[]).map((x) => typeof x === 'string' ? x : (x.title || '')).join(', ') : '', sample_values: (full.sample_values || []).join(', ') });
      if (full.preview) setMsg(`معاينة القالب «${t.name}»: ${full.preview}`); }
    catch (err) { setMsg('خطأ في جلب القالب: ' + (err as Error).message); }
    finally { setBusy(false); }
  }
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
      <div className="btn-row">
        <input className="inline-input" placeholder="بحث بالاسم أو الوصف أو نص القالب" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inline-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">كل الحالات</option><option value="sendable">قابلة للإرسال فقط</option>
          <option value="local_approved">معتمدة محلياً</option><option value="meta_approved">معتمدة لدى Meta</option>
          <option value="not_submitted">غير مقدَّمة إلى Meta</option>
        </select>
      </div>
      {b.templates.length === 0 ? <Empty text="لا قوالب — تُزرع القوالب العشرة تلقائياً عند أول تشغيل للخادم." /> :
      filteredTemplates.length === 0 ? <Empty text="لا قوالب مطابقة للبحث أو التصفية الحالية." /> :
        <div className="table-wrap"><table><thead><tr><th>اسم القالب</th><th>الوصف</th><th>اللغة</th><th>الفئة</th><th>الحالة المحلية (LOCAL)</th><th>حالة Meta</th><th>نص القالب</th><th>المعاينة (بقيم الأمثلة)</th><th>قابل للإرسال</th>{canEdit && <th>تحديث محلي / تقديم / تعديل مسودة</th>}</tr></thead>
        <tbody>{filteredTemplates.map((t) => <tr key={t.id}><td><code>{t.name}</code></td><td>{TEMPLATE_AR[t.name] || '—'}</td><td>{t.language}</td><td>{t.category}</td>
          <td><Badge tone={localTone(t.approval_status)}>{localAr(t.approval_status)}</Badge></td>
          <td><Badge tone={metaTone(t.meta_status)}>{metaAr(t.meta_status)}</Badge>{t.rejection_reason ? <div className="small">سبب الرفض: {t.rejection_reason}</div> : null}</td>
          <td>{t.header_type ? <div className="small">ترويسة: {t.header_type}{t.header_text ? ` — ${t.header_text}` : ''}{t.header_link ? ` — ${t.header_link}` : ''}</div> : null}{t.body ? <span className="small">{t.body}</span> : <span className="muted">— لا نص محفوظ في الخادم —</span>}{t.footer ? <div className="small">تذييل: {t.footer}</div> : null}</td>
          <td><span className="small">{t.body ? previewOf(t) : '—'}</span></td>
          <td>{sendableOf(t) ? <Badge tone="ok">قابل للإرسال</Badge> : <><Badge tone="warn">غير قابل</Badge><div className="small">{t.approval_status !== 'approved' ? 'يحتاج اعتماداً محلياً' : 'يحتاج موافقة Meta (عند اتصال Meta)'}</div></>}</td>
          {canEdit && <td><select className="inline-select" value={t.approval_status} onChange={async (e) => {
            try { await api.updateTemplate(t.id, e.target.value); setMsg(`تم تحديث الحالة المحلية (فقط) لقالب ${t.name} إلى ${localAr(e.target.value)} — هذا لا يغيّر حالة Meta.`); reload?.(); }
            catch (err) { setMsg('خطأ: ' + (err as Error).message); }
          }}><option value="pending">بانتظار (محلي)</option><option value="approved">معتمد (محلي)</option><option value="rejected">مرفوض (محلي)</option></select>{' '}
          <button className="btn small" disabled={busy} onClick={() => submitToMeta(t)}>تقديم إلى Meta</button>{' '}
          {(t.meta_status !== 'approved' && t.meta_status !== 'pending') && <button className="btn small ghost" disabled={busy} onClick={() => startEdit(t)}>تعديل المسودة</button>}</td>}</tr>)}</tbody></table></div>}
      {canEdit && editId !== null && <Card title="تعديل مسودة قالب" sub="التعديل متاح فقط للمسودات غير المقدَّمة أو المرفوضة لدى Meta — القالب المعتمد أو قيد المراجعة لدى Meta لا يُعدَّل من هنا؛ أنشئ إصداراً جديداً بدلاً منه.">
        <form className="grid2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
          const buttons = editForm.buttons.split(',').map((x) => x.trim()).filter(Boolean);
          const samples = editForm.sample_values.split(',').map((x) => x.trim()).filter(Boolean);
          await api.updateWhatsAppTemplate(editId, { body: editForm.body.trim(), header_type: editForm.header_type || null, header_text: editForm.header_text.trim() || null, header_link: editForm.header_link.trim() || null, footer: editForm.footer.trim() || null, buttons, sample_values: samples });
          setMsg('تم تعديل المسودة.'); setEditId(null); reload?.();
        } catch (err) { setMsg('خطأ في تعديل المسودة: ' + (err as Error).message); } finally { setBusy(false); } }}>
          <Field label="نص القالب"><textarea rows={4} required value={editForm.body} onChange={(e) => setEditForm({ ...editForm, body: e.target.value })} /></Field>
          <Field label="نوع الترويسة"><select value={editForm.header_type} onChange={(e) => setEditForm({ ...editForm, header_type: e.target.value })}><option value="">بدون ترويسة</option><option value="text">نص</option><option value="image">صورة</option><option value="video">فيديو</option><option value="document">مستند</option></select></Field>
          <Field label="نص الترويسة (عند نوع نص)"><input value={editForm.header_text} onChange={(e) => setEditForm({ ...editForm, header_text: e.target.value })} /></Field>
          <Field label="رابط وسائط الترويسة (صورة/فيديو/مستند)"><input value={editForm.header_link} onChange={(e) => setEditForm({ ...editForm, header_link: e.target.value })} /></Field>
          <Field label="تذييل (حتى 60 حرفاً)"><input value={editForm.footer} onChange={(e) => setEditForm({ ...editForm, footer: e.target.value })} /></Field>
          <Field label="أزرار (عناوين مفصولة بفواصل، حتى 3)"><input value={editForm.buttons} onChange={(e) => setEditForm({ ...editForm, buttons: e.target.value })} /></Field>
          <Field label="قيم أمثلة للمتغيرات (مفصولة بفواصل، بالترتيب)"><input value={editForm.sample_values} onChange={(e) => setEditForm({ ...editForm, sample_values: e.target.value })} /></Field>
          <button className="btn" type="submit" disabled={busy}>حفظ تعديل المسودة</button>{' '}<button className="btn ghost" type="button" onClick={() => setEditId(null)}>إلغاء</button>
        </form>
      </Card>}
      {msg && <p className="msg">{msg}</p>}
    </Card>
    {canEdit && <Card title="إنشاء قالب جديد (مسودة محلية)" sub="يُنشأ كمسودة محلية بحالة Meta «غير مقدَّم» — لا يصبح قابلاً للإرسال خارج النافذة إلا بعد تقديمه وموافقة Meta عليه. لا توجد هنا أي بيانات سرية.">
      <form className="grid2" onSubmit={async (e) => { e.preventDefault(); if (!/^[a-z0-9_]+$/.test(form.name.trim())) { setMsg('اسم القالب: أحرف صغيرة وأرقام وشرطات سفلية فقط.'); return; } if (!form.body.trim()) { setMsg('أدخل نص القالب.'); return; } setBusy(true); try {
        const buttons = form.buttons.split(',').map((x) => x.trim()).filter(Boolean);
        const samples = form.sample_values.split(',').map((x) => x.trim()).filter(Boolean);
        const t = await api.createWhatsAppTemplate({ name: form.name.trim(), category: 'UTILITY', language: 'ar', body: form.body.trim(), ...(buttons.length ? { buttons } : {}), ...(form.header_type ? { header_type: form.header_type } : {}), ...(form.header_text.trim() ? { header_text: form.header_text.trim() } : {}), ...(form.header_link.trim() ? { header_link: form.header_link.trim() } : {}), ...(form.footer.trim() ? { footer: form.footer.trim() } : {}), ...(samples.length ? { sample_values: samples } : {}) });
        setMsg(`تم إنشاء مسودة القالب «${t.name}» — حالة Meta: غير مقدَّم. قدّمه من الجدول أعلاه بعد مراجعة نصه.`); setForm({ name: '', body: '', buttons: '', header_type: '', header_text: '', header_link: '', footer: '', sample_values: '' }); reload?.();
      } catch (err) { setMsg('خطأ في إنشاء القالب: ' + (err as Error).message + ' — إذا كان الخادم لا يوفّر هذا الـ endpoint بعد، فالواجهة جاهزة والخادم ما زال قيد التنفيذ.'); } finally { setBusy(false); } }}>
        <Field label="اسم القالب (أحرف صغيرة وأرقام و_ فقط)"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: order_update" /></Field>
        <Field label="الفئة (ثابتة)"><input disabled value="UTILITY — إشعار معاملة (Utility)" /></Field>
        <Field label="اللغة (ثابتة)"><input disabled value="ar — العربية" /></Field>
        <Field label="أزرار (اختياري — عناوين مفصولة بفواصل)"><input value={form.buttons} onChange={(e) => setForm({ ...form, buttons: e.target.value })} placeholder="مثال: تأكيد، تواصل مع الدعم" /></Field>
        <Field label="نوع الترويسة"><select value={form.header_type} onChange={(e) => setForm({ ...form, header_type: e.target.value })}><option value="">بدون ترويسة</option><option value="text">نص</option><option value="image">صورة</option><option value="video">فيديو</option><option value="document">مستند</option></select></Field>
        <Field label="نص الترويسة (عند نوع نص)"><input value={form.header_text} onChange={(e) => setForm({ ...form, header_text: e.target.value })} /></Field>
        <Field label="رابط وسائط الترويسة (صورة/فيديو/مستند)"><input value={form.header_link} onChange={(e) => setForm({ ...form, header_link: e.target.value })} /></Field>
        <Field label="تذييل (حتى 60 حرفاً)"><input value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} /></Field>
        <Field label="قيم أمثلة للمتغيرات (مفصولة بفواصل، بالترتيب)"><input value={form.sample_values} onChange={(e) => setForm({ ...form, sample_values: e.target.value })} placeholder="مثال: PS-1001، 250" /></Field>
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

/* ---------------- Stage C: Contacts (contract-scoped only) ---------------- */
// No broadcast, no audience, no marketing: this address book only looks up
// the conversations and contracts that already exist for a phone. Utility
// eligibility is computed by the backend (prior inbound, or a template
// message actually sent via Meta) — creating a contact never grants it.
export function Contacts({ b, reload, me }: { b: Bundle; reload: () => void; me: MeUser | null }) {
  const canEdit = hasAction(me, 'whatsapp', 'edit');
  const [list, setList] = useState<Contact[]>([]);
  const [q, setQ] = useState('');
  const [segment, setSegment] = useState('all');
  const [role, setRole] = useState('all');
  const [lastContact, setLastContact] = useState('all');
  const [selId, setSelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Contact | null>(null);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', labels: '', notes: '' });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', labels: '', notes: '' });
  const [csvText, setCsvText] = useState('');
  const [report, setReport] = useState<ContactImportReport | null>(null);
  const load = async () => {
    try {
      const params: Record<string, string> = {};
      if (q.trim()) params.q = q.trim();
      if (segment !== 'all') params.segment = segment;
      if (role !== 'all') params.role = role;
      if (lastContact === '7d') params.last_contact_after = new Date(Date.now() - 7 * 86400000).toISOString();
      if (lastContact === '30d') params.last_contact_after = new Date(Date.now() - 30 * 86400000).toISOString();
      setList(await api.contacts(params));
    } catch { setList([]); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const segments = [...new Set(list.flatMap((c) => c.labels || []))];
  const sel = detail || list.find((c) => c.id === selId) || null;
  async function openDetail(c: Contact) {
    setSelId(c.id);
    try { setDetail(await api.getContact(c.id)); } catch { setDetail(c); }
  }
  async function submitCreate(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    if (!form.phone.trim()) { setMsg('رقم الهاتف مطلوب.'); return; }
    try {
      const c = await api.createContact({ name: form.name.trim() || undefined, phone: form.phone.trim(), labels: form.labels.split(',').map((x) => x.trim()).filter(Boolean), notes: form.notes.trim() || undefined });
      setMsg(`تم إنشاء جهة الاتصال «${c.name}» (${c.phone}).`); setForm({ name: '', phone: '', labels: '', notes: '' }); load(); reload();
    } catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  async function submitEdit(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    try {
      const c = await api.updateContact(editId!, { name: editForm.name.trim() || undefined, phone: editForm.phone.trim() || undefined, labels: editForm.labels.split(',').map((x) => x.trim()).filter(Boolean), notes: editForm.notes.trim() || undefined });
      setMsg(`تم تحديث جهة الاتصال «${c.name}».`); setEditId(null); setDetail(c); load(); reload();
    } catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  async function doExport() {
    try {
      const text = await api.exportContacts();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click();
      URL.revokeObjectURL(url); setMsg('تم تصدير جهات الاتصال كملف CSV.');
    } catch (err) { setMsg('خطأ في التصدير: ' + (err as Error).message); }
  }
  async function doImport(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    if (!csvText.trim()) { setMsg('الصق نص CSV أولاً (صف ترويسة + صفوف).'); return; }
    try {
      const r = await api.importContacts(csvText);
      setReport(r); setMsg(`نتيجة الاستيراد: أُنشئ ${r.created}، تُخطّي ${r.skipped} (مكرر)، أخطاء ${r.errors} من أصل ${r.total} صفاً.`); load(); reload();
    } catch (err) { setMsg('خطأ في الاستيراد: ' + (err as Error).message); }
  }
  return <>
    <div className="page-head"><h1>جهات الاتصال</h1><div className="btn-row"><button className="btn ghost" onClick={doExport}>تصدير CSV</button><button className="btn ghost" onClick={load}>تحديث</button></div></div>
    <Card title="جهات الاتصال — مرتبطة بالعقود فقط" sub="دفتر عناوين لعملاء لهم عقود أو محادثات قائمة — ليس جمهوراً إعلانياً، ولا يوجد هنا أي إرسال جماعي أو بث تسويقي أبداً. الصلاحية: whatsapp:view للعرض، whatsapp:edit للإنشاء والتعديل والاستيراد.">
      <p className="local-note">قاعدة أهلية رسائل Utility: جهة الاتصال تكون مؤهلة فقط إذا كان لها رسالة واردة سابقة، أو رسالة قالب أُرسلت فعلاً عبر Meta. إنشاء جهة الاتصال لا يمنح الأهلية، ولا ينشئ موافقة — وقواعد نافذة 24 ساعة والقوالب المعتمدة ما زالت تطبَّق على كل إرسال.</p>
      <div className="btn-row">
        <input className="inline-input" placeholder="بحث بالاسم أو الرقم أو التصنيف" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inline-select" value={segment} onChange={(e) => setSegment(e.target.value)}><option value="all">كل التصنيفات</option>{segments.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className="inline-select" value={role} onChange={(e) => setRole(e.target.value)}><option value="all">كل الأدوار</option><option value="buyer">مشتري في عقد</option><option value="seller">بائع في عقد</option></select>
        <select className="inline-select" value={lastContact} onChange={(e) => setLastContact(e.target.value)}><option value="all">كل تواريخ آخر تواصل</option><option value="7d">تواصل خلال 7 أيام</option><option value="30d">تواصل خلال 30 يوماً</option></select>
        <button className="btn small" onClick={load}>بحث وتصفية</button>
      </div>
      {list.length === 0 ? <Empty text="لا جهات اتصال مطابقة — أنشئ جهة اتصال من النموذج أدناه، أو استوردها من CSV. لا تُزرع أي جهات اتصال تجريبية تلقائياً." /> :
        <div className="table-wrap"><table><thead><tr><th>الاسم</th><th>الرقم</th><th>التصنيفات</th><th>دور العقد</th><th>آخر تواصل</th><th>أهلية Utility</th><th></th></tr></thead>
        <tbody>{list.map((c) => <tr key={c.id}>
          <td><b>{c.name}</b></td><td dir="ltr">{c.phone}</td><td>{(c.labels || []).join('، ') || '—'}</td>
          <td>{c.roles.length ? c.roles.map((r) => r === 'buyer' ? 'مشتري' : 'بائع').join(' + ') : 'بدون عقد'}</td>
          <td className="small">{fmt(c.last_contact_at)}</td>
          <td>{c.utility_eligible ? <Badge tone="ok">{c.eligibility_basis === 'prior_inbound' ? 'مؤهل — رسالة واردة سابقة' : 'مؤهل — تفاعل قالب معتمد'}</Badge> : <Badge tone="warn">غير مؤهل — لا تواصل سابق</Badge>}</td>
          <td><button className="btn small ghost" onClick={() => openDetail(c)}>التفاصيل</button></td>
        </tr>)}</tbody></table></div>}
      {msg && <p className="msg">{msg}</p>}
    </Card>
    {sel && <Card title={`تفاصيل: ${sel.name}`} sub={`الرقم: ${sel.phone} — الأهلية محسوبة من سجل التفاعل الفعلي، وليست إقراراً يدوياً.`}>
      <p>الأدوار في العقود: {sel.roles.length ? sel.roles.map((r) => r === 'buyer' ? 'مشتري' : 'بائع').join('، ') : 'لا يوجد عقد مرتبط بهذا الرقم.'}</p>
      <p>أهلية رسائل Utility: {sel.utility_eligible ? <Badge tone="ok">{sel.eligibility_basis === 'prior_inbound' ? 'مؤهل — رسالة واردة سابقة' : 'مؤهل — تفاعل قالب معتمد أُرسل عبر Meta'}</Badge> : <Badge tone="warn">غير مؤهل — لا رسالة واردة سابقة ولا تفاعل قالب مرسل عبر Meta</Badge>}</p>
      <p className="small">آخر تواصل: {fmt(sel.last_contact_at)} — عدد الرسائل (دون الملاحظات الداخلية): {sel.message_count}</p>
      {sel.contracts.length === 0 ? <Empty text="لا عقود مرتبطة بهذا الرقم — جهة الاتصال وحدها لا تنشئ عقداً." /> :
        <div className="table-wrap"><table><thead><tr><th>العقد</th><th>الدور</th><th>الحالة</th></tr></thead>
        <tbody>{sel.contracts.map((c) => <tr key={c.id}><td><b>{c.code}</b></td><td>{c.role === 'buyer' ? 'مشتري' : 'بائع'}</td><td><Badge tone={stateTone(c.state)}>{STATE_AR[c.state] || c.state}</Badge></td></tr>)}</tbody></table></div>}
      {sel.conversations.length === 0 ? <Empty text="لا محادثات مرتبطة بهذا الرقم بعد." /> :
        <div className="table-wrap"><table><thead><tr><th>المحادثة</th><th>الطرف</th><th>الحالة</th><th>غير مقروءة</th><th>آخر وارد</th></tr></thead>
        <tbody>{sel.conversations.map((c) => <tr key={c.id}><td>{c.contract_id ? `عقد ${c.contract_id}` : 'محادثة عامة'}</td><td>{c.party === 'buyer' ? 'مشتري' : c.party === 'seller' ? 'بائع' : 'عام'}</td><td>{c.status}</td><td>{c.unread_count}</td><td className="small">{fmt(c.last_inbound_at)}</td></tr>)}</tbody></table></div>}
      {sel.notes && <p className="muted">ملاحظات: {sel.notes}</p>}
      {canEdit && <div className="btn-row">
        <button className="btn small" onClick={() => { setEditId(sel.id); setEditForm({ name: sel.name, phone: sel.phone, labels: (sel.labels || []).join(', '), notes: sel.notes || '' }); }}>تعديل</button>
        <button className="btn small danger" onClick={async () => { try { await api.deleteContact(sel.id); setMsg(`تم حذف جهة الاتصال «${sel.name}».`); setDetail(null); setSelId(null); load(); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>حذف</button>
        <button className="btn small ghost" onClick={() => { setDetail(null); setSelId(null); }}>إغلاق التفاصيل</button>
      </div>}
      {!canEdit && <p className="muted">التعديل والحذف يتطلبان صلاحية تعديل واتساب (whatsapp:edit).</p>}
    </Card>}
    {canEdit && <Card title="إنشاء جهة اتصال" sub="الرقم مطلوب (7–15 رقماً، بعلامة + اختيارية). الرقم المكرر يُرفض — جهة اتصال واحدة لكل رقم.">
      <form className="grid2" onSubmit={submitCreate}>
        <Field label="الاسم"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="إن تُرك فارغاً يُستخدم الرقم" /></Field>
        <Field label="رقم الهاتف"><input dir="ltr" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+967…" /></Field>
        <Field label="التصنيفات (مفصولة بفواصل)"><input value={form.labels} onChange={(e) => setForm({ ...form, labels: e.target.value })} placeholder="مثال: عميل متكرر، أولوية" /></Field>
        <Field label="ملاحظات"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <button className="btn" type="submit">إنشاء جهة الاتصال</button>
      </form>
    </Card>}
    {canEdit && editId !== null && <Card title="تعديل جهة اتصال" sub="تغيير الرقم إلى رقم موجود مسبقاً يُرفض. التعديل لا يغيّر العقود أو المحادثات المرتبطة — تلك تُحسب من الرقم نفسه.">
      <form className="grid2" onSubmit={submitEdit}>
        <Field label="الاسم"><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></Field>
        <Field label="رقم الهاتف"><input dir="ltr" required value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></Field>
        <Field label="التصنيفات (مفصولة بفواصل)"><input value={editForm.labels} onChange={(e) => setEditForm({ ...editForm, labels: e.target.value })} /></Field>
        <Field label="ملاحظات"><input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></Field>
        <button className="btn" type="submit">حفظ التعديل</button>{' '}<button className="btn ghost" type="button" onClick={() => setEditId(null)}>إلغاء</button>
      </form>
    </Card>}
    {canEdit && <Card title="استيراد CSV" sub="ترويسة مطلوبة فيها عمود phone (أو phone_number/mobile)، وأعمدة اختيارية name وlabels وnote. المكرر — داخل الملف أو موجود مسبقاً — يُتخطّى ولا يُنشأ مرتين، والصف غير الصالح يُبلَّغ عنه دون إيقاف بقية الملف. الاستيراد لا ينشئ جمهوراً ولا يفعّل أي إرسال.">
      <form onSubmit={doImport}>
        <Field label="نص CSV"><textarea rows={6} dir="ltr" value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={'name,phone,labels,notes\nأحمد,+967700000101,عميل متكرر,ملاحظة'} /></Field>
        <div className="btn-row">
          <label className="btn ghost">اختيار ملف CSV<input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsvText(await f.text()); }} /></label>
          <button className="btn" type="submit">استيراد</button>
        </div>
      </form>
      {report && <>
        <p>النتيجة: أُنشئ {report.created}، تُخطّي {report.skipped}، أخطاء {report.errors}، من أصل {report.total} صفاً.</p>
        {report.details.length === 0 ? <Empty text="لا تفاصيل استيراد بعد." /> :
          <div className="table-wrap"><table><thead><tr><th>الصف</th><th>الرقم</th><th>النتيجة</th><th>السبب</th></tr></thead>
          <tbody>{report.details.map((d, i) => <tr key={i}><td>{d.row}</td><td dir="ltr">{d.phone || '—'}</td><td>{d.status === 'created' ? 'أُنشئ' : d.status === 'skipped' ? 'تُخطّي (مكرر)' : 'خطأ'}</td><td>{d.reason === 'duplicate_in_file' ? 'مكرر داخل الملف' : d.reason === 'duplicate_existing' ? 'موجود مسبقاً' : d.reason || '—'}</td></tr>)}</tbody></table></div>}
      </>}
    </Card>}
    {!canEdit && <p className="muted">إنشاء جهات الاتصال وتعديلها واستيرادها يتطلب صلاحية تعديل واتساب (whatsapp:edit).</p>}
  </>;
}

/* ---------------- Stage C: WhatsApp Media (uploads library + upload) ---------------- */
// The ONLY place that owns file upload: the inbox no longer carries its own
// picker (Stage B note moved here), so the upload tool is not duplicated.
export function WhatsAppMedia({ b, reload, me }: { b: Bundle; reload: () => void; me: MeUser | null }) {
  const canEdit = hasAction(me, 'whatsapp', 'edit');
  const [uploads, setUploads] = useState<{ id: number; filename: string; mime_type: string; kind: string; size_bytes: number; media_id: string | null; conversation_id: number | null; uploaded_by: string; dry_run: boolean; created_at: string }[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [msg, setMsg] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [convId, setConvId] = useState<number | ''>('');
  const [caption, setCaption] = useState('');
  const [mediaId, setMediaId] = useState('');
  const [mediaResult, setMediaResult] = useState('');
  const load = async () => { try { setUploads(await api.whatsappUploads()); } catch { setUploads([]); } };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = uploads.filter((u) => (kind === 'all' || u.kind === kind) && (q.trim() === '' || u.filename.toLowerCase().includes(q.trim().toLowerCase())));
  async function doUpload(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    if (!file) { setMsg('اختر ملفاً أولاً.'); return; }
    try {
      const r = await api.whatsappUpload(file, { ...(convId !== '' ? { conversation_id: Number(convId) } : {}), caption: caption || undefined });
      setMsg(r.dry_run ? `تم حفظ الملف «${r.upload.filename}» محلياً (وضع تجريبي — لم يُرسل إلى واتساب بعد لأن الربط غير مكتمل).` : `تم إرسال الملف «${r.upload.filename}» عبر واتساب (معرّف وسائط من Meta).`);
      setFile(null); setCaption(''); load(); reload();
    } catch (err) { setMsg('خطأ في رفع الملف: ' + (err as Error).message); }
  }
  async function doDownload(u: { id: number; filename: string }) {
    try {
      const blob = await api.downloadUpload(u.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = u.filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setMsg('خطأ في تنزيل الملف: ' + (err as Error).message); }
  }
  async function lookupMedia(e: React.FormEvent) {
    e.preventDefault(); setMediaResult('');
    try {
      const r = await api.whatsappMediaUrl(mediaId.trim());
      setMediaResult(!r.configured ? 'Meta غير موصول — لا يوجد رابط تنزيل متاح، والوسائط الواردة محفوظة كبيانات وصفية فقط.' : r.download_url ? `رابط التنزيل المؤقت من Meta: ${r.download_url}` : 'لم يُعد Meta رابط تنزيل لهذا المعرّف.');
    } catch (err) { setMediaResult('خطأ: ' + (err as Error).message); }
  }
  return <>
    <div className="page-head"><h1>الوسائط</h1><div className="btn-row"><button className="btn ghost" onClick={load}>تحديث</button></div></div>
    <Card title="رفع ملف وإرساله عبر واتساب" sub="صورة/فيديو/مستند/صوتي حتى 16 ميجابايت لكل نوع، مع مطابقة الامتداد ونوع الملف. عند اكتمال الربط يُرفع الملف إلى Meta ويُرسل بمعرّف الوسائط؛ قبل الربط يُحفظ محلياً كسجل تجريبي ولا يُدَّعى إرساله. الرسائل الحرة تتطلب نافذة 24 ساعة مفتوحة، وإلا أرسل قالباً أولاً.">
      {canEdit ? <form className="grid2" onSubmit={doUpload}>
        <Field label="الملف"><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
        <Field label="المحادثة (اختياري — عند اختيارها يُرسل الملف إليها)"><select value={convId} onChange={(e) => setConvId(e.target.value ? Number(e.target.value) : '')}><option value="">حفظ فقط دون إرسال</option>{b.conversations.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.party} {c.contract_id ? `عقد ${c.contract_id}` : 'عامة'}</option>)}</select></Field>
        <Field label="تعليق (اختياري)"><input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="تعليق مع الملف…" /></Field>
        <button className="btn" type="submit" disabled={!file}>رفع الملف{convId !== '' ? ' وإرساله' : ''}</button>
      </form> : <p className="muted">رفع الملفات يتطلب صلاحية تعديل واتساب (whatsapp:edit).</p>}
      {msg && <p className="msg">{msg}</p>}
    </Card>
    <Card title="مكتبة الوسائط المرفوعة" sub="ملفات محفوظة على الخادم (backend/uploads) — المسار المخزَّن لا يُعرض أبداً، والتنزيل يتم عبر الرمز فقط.">
      <div className="btn-row">
        <input className="inline-input" placeholder="بحث باسم الملف" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inline-select" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">كل الأنواع</option><option value="image">صورة</option><option value="video">فيديو</option><option value="audio">صوتي</option><option value="document">مستند</option></select>
      </div>
      {uploads.length === 0 ? <Empty text="لا وسائط مرفوعة بعد — ارفع أول ملف من النموذج أعلاه." /> :
      shown.length === 0 ? <Empty text="لا وسائط مطابقة للبحث أو التصفية الحالية." /> :
        <div className="table-wrap"><table><thead><tr><th>اسم الملف</th><th>النوع</th><th>الحجم</th><th>معرّف Meta</th><th>المحادثة</th><th>وضع تجريبي</th><th></th></tr></thead>
        <tbody>{shown.map((u) => <tr key={u.id}><td>{u.filename}</td><td>{u.kind}</td><td className="small">{u.size_bytes} بايت</td><td className="small">{u.media_id || '—'}</td><td>{u.conversation_id || '—'}</td><td>{u.dry_run ? 'نعم' : 'لا'}</td><td><button className="btn small ghost" onClick={() => doDownload(u)}>تنزيل</button></td></tr>)}</tbody></table></div>}
    </Card>
    <Card title="رابط تنزيل وسائط واردة من Meta" sub="الوسائط الواردة تُحفظ كبيانات وصفية فقط (المعرّف والتسمية)؛ الرابط المؤقت يُطلب من Meta عند الحاجة، ولا يُختلق رابط عند غياب الربط.">
      <form className="grid2" onSubmit={lookupMedia}>
        <Field label="معرّف الوسائط لدى Meta (media_id)"><input value={mediaId} onChange={(e) => setMediaId(e.target.value)} placeholder="مثال: 123456789…" /></Field>
        <button className="btn" type="submit" disabled={!mediaId.trim()}>طلب رابط التنزيل</button>
      </form>
      {mediaResult && <p className="msg">{mediaResult}</p>}
    </Card>
  </>;
}

/* ---------------- Automation ---------------- */
export function Automation({ b, reload, only }: { b: Bundle; reload: () => void; only?: 'rules' | 'killswitch' }) {
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [ruleQ, setRuleQ] = useState('');
  const shownRules = rules.filter((r) => ruleQ.trim() === '' || `${r.name} ${r.trigger_value || ''} ${r.category}`.toLowerCase().includes(ruleQ.trim().toLowerCase()));
  const [ruleForm, setRuleForm] = useState({ name: '', category: 'general', trigger_value: '' });
  const loadRules = async () => { try { setRules(await api.automationRules()); } catch { setRules([]); } };
  useEffect(() => { loadRules(); }, []);
  const [runWf, setRunWf] = useState<number | ''>('');
  const [runConv, setRunConv] = useState<number | ''>('');
  const [logs, setLogs] = useState<{ id: number; workflow_name: string | null; outcome: string; created_at: string }[]>([]);
  async function toggle(off: boolean) {
    try { await api.killSwitchSet(off); setMsg(off ? 'تم تفعيل مفتاح الإيقاف — الأتمتة موقوفة الآن.' : 'تم إيقاف مفتاح الإيقاف — الأتمتة تعمل.'); setConfirm(false); reload(); }
    catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  return <>
    <Card title="تشغيل يدوي وسجل تنفيذ الأتمتة" sub="التشغيل اليدوي يتطلب صلاحية تعديل الأتمتة. التنفيذ الحقيقي يعمل على رسائل Webhook الواردة وأحداث العقود — هذه الواجهة للتشغيل اليدوي والمراجعة فقط.">
      <div className="grid2">
        <Field label="التدفق"><select value={runWf} onChange={(e) => setRunWf(e.target.value ? Number(e.target.value) : '')}><option value="">— اختر تدفقاً —</option>{b.workflows.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.trigger_type})</option>)}</select></Field>
        <Field label="المحادثة"><select value={runConv} onChange={(e) => setRunConv(e.target.value ? Number(e.target.value) : '')}><option value="">— اختر محادثة —</option>{b.conversations.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.party} {c.contract_id ? `عقد ${c.contract_id}` : 'عامة'}</option>)}</select></Field>
      </div>
      <div className="btn-row">
        <button className="btn" disabled={runWf === '' || runConv === ''} onClick={async () => { try { const r = await api.runWorkflow(Number(runWf), Number(runConv)); setMsg(r.ok ? `تم تنفيذ التدفق — النتيجة: ${r.outcome || 'done'}.` : `لم يُنفَّذ التدفق — السبب: ${r.blocked_reason || 'غير معروف'}.`); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تشغيل يدوي الآن</button>
        <button className="btn ghost" onClick={async () => { try { setLogs(await api.automationLogs(runConv === '' ? undefined : Number(runConv))); } catch { setLogs([]); } }}>عرض سجل التنفيذ</button>
      </div>
      {logs.length > 0 && <table><thead><tr><th>التدفق</th><th>النتيجة</th><th>الوقت</th></tr></thead><tbody>{logs.slice(-20).reverse().map((x) => <tr key={x.id}><td>{x.workflow_name || '—'}</td><td>{x.outcome}</td><td className="small">{fmt(x.created_at)}</td></tr>)}</tbody></table>}
      <p className="muted">المشغّلات المدعومة: كلمة مفتاحية (مطابقة تامة قبل الاحتواء، والأطول يفوز، مع تطبيع عربي)، أول رسالة، رد زر/قائمة، حدث عقد، أثناء/خارج الدوام، احتياطي بعد رسالتين غير مفهومتين، وتشغيل يدوي. خطوات المال مرفوضة عند الحفظ وعند التنفيذ.</p>
      {msg && <p className="msg">{msg}</p>}
    </Card>
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
      <div className="btn-row"><input className="inline-input" placeholder="بحث بالقاعدة أو المشغّل أو الفئة" value={ruleQ} onChange={(e) => setRuleQ(e.target.value)} /></div>
      {rules.length === 0 ? <Empty text="لا قواعد أتمتة بعد." /> :
      shownRules.length === 0 ? <Empty text="لا قواعد مطابقة للبحث الحالي." /> :
        <table><thead><tr><th>القاعدة</th><th>الفئة</th><th>المشغّل</th><th>نشطة</th><th></th></tr></thead>
        <tbody>{shownRules.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.category}</td><td>{r.trigger_value || '—'}</td><td>{r.is_active ? 'نعم' : 'لا'}</td>
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
    <UnifiedEngineCard b={b} reload={reload} />
    <MacrosCard b={b} reload={reload} />
    <ScheduledCard b={b} />
  </>;
}


/* ---------------- Unified automation engine view ---------------- */
// Rules (db.rules) and designer flows (db.workflows) are VIEWS on the
// same engine: one candidate list, one executor, one log. This card
// shows both stores together and runs either kind through the same
// run endpoints; macros below are workflows with category 'macro'.
function UnifiedEngineCard({ b, reload }: { b: Bundle; reload: () => void }) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [msg, setMsg] = useState('');
  const [conv, setConv] = useState<number | ''>('');
  useEffect(() => { api.automationRules().then(setRules).catch(() => setRules([])); }, []);
  const rows: { kind: string; id: number; name: string; trigger: string }[] = [
    ...b.workflows.map((w) => ({ kind: 'تدفق مصمّم', id: w.id, name: w.name, trigger: `${w.trigger_type} ${w.trigger_value || ''}` })),
    ...rules.map((r) => ({ kind: 'قاعدة', id: r.id, name: r.name, trigger: `${r.trigger_type || ''} ${r.trigger_value || ''}` })),
  ];
  return <Card title="المحرك الواحد — كل التدفقات والقواعد معاً" sub="لا نظامان: القواعد والمصمّم وجهان لنفس المحرك، ونفس سجل التنفيذ، ونفس حظر خطوات المال.">
    <div className="btn-row">
      <select className="inline-select" value={conv} onChange={(e) => setConv(e.target.value ? Number(e.target.value) : '')}><option value="">— اختر محادثة للتشغيل —</option>{b.conversations.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.party} {c.contract_id ? `عقد ${c.contract_id}` : 'عامة'}</option>)}</select>
    </div>
    {rows.length === 0 ? <Empty text="لا تدفقات ولا قواعد بعد — أنشئ تدفقاً من المصمّم أو قاعدة من الأعلى." /> :
      <table><thead><tr><th>النوع</th><th>الاسم</th><th>المشغّل</th><th></th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={`${r.kind}-${r.id}`}><td>{r.kind}</td><td>{r.name}</td><td>{r.trigger || '—'}</td>
        <td><button className="btn small ghost" disabled={conv === ''} onClick={async () => { try {
          const res = r.kind === 'تدفق مصمّم' ? await api.runWorkflow(r.id, Number(conv)) : await api.runRule(r.id, Number(conv));
          setMsg(res.ok ? `تم التنفيذ — ${res.outcome || 'done'}.` : `لم يُنفَّذ — ${res.blocked_reason || ''}.`); reload();
        } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تشغيل يدوي</button></td></tr>)}</tbody></table>}
    {msg && <p className="msg">{msg}</p>}
  </Card>;
}
function MacrosCard({ b, reload }: { b: Bundle; reload: () => void }) {
  const [macros, setMacros] = useState<{ id: number; name: string }[]>([]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api.macros().then(setMacros).catch(() => setMacros([]));
  useEffect(() => { load(); }, []);
  return <Card title="Macros — سلاسل أفعال محفوظة بضغطة واحدة" sub="الماكرو تدفق في المحرك الواحد (فئة macro، تشغيل يدوي). خطوات المال مرفوضة عند الحفظ وعند التنفيذ، حتى داخل تفرّع.">
    <form className="grid2" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) { setMsg('أدخل اسم الماكرو.'); return; } try {
      await api.createMacro({ name: name.trim(), steps: [{ step_type: 'text', body: 'تم تنفيذ الماكرو.' }] });
      setMsg(`تم إنشاء الماكرو «${name.trim()}» — عدّله من المصمّم إن أردت خطوات أكثر.`); setName(''); load(); reload();
    } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
      <Field label="اسم الماكرو"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: ترحيب + طلب بيانات" /></Field>
      <button className="btn" type="submit">إنشاء ماكرو (رسالة نصية افتراضية — عدّلها من المصمّم)</button>
    </form>
    {macros.length === 0 ? <Empty text="لا ماكرو بعد." /> :
      <ul>{macros.map((m) => <li key={m.id}>{m.name} — يُشغَّل من محرر الإنبكس (قائمة الماكرو) أو من هنا باختيار محادثة.</li>)}</ul>}
    {msg && <p className="msg">{msg}</p>}
  </Card>;
}
function ScheduledCard({ b }: { b: Bundle }) {
  const [contractId, setContractId] = useState<number | ''>('');
  const [msg, setMsg] = useState('');
  return <Card title="تشغيل مجدول — تذكيرات مرتبطة بعقد فقط" sub="لا حملات ولا بث: يُشغَّل فقط التدفقات ذات مشغّل scheduled_reminder، وعلى محادثات العقد المختار فقط.">
    <div className="btn-row">
      <select className="inline-select" value={contractId} onChange={(e) => setContractId(e.target.value ? Number(e.target.value) : '')}><option value="">— اختر عقداً —</option>{b.contracts.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.product_description}</option>)}</select>
      <button className="btn" disabled={contractId === ''} onClick={async () => { try {
        const r = await api.scheduledRun(Number(contractId));
        setMsg(`تم التشغيل المجدول: ${Array.isArray(r.results) ? r.results.length : 0} تنفيذاً على عقد ${contractId}.`);
      } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تشغيل التذكيرات المجدولة لهذا العقد</button>
    </div>
    {msg && <p className="msg">{msg}</p>}
  </Card>;
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

/* ---------------- Checklist (redirect) ---------------- */
// The old 10-step checklist is DELETED as a separate flow. This route
// now only redirects to the ONE 7-step linking wizard (WhatsApp >
// connection), and the API endpoint only redirects to
// GET /api/whatsapp/linking. No second linking flow exists.
export function Checklist() {
  return <Card title="قائمة الربط — أُحيلت إلى معالج الربط الواحد" sub="المعالج الواحد له 7 خطوات فقط، وحالته من الخادم (GET /api/whatsapp/linking) — وليس من المتصفح.">
    <p>القائمة القديمة ذات العشر خطوات حُذفت. افتح معالج الربط من قسم واتساب ← الربط والحسابات، أو اضغط الزر أدناه.</p>
    <div className="btn-row"><a className="btn" href="#whatsapp/connection">فتح معالج الربط (7 خطوات)</a></div>
    <p className="muted">لا يوجد هنا أي حقل لإدخال رمز أو سر — القيم تعيش في متغيرات بيئة الخادم فقط.</p>
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
/* ---------------- Embedded Signup (Stage A, official Meta flow only) ---------------- */
// The button builds Meta's OAuth dialog URL from server-supplied public
// parameters (App ID + Config ID). No secret is ever shown or sent to the
// browser. After Meta redirects back, the operator pastes the short-lived
// `code` here; the server exchanges it and TESTS the token — it does NOT
// persist it (see docs/zeromsg-linking.md). Manual env setup stays available.
export function EmbeddedSignupCard({ canEdit }: { canEdit: boolean }) {
  const [cfg, setCfg] = useState<EmbeddedSignupConfig | null>(null);
  const [code, setCode] = useState('');
  const [redirectUri, setRedirectUri] = useState(typeof window !== 'undefined' ? window.location.origin + '/' : '');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.embeddedSignupConfig().then(setCfg).catch(() => setCfg(null));
    try { const c = new URLSearchParams(window.location.search).get('code'); if (c) setCode(c); } catch {}
  }, []);
  const launchUrl = cfg?.launch ? (() => {
    const u = new URL(cfg.launch.dialog_base + cfg.launch.dialog_path);
    u.searchParams.set('client_id', cfg.launch.client_id);
    u.searchParams.set('config_id', cfg.launch.config_id);
    u.searchParams.set('response_type', cfg.launch.response_type);
    u.searchParams.set('override_default_response_type', 'true');
    u.searchParams.set('scope', cfg.launch.scope);
    u.searchParams.set('redirect_uri', redirectUri || (typeof window !== 'undefined' ? window.location.origin + '/' : ''));
    return u.toString();
  })() : null;
  return <Card title="الربط من داخل اللوحة — Connect with Meta (Embedded Signup)" sub="تدفق Meta الرسمي فقط. لا يوجد هنا أي حقل لرمز أو سر، ولا يُعرض أي رمز أبداً. الرمز المتبادَل يُختبر فقط ولا يُحفظ.">
    {!cfg ? <p className="muted">جارٍ جلب حالة Embedded Signup من الخادم…</p> : <>
      <ul>
        <li>معرّف التطبيق (App ID) مضبوط: {cfg.app_id_configured ? 'نعم' : 'لا'}</li>
        <li>معرّف التكوين (Config ID) مضبوط: {cfg.config_id_configured ? 'نعم' : 'لا'}</li>
        <li>سر التطبيق (App Secret) مضبوط: {cfg.app_secret_configured ? 'نعم' : 'لا'}</li>
        <li>Embedded Signup جاهز: {cfg.embedded_configured ? 'نعم' : 'لا — اضبط WHATSAPP_APP_ID وWHATSAPP_CONFIG_ID وWHATSAPP_APP_SECRET في بيئة الاستضافة ثم أعد النشر، أو استخدم المسار اليدوي أدناه.'}</li>
      </ul>
      {launchUrl && <div className="btn-row"><a className="btn" href={launchUrl} target="_blank" rel="noreferrer">Connect with Meta — فتح نافذة Meta الرسمية</a></div>}
      {launchUrl && <p className="muted">سيُعيدك Meta إلى عنوان إعادة التوجيه أعلاه — يجب أن يكون مسجَّلاً في تطبيق Meta (Valid OAuth Redirect URIs)، وإلا رفض Meta الإطلاق. بعد العودة، انسخ قيمة <code>code</code> من عنوان الصفحة والصقها أدناه.</p>}
      {canEdit ? <form className="grid2" onSubmit={async (e) => { e.preventDefault(); if (!code.trim()) { setResult('الصق رمز code الذي أعاده Meta أولاً.'); return; } setBusy(true); setResult(''); try {
        const r = await api.embeddedSignupCallback(code.trim(), redirectUri.trim() || undefined);
        setResult(r.ok ? `تم اختبار الاتصال بنجاح — لم يُحفظ أي رمز. الاسم المعروض: ${r.display_name || '—'}، معرّف WABA: ${r.waba_id || 'غير مضبوط بعد'}، معرّف الرقم: ${r.phone_number_id || 'غير مضبوط بعد'}. للإنتاج: انسخ هذه المعرفات (والرمز الدائم من System User) إلى Render Environment Variables ثم أعد النشر.` : `فشل الاختبار: ${r.error || 'خطأ غير معروف'}.`);
      } catch (err) { setResult('خطأ في إكمال الربط: ' + (err as Error).message); } finally { setBusy(false); } }}>
        <Field label="عنوان إعادة التوجيه (redirect_uri) المستخدم في الإطلاق"><input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} /></Field>
        <Field label="رمز code الذي أعاده Meta (قصير العمر — ليس رمز وصول)"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="الصق code هنا" /></Field>
        <button className="btn" type="submit" disabled={busy || !cfg.embedded_configured}>{busy ? 'جارٍ الاختبار…' : 'إكمال الربط — اختبار فقط (لا حفظ)'}</button>
      </form> : <p className="muted">إكمال الربط يتطلب صلاحية تعديل واتساب (whatsapp:edit).</p>}
      {result && <p className="msg">{result}</p>}
      <p className="muted">المسار اليدوي ما زال متاحاً كبديل: اضبط WHATSAPP_ACCESS_TOKEN وWHATSAPP_PHONE_NUMBER_ID وWHATSAPP_BUSINESS_ACCOUNT_ID في Render ثم أعد النشر، ثم اضغط «اختبار الرمز» في المعالج أدناه. هذا ليس ربطاً عبر QR أو تطبيق واتساب — كلا المسارين يستخدمان Cloud API الرسمي فقط.</p>
    </>}
  </Card>;
}
export function WhatsApp({ b, reload, me, sub }: { b: Bundle; reload: () => void; me: MeUser | null; sub?: 'connection' | 'settings' }) {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [err, setErr] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [tokenMsg, setTokenMsg] = useState('');
  const [testingToken, setTestingToken] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendForm, setSendForm] = useState({ to: '', mode: 'text' as 'text' | 'template', body: '', template_name: '' });
  const [stepFilter, setStepFilter] = useState('all');
  const [settingsQ, setSettingsQ] = useState('');
  const canEdit = hasAction(me, 'whatsapp', 'edit');
  useEffect(() => {
    api.whatsappStatus().then(setStatus).catch((e) => setErr((e as Error).message));
  }, []);
  const refresh = () => { api.whatsappStatus().then(setStatus).catch((e) => setErr((e as Error).message)); reload(); };
  if (sub === 'settings') {
    const ENV_VARS: { name: string; desc: string }[] = [
      { name: 'WHATSAPP_VERIFY_TOKEN', desc: 'رمز تحقق Webhook (يُطابق ما يُدخل في Meta).' },
      { name: 'WHATSAPP_APP_SECRET', desc: 'سر التطبيق للتحقق من توقيع HMAC-SHA256.' },
      { name: 'WHATSAPP_ACCESS_TOKEN', desc: 'رمز الوصول الدائم (System User Token) للرسائل الصادرة.' },
      { name: 'WHATSAPP_PHONE_NUMBER_ID', desc: 'معرّف الرقم المخصص للخدمة.' },
      { name: 'WHATSAPP_BUSINESS_ACCOUNT_ID', desc: 'معرّف حساب WhatsApp Business.' },
      { name: 'WHATSAPP_API_VERSION', desc: 'إصدار Graph API (الافتراضي عند التنفيذ: v26.0).' },
      { name: 'WHATSAPP_APP_ID', desc: 'معرّف تطبيق Meta (معامل إطلاق Embedded Signup، ليس سراً).' },
      { name: 'WHATSAPP_CONFIG_ID', desc: 'معرّف تكوين Embedded Signup من لوحة تطبيق Meta (ليس سراً).' },
      { name: 'APP_BASE_URL', desc: 'عنوان الموقع الحي، يُستخدم لبناء عنوان Webhook.' },
      { name: 'JWT_SECRET', desc: 'سر توقيع رموز الدخول (8 ساعات).' },
    ];
    const shownEnv = ENV_VARS.filter((v) => settingsQ.trim() === '' || `${v.name} ${v.desc}`.toLowerCase().includes(settingsQ.trim().toLowerCase()));
    return <Card title="إعدادات واتساب" sub="أسماء متغيرات البيئة فقط — القيم تعيش في بيئة الخادم حصراً ولا تُكتب هنا ولا في أي ملف ولا في المحادثة.">
      <div className="btn-row"><input className="inline-input" placeholder="بحث باسم المتغير أو وصفه" value={settingsQ} onChange={(e) => setSettingsQ(e.target.value)} /></div>
      {shownEnv.length === 0 ? <Empty text="لا متغيرات مطابقة للبحث الحالي." /> :
        <ul>{shownEnv.map((v) => <li key={v.name}><code>{v.name}</code> — {v.desc}</li>)}</ul>}
      <p className="muted">تُضبط هذه المتغيرات في لوحة Render (Environment) ثم يُعاد النشر — المتغيرات لا تسري قبل إعادة النشر. لا يوجد في هذه الواجهة أي حقل لإدخال رمز أو سر، عمداً.</p>
    </Card>;
  }
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
      else if (r.error === 'template_not_meta_approved') setTestMsg('لم يُرسل: القالب معتمد محلياً لكن Meta لم تعتمده بعد — عند اتصال Meta لا يكفي الاعتماد المحلي. راجع حالة Meta في تبويب «القوالب»، وقدّم القالب وانتظر موافقة Meta.');
      else if (r.error === 'template_not_found') setTestMsg('لم يُرسل: القالب غير موجود في الخادم — اختر قالباً من القائمة.');
      else setTestMsg(`لم يُرسل: ${r.error || 'خطأ غير معروف'}.`);
    } catch (err) { setTestMsg('خطأ في الإرسال: ' + (err as Error).message + ' — إذا كان الخادم لا يوفّر هذا الـ endpoint بعد، فالواجهة جاهزة والخادم ما زال قيد التنفيذ.'); }
    finally { setSending(false); }
  }
  return <>
    <Card title={`معالج ربط واتساب — ${steps.length} خطوات`} sub={`مكتمل: ${doneCount} من ${steps.length}${blockedCount ? ` — متعذّر: ${blockedCount}` : ''} — الحالة من الخادم (GET /api/whatsapp/status)، وليست من المتصفح. لا يوجد هنا أي حقل لإدخال رمز أو سر.`}>
      <EmbeddedSignupCard canEdit={canEdit} />
      {!status && <p className="muted">{err ? 'تعذر جلب حالة الربط: ' + err : 'جارٍ جلب حالة الربط من الخادم…'}</p>}
      {status && !status.wizard_steps && <p className="local-note">الخادم الحالي لا يرسل wizard_steps بعد — الخطوات أدناه مشتقة من الحقول القديمة فقط (بانتظار ما لم يثبته الخادم)، وستُعرض حالة الخادم الحقيقية فور توفر الـ endpoint الجديد.</p>}
      <div className="btn-row">
        <input className="inline-input" placeholder="بحث في خطوات الربط" value={stepFilter === 'all' || stepFilter === 'done' || stepFilter === 'pending' || stepFilter === 'blocked' ? '' : stepFilter} onChange={(e) => setStepFilter(e.target.value)} />
        <select className="inline-select" value={['done', 'pending', 'blocked'].includes(stepFilter) ? stepFilter : 'all'} onChange={(e) => setStepFilter(e.target.value)}>
          <option value="all">كل الخطوات</option><option value="done">المكتملة فقط</option><option value="pending">بانتظار فقط</option><option value="blocked">المتعذّرة فقط</option>
        </select>
      </div>
      <ol className="wizard">
        {steps.map((s, i) => ({ ...s, num: i + 1 })).filter((s) => (['done', 'pending', 'blocked'].includes(stepFilter) ? s.status === stepFilter : true) && (['done', 'pending', 'blocked'].includes(stepFilter) || stepFilter === 'all' || `${s.title} ${s.detail}`.toLowerCase().includes(stepFilter.toLowerCase()))).map((s) => <li key={s.key} className="wizard-step">
          <div className="wizard-head"><b>{s.num}. {s.title}</b><Badge tone={stepTone(s.status)}>{stepAr(s.status)}</Badge></div>
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
function ReportsCard() {
  const [rep, setRep] = useState<import('./types').ReportSummary | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.reportsSummary().then(setRep).catch((e) => setErr((e as Error).message)); }, []);
  async function downloadCsv() {
    try {
      const text = await api.auditCsv();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob); const aEl = document.createElement('a');
      aEl.href = url; aEl.download = 'audit.csv'; aEl.click(); URL.revokeObjectURL(url);
    } catch (e) { setErr('خطأ في تصدير CSV: ' + (e as Error).message); }
  }
  return <Card title="التقارير — أرقام حقيقية من الخادم فقط" sub="لا أرقام تجريبية أبداً: كل رقم أدناه محسوب من بيانات الخادم الحية، وعند بدء النظام فارغاً تكون كلها صفراً.">
    {err && <p className="msg">{err}</p>}
    {!rep ? <p className="muted">جارٍ جلب التقرير من الخادم…</p> : <>
      <div className="chips">
        <span className="chip">عقود: {rep.contracts_total}</span>
        <span className="chip">محادثات: {rep.conversations_total}</span>
        <span className="chip">غير مقروءة: {rep.unread_total}</span>
        <span className="chip">مهام مفتوحة: {rep.open_tasks}</span>
        <span className="chip">قوالب معتمدة محلياً: {rep.templates_local_approved} / {rep.templates_total}</span>
        <span className="chip">قوالب معتمدة لدى Meta: {rep.templates_meta_approved}</span>
        <span className="chip">قوالب مرفوضة لدى Meta: {rep.templates_meta_rejected}</span>
        <span className="chip">سجلات أتمتة: {rep.automation_logs_total}</span>
        <span className="chip">وقت أول رد (متوسط): {rep.first_response.avg_minutes === null ? 'لا بيانات بعد' : `${rep.first_response.avg_minutes} دقيقة (${rep.first_response.conversations_measured} محادثة)`}</span>
        <span className="chip">جهات اتصال: {rep.contacts_total}</span>
        <span className="chip">وسائط: {rep.uploads_total}</span>
      </div>
      <div className="chips">{Object.entries(rep.contracts_by_state).filter(([, n]) => n > 0).map(([st, n]) => <span key={st} className="chip">{STATE_AR[st as State] || st}: {n}</span>)}</div>
      <div className="chips">{Object.entries(rep.automation_by_outcome).map(([o, n]) => <span key={o} className="chip">أتمتة {o}: {n}</span>)}</div>
    </>}
    <div className="btn-row"><button className="btn ghost" onClick={downloadCsv}>تصدير سجل التدقيق CSV</button></div>
  </Card>;
}

export function Audit({ b }: { b: Bundle }) {
  const [entity, setEntity] = useState('all');
  const [q, setQ] = useState('');
  const list = [...b.audit].reverse().filter((a) => (entity === 'all' || a.entity === entity) && (q === '' || a.actor.includes(q) || a.action.includes(q) || String(a.entity_id).includes(q)));
  return <><ReportsCard />
  <Card title="سجل التدقيق (قراءة فقط)" sub="سجل إلحاقي — لا توجد أزرار تعديل أو حذف هنا أبداً، والخادم نفسه لا يعدّله ولا يحذف منه." actions={<><select className="inline-select" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="all">كل الكيانات</option>{[...new Set(b.audit.map((a) => a.entity))].map((e2) => <option key={e2} value={e2}>{e2}</option>)}</select> <input className="inline-input" placeholder="بحث بالمنفّذ أو الإجراء أو الرقم" value={q} onChange={(e) => setQ(e.target.value)} /></>}>
    {list.length === 0 ? <Empty text="لا سجلات تدقيق بعد." /> :
      <div className="table-wrap"><table><thead><tr><th>الوقت</th><th>المنفّذ</th><th>الكيان</th><th>الرقم</th><th>الإجراء</th><th>التفاصيل</th></tr></thead>
      <tbody>{list.map((a) => <tr key={a.id}><td className="small">{fmt(a.created_at)}</td><td>{a.actor}</td><td>{a.entity}</td><td>{a.entity_id}</td><td>{a.action}</td><td className="small">{JSON.stringify(a.details || {})}</td></tr>)}</tbody></table></div>}
  </Card></>;

}
