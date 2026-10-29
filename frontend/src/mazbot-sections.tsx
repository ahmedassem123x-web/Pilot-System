// MazBot-menu sections, adapted to the closed V1.2 pilot (Round 3, expanded
// brief). Every section below works end-to-end on real data — no
// placeholder cards, no "coming soon" screens for claimed features:
//  - WhatsApp Overview / Insights / Conversions (contract funnel, NOT
//    Meta ad conversions) / Lists / Segments / Tags / Auto Replies /
//    User Input Responses / Human handoff / Chat Widget (config only)
//  - AI workspace: draft-only assistant (never auto-sends, never sells),
//    with quotas, knowledge base and a local test chat
//  - Team Performance / Distribution (assignment, not leads) / QA Settings
//  - My Tickets (real ops tasks), Ideas & Feedback (local, labelled)
//  - Billing (usage display only, no payment collection), Webhook
//    (live linking data), API (endpoint catalogue, no keys), Integrations
// REJECTED and deliberately absent from navigation: Campaigns (marketing
// broadcasts), Invite & earn, store sync/catalog, AI selling/closing.
// Local-only data (knowledge base, feedback, QA toggles, widget config,
// AI settings) is stored in localStorage and labelled as such in the UI —
// it is never mixed into server reports.
import { useEffect, useState } from 'react';
import { api } from './api';
import { Badge, Card, Empty, Field, fmt } from './components';
import { STATE_AR, type Contact, type LinkingPayload, type MeUser, type Workflow } from './types';
import type { Bundle } from './views';

function loadLocal<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function saveLocal(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } }
const realConvs = (b: Bundle) => b.conversations.filter((c) => !c.is_demo);
const realContracts = (b: Bundle) => b.contracts.filter((c) => !c.is_demo);

// ---------- WhatsApp ----------
export function WhatsAppOverview({ b, reload }: { b: Bundle; reload: () => void }) {
  const [link, setLink] = useState<LinkingPayload | null>(null);
  useEffect(() => { api.linking().then(setLink).catch(() => setLink(null)); }, []);
  const convs = realConvs(b);
  const unread = convs.reduce((s, c) => s + (c.unread_count || 0), 0);
  const approved = b.templates.filter((t) => t.approval_status === 'approved').length;
  return <>
    <div className="stats">
      <div className="stat"><div className="stat-top"><b>{convs.length}</b></div><span className="stat-label">محادثات واتساب حقيقية</span><span className="stat-sub">التجريبية لا تُحتسب</span></div>
      <div className="stat"><div className="stat-top"><b>{unread}</b></div><span className="stat-label">غير مقروءة</span><span className="stat-sub">{unread === 0 ? 'لا رسائل بانتظار القراءة' : 'بانتظار القراءة والرد'}</span></div>
      <div className="stat"><div className="stat-top"><b>{approved} / {b.templates.length}</b></div><span className="stat-label">قوالب معتمدة محلياً</span><span className="stat-sub">Utility فقط</span></div>
      <div className="stat"><div className="stat-top"><b>{b.workflows.length}</b></div><span className="stat-label">تدفقات أتمتة</span><span className="stat-sub">مفتاح الإيقاف: {b.killSwitch ? 'مُفعَّل' : 'متوقف'}</span></div>
      <div className="stat"><div className="stat-top"><b>{link ? link.done : '—'}</b></div><span className="stat-label">خطوات ربط مكتملة (من 7)</span><span className="stat-sub">{link ? (link.configured ? 'Meta موصول' : 'Meta غير موصول بعد') : 'جارٍ القراءة…'}</span></div>
      <div className="stat"><div className="stat-top"><b>{realContracts(b).length}</b></div><span className="stat-label">عقود حقيقية</span><span className="stat-sub">التجريبي لا يُحتسب</span></div>
    </div>
    <Card title="نظرة عامة على واتساب" sub="أرقام حقيقية من الخادم فقط. لا حملات تسويقية هنا — هذا النظام تجريبي مغلق، وقوالب Utility مرتبطة بعقود فقط.">
      <p>حالة الربط: {link ? (link.configured ? <Badge tone="ok">موصول</Badge> : <Badge tone="warn">غير موصول — وضع تجريبي محلي</Badge>) : 'جارٍ القراءة…'}</p>
      <p>رابط Webhook: {link?.webhook_url || 'غير مضبوط بعد (يُضبط في متغيرات بيئة Render)'}</p>
      <div className="btn-row"><button className="btn ghost" onClick={reload}>تحديث الأرقام</button></div>
    </Card>
  </>;
}
export function WhatsAppInsights({ b }: { b: Bundle }) {
  const msgs = b.messages;
  const byStatus: Record<string, number> = {};
  for (const m of msgs) { const k = m.is_internal_note ? 'ملاحظة داخلية' : m.dry_run ? 'تجريبي (لم يُرسل)' : m.meta_status || (m.direction === 'in' ? 'وارد' : 'مسجّل محلياً'); byStatus[k] = (byStatus[k] || 0) + 1; }
  const byTpl: Record<string, number> = {};
  for (const m of msgs) if (m.template_name) byTpl[m.template_name] = (byTpl[m.template_name] || 0) + 1;
  return <Card title="رؤى التسليم (Delivery Insights)" sub="من حالات الرسائل الفعلية في الخادم — أُرسلت / سُلّمت / قُرئت / فشلت / تجريبي. لا بيانات Meta هنا قبل الربط.">
    <div className="chips">{Object.entries(byStatus).map(([k, n]) => <span key={k} className="chip">{k}: {n}</span>)}</div>
    <h3>استخدام القوالب</h3>
    {Object.keys(byTpl).length === 0 ? <Empty text="لم يُرسل أي قالب بعد." /> :
      <table><thead><tr><th>القالب</th><th>مرات الإرسال المسجلة</th></tr></thead><tbody>{Object.entries(byTpl).map(([k, n]) => <tr key={k}><td>{k}</td><td>{n}</td></tr>)}</tbody></table>}
  </Card>;
}
export function WhatsAppConversions({ b }: { b: Bundle }) {
  const cs = realContracts(b);
  const order = ['draft', 'issued', 'accepted', 'payment_pending', 'payment_confirmed', 'preparing', 'delivered', 'completed'] as const;
  const counts = order.map((s) => cs.filter((c) => c.state === s).length);
  const issued = cs.filter((c) => c.state !== 'draft').length;
  const completed = cs.filter((c) => c.state === 'completed').length;
  return <Card title="تحويلات العقود" sub="قمع عقود Pilot System — وليس تحويلات إعلانات Meta. كل رقم من عقود حقيقية في الخادم.">
    <table><thead><tr><th>المرحلة</th><th>عدد العقود</th></tr></thead><tbody>{order.map((s, i) => <tr key={s}><td>{STATE_AR[s]}</td><td>{counts[i]}</td></tr>)}</tbody></table>
    <p className="muted">صادر فأكثر: {issued} • مكتمل: {completed} • نسبة الإكمال من الصادر: {issued ? Math.round((completed / issued) * 100) : 0}٪</p>
  </Card>;
}
export function ContactLists({ reload }: { reload: () => void }) {
  const [list, setList] = useState<Contact[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => { api.contacts().then(setList).catch((e) => setErr((e as Error).message)); }, []);
  return <Card title="قوائم جهات الاتصال" sub="جهات اتصال مرتبطة بعقود فقط — لا جمهور تسويقي، ولا استيراد جماهيري.">
    {err && <p className="msg">{err}</p>}
    {list.length === 0 ? <Empty text="لا جهات اتصال بعد — تُنشأ من عقود أو من تبويب جهات الاتصال." /> :
      <table><thead><tr><th>الاسم</th><th>الرقم</th><th>الأدوار</th><th>عقود</th><th>أهلية Utility</th></tr></thead><tbody>{list.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td>{c.roles.join('، ')}</td><td>{c.contracts.length}</td><td>{c.utility_eligible ? 'نعم' : 'لا'}</td></tr>)}</tbody></table>}
    <div className="btn-row"><button className="btn ghost" onClick={() => api.contacts().then(setList).catch(() => {})}>تحديث</button><button className="btn ghost" onClick={reload}>تحديث لوحة النظام</button></div>
  </Card>;
}
export function SegmentsPage() {
  const [list, setList] = useState<Contact[]>([]);
  const [sel, setSel] = useState('');
  useEffect(() => { api.contacts().then(setList).catch(() => setList([])); }, []);
  const groups: Record<string, Contact[]> = {};
  for (const c of list) { const labels = c.labels.length ? c.labels : ['بلا وسم']; for (const l of labels) (groups[l] ||= []).push(c); }
  const names = Object.keys(groups);
  return <Card title="الشرائح (Segments)" sub="شرائح تشغيلية فقط: تجميع جهات الاتصال حسب وسومها — ليست شرائح تسويقية، ولا تُستخدم لأي إرسال جماعي.">
    {names.length === 0 ? <Empty text="لا شرائح بعد — أضف وسوماً لجهات الاتصال أولاً." /> : <>
      <div className="chips">{names.map((n) => <button key={n} className={`chip ${sel === n ? 'chip-sel' : ''}`} onClick={() => setSel(sel === n ? '' : n)}>{n}: {groups[n].length}</button>)}</div>
      {sel && <table><thead><tr><th>الاسم</th><th>الرقم</th></tr></thead><tbody>{groups[sel].map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td></tr>)}</tbody></table>}
    </>}
  </Card>;
}
export function TagsPage({ b, reload }: { b: Bundle; reload: () => void }) {
  const [sel, setSel] = useState('');
  const counts: Record<string, number> = {};
  for (const c of realConvs(b)) for (const l of c.labels || []) counts[l] = (counts[l] || 0) + 1;
  const names = Object.keys(counts);
  const convs = sel ? realConvs(b).filter((c) => (c.labels || []).includes(sel)) : [];
  return <Card title="الوسوم (Tags)" sub="وسوم محادثات حقيقية — تُدار من دردشة الإنبكس أو من لوحة تفاصيل الجهة.">
    {names.length === 0 ? <Empty text="لا وسوم بعد." /> : <>
      <div className="chips">{names.map((n) => <button key={n} className="chip" onClick={() => setSel(n)}>{n}: {counts[n]}</button>)}</div>
      {sel && (convs.length === 0 ? <Empty text="لا محادثات بهذا الوسم." /> :
        <table><thead><tr><th>المحادثة</th><th>الحالة</th><th>مكلَّف به</th></tr></thead><tbody>{convs.map((c) => <tr key={c.id}><td>{c.contract_id ? `عقد ${c.contract_id}` : 'عامة'} — {c.party}</td><td>{c.status}</td><td>{c.assigned_to || 'غير معيّن'}</td></tr>)}</tbody></table>)}
    </>}
    <div className="btn-row"><button className="btn ghost" onClick={reload}>تحديث</button></div>
  </Card>;
}
export function AutoReplies({ b, onOpenDesigner }: { b: Bundle; onOpenDesigner: () => void }) {
  const autos = b.workflows.filter((w) => ['keyword', 'first_message', 'away', 'business_hours', 'fallback'].includes(w.trigger_type));
  return <Card title="الردود التلقائية (Auto Replies)" sub="تدفقات تعمل تلقائياً عند كلمة مفتاحية أو أول رسالة أو خارج الدوام — كلها من محرك الأتمتة الواحد، ولا خطوة مالية فيها أبداً.">
    {autos.length === 0 ? <Empty text="لا ردود تلقائية بعد — أنشئها من منشئ التدفقات." /> :
      <table><thead><tr><th>الاسم</th><th>المشغّل</th><th>القيمة</th><th>خطوات</th><th>نشط</th></tr></thead><tbody>{autos.map((w) => <tr key={w.id}><td>{w.name}</td><td>{w.trigger_type}</td><td>{w.trigger_value || '—'}</td><td>{w.steps.length}</td><td>{w.is_active ? 'نعم' : 'لا'}</td></tr>)}</tbody></table>}
    <div className="btn-row"><button className="btn" onClick={onOpenDesigner}>فتح منشئ التدفقات</button></div>
  </Card>;
}
export function UserInputResponses({ b }: { b: Bundle }) {
  const [copied, setCopied] = useState('');
  const inbound = b.messages.filter((m) => m.direction === 'in' && !m.is_internal_note).slice().reverse().slice(0, 50);
  return <Card title="ردود إدخال المستخدم (User Input Responses)" sub="الرسائل الواردة الفعلية من العملاء — إجاباتهم على أسئلة التدفقات تظهر هنا كما وصلت، بلا تعديل.">
    {inbound.length === 0 ? <Empty text="لا ردود واردة بعد." /> :
      <table><thead><tr><th>المحادثة</th><th>المرسل</th><th>الرد</th><th>الوقت</th><th></th></tr></thead><tbody>{inbound.map((m) => <tr key={m.id}><td>{m.conversation_id}</td><td>{m.sender_name || '—'}</td><td>{m.body || m.template_name || '—'}</td><td className="small">{fmt(m.created_at)}</td><td><button className="btn small ghost" onClick={async () => { try { await navigator.clipboard.writeText(m.body || ''); setCopied(`تم نسخ رد #${m.id}.`); } catch { setCopied('تعذر النسخ في هذا المتصفح.'); } }}>نسخ</button></td></tr>)}</tbody></table>}
    {copied && <p className="msg">{copied}</p>}
  </Card>;
}
export function HandoffPage({ b, reload }: { b: Bundle; reload: () => void }) {
  const [msg, setMsg] = useState('');
  const handed = realConvs(b).filter((c) => c.automation_handed_off);
  const open = realConvs(b).filter((c) => !c.automation_handed_off && ['new', 'open', 'pending'].includes(c.status));
  return <Card title="التحويل البشري (Human handoff)" sub="محادثات أوقف فيها الأتمتة بانتظار موظف — الاستئناف لا يتم إلا بضغطة موظف.">
    <h3>محادثات محوَّلة الآن ({handed.length})</h3>
    {handed.length === 0 ? <Empty text="لا محادثات محوَّلة الآن." /> :
      <table><thead><tr><th>المحادثة</th><th>مكلَّف به</th><th></th></tr></thead><tbody>{handed.map((c) => <tr key={c.id}><td>{c.contract_id ? `عقد ${c.contract_id}` : 'عامة'} — {c.party}</td><td>{c.assigned_to || 'غير معيّن'}</td><td><button className="btn small" onClick={async () => { try { await api.resumeAutomation(c.id); setMsg('تم استئناف الأتمتة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>استئناف الأتمتة</button></td></tr>)}</tbody></table>}
    <h3>محادثات مفتوحة يمكن تحويلها ({open.length})</h3>
    {open.length === 0 ? <Empty text="لا محادثات مفتوحة." /> :
      <table><thead><tr><th>المحادثة</th><th></th></tr></thead><tbody>{open.slice(0, 20).map((c) => <tr key={c.id}><td>{c.contract_id ? `عقد ${c.contract_id}` : 'عامة'} — {c.party}</td><td><button className="btn small ghost" onClick={async () => { try { await api.handoffConversation(c.id); setMsg('تم تحويل المحادثة لموظف.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تحويل لموظف</button></td></tr>)}</tbody></table>}
    {msg && <p className="msg">{msg}</p>}
  </Card>;
}
export function ChatWidgetPage() {
  const [cfg, setCfg] = useState(() => loadLocal('ps_widget', { title: 'Pilot System — دعم العقود', greeting: 'أهلاً بك، كيف نخدمك في عقدك؟', hours: '9:00–17:00', enabled: false }));
  const [msg, setMsg] = useState('');
  return <Card title="أداة الدردشة (Chat Widget) — إعدادات فقط" sub="صفحة إعدادات محلية فقط. لا موقع عميل عام ولا واجهة عميل حية في هذا النظام المغلق — هذه الإعدادات لا تنشئ موقعاً ولا ترسل شيئاً.">
    <div className="grid2">
      <Field label="عنوان الأداة"><input value={cfg.title} onChange={(e) => setCfg({ ...cfg, title: e.target.value })} /></Field>
      <Field label="رسالة الترحيب"><input value={cfg.greeting} onChange={(e) => setCfg({ ...cfg, greeting: e.target.value })} /></Field>
      <Field label="ساعات العمل"><input value={cfg.hours} onChange={(e) => setCfg({ ...cfg, hours: e.target.value })} /></Field>
      <label className="check"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> مفعّلة (إعداد محلي فقط)</label>
    </div>
    <div className="btn-row"><button className="btn" onClick={() => { saveLocal('ps_widget', cfg); setMsg('تم حفظ إعدادات الأداة محلياً.'); }}>حفظ الإعدادات</button></div>
    <h3>معاينة شكل الأداة (محلية فقط)</h3>
    <div className="wa-bubble"><b>{cfg.title}</b><div>{cfg.greeting}</div><div className="small">ساعات العمل: {cfg.hours} • {cfg.enabled ? 'مفعّلة' : 'متوقفة'}</div></div>
    {msg && <p className="msg">{msg}</p>}
  </Card>;
}

// ---------- AI (draft-only) ----------
interface KbEntry { q: string; a: string }
interface AiSettings { limit: number; maxLen: number; agentName: string; agentInstructions: string }
function aiSettings(): AiSettings { return loadLocal('ps_ai_settings', { limit: 20, maxLen: 500, agentName: 'مساعد المسودة', agentInstructions: 'اقترح ردوداً مهنية قصيرة، ولا تعد بسعر ولا بقرار مالي ولا بإغلاق صفقة.' }); }
export function AIWorkspace({ b, sub }: { b: Bundle; sub: string }) {
  const [settings, setSettings] = useState<AiSettings>(aiSettings);
  const [kb, setKb] = useState<KbEntry[]>(() => loadLocal('ps_kb', []));
  const [kbQ, setKbQ] = useState(''); const [kbA, setKbA] = useState('');
  const [input, setInput] = useState(''); const [draft, setDraft] = useState(''); const [draftNote, setDraftNote] = useState('');
  const [msg, setMsg] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const draftsToday = loadLocal<Record<string, number>>('ps_ai_drafts', {})[today] || 0;
  function suggest() {
    if (draftsToday >= settings.limit) { setDraftNote(`بلغت حد المسودات اليومي (${settings.limit}) — أعد الضبط من صفحة الحصص.`); return; }
    const words = input.toLowerCase().split(/\s+/).filter(Boolean);
    let best: KbEntry | null = null; let bestScore = 0;
    for (const e of kb) { const score = words.filter((w) => e.q.toLowerCase().includes(w)).length; if (score > bestScore) { bestScore = score; best = e; } }
    const d = best && bestScore > 0 ? best.a : 'شكراً على رسالتك، سنراجع التفاصيل المتعلقة بعقدك ونرد عليك خلال ساعات العمل. لا يوجد هنا أي قرار مالي أو وعد بسعر.';
    const out = d.slice(0, settings.maxLen);
    setDraft(out); setDraftNote('مسودة فقط — لم تُرسل إلى أي عميل، ولا تبيع ولا تغلق صفقة. يراجعها موظف قبل أي إرسال من الإنبكس.');
    const all = loadLocal<Record<string, number>>('ps_ai_drafts', {}); all[today] = draftsToday + 1; saveLocal('ps_ai_drafts', all);
  }
  const saveSettings = () => { saveLocal('ps_ai_settings', settings); setMsg('تم حفظ إعدادات المساعد محلياً.'); };
  if (sub === 'dashboard') return <Card title="لوحة مساعد الذكاء الاصطناعي (مسودة فقط)" sub="لا إرسال تلقائي أبداً، ولا بيع، ولا إغلاق صفقات. المساعد يقترح مسودة يراجعها موظف فقط.">
    <div className="chips"><span className="chip">تدفقات: {b.workflows.length}</span><span className="chip">مسودات اليوم: {draftsToday} / {settings.limit}</span><span className="chip">قاعدة المعرفة: {kb.length} مدخل</span><span className="chip">مفتاح الإيقاف: {b.killSwitch ? 'مُفعَّل' : 'متوقف'}</span></div>
    <p className="muted">الوضع ثابت: مسودة فقط. لا يوجد زر يجعل المساعد يرسل وحده — هذا قيد تصميمي مقصود في النظام المغلق.</p>
  </Card>;
  if (sub === 'credits' || sub === 'quotas') return <Card title={sub === 'credits' ? 'أرصدة المساعد (AI Credits)' : 'حصص المساعد (Quotas)'} sub="عدادات محلية فقط — لا اشتراك ولا دفع داخل النظام.">
    <p>مسودات اليوم ({today}): <b>{draftsToday}</b> من حد <b>{settings.limit}</b></p>
    <Field label="الحد اليومي للمسودات"><input type="number" min="1" value={settings.limit} onChange={(e) => setSettings({ ...settings, limit: Number(e.target.value) })} /></Field>
    <div className="btn-row"><button className="btn" onClick={saveSettings}>حفظ الحد</button><button className="btn ghost" onClick={() => { const all = loadLocal<Record<string, number>>('ps_ai_drafts', {}); all[today] = 0; saveLocal('ps_ai_drafts', all); setMsg('تم تصفير عداد اليوم.'); }}>تصفير عداد اليوم</button></div>
    {msg && <p className="msg">{msg}</p>}
  </Card>;
  if (sub === 'settings') return <Card title="إعدادات المساعد (AI Settings)" sub="الوضع مسودة فقط ومقفول — لا يمكن تحويله إلى إرسال تلقائي أو بيع من هذه الصفحة.">
    <label className="check"><input type="checkbox" checked disabled /> مسودة فقط (مقفول — لا إرسال تلقائي)</label>
    <Field label="اسم المساعد"><input value={settings.agentName} onChange={(e) => setSettings({ ...settings, agentName: e.target.value })} /></Field>
    <Field label="تعليمات المساعد"><textarea rows={3} value={settings.agentInstructions} onChange={(e) => setSettings({ ...settings, agentInstructions: e.target.value })} /></Field>
    <Field label="أقصى طول للمسودة (حرف)"><input type="number" min="50" value={settings.maxLen} onChange={(e) => setSettings({ ...settings, maxLen: Number(e.target.value) })} /></Field>
    <div className="btn-row"><button className="btn" onClick={saveSettings}>حفظ الإعدادات</button></div>
    {msg && <p className="msg">{msg}</p>}
  </Card>;
  if (sub === 'agents') return <Card title="وكلاء الذكاء الاصطناعي (AI Agents)" sub="وكيل واحد فقط: مساعد مسودة. لا وكيل بيع ولا وكيل إغلاق صفقات — مرفوضان في هذا النظام.">
    <table><thead><tr><th>الاسم</th><th>الوضع</th><th>التعليمات</th></tr></thead><tbody><tr><td>{settings.agentName}</td><td><Badge tone="ok">مسودة فقط</Badge></td><td>{settings.agentInstructions}</td></tr></tbody></table>
    <p className="muted">تعديل الاسم والتعليمات يتم من صفحة الإعدادات.</p>
  </Card>;
  if (sub === 'test-chat') return <Card title="دردشة اختبار المساعد (Test Chat)" sub="محاكاة محلية فقط: اكتب رسالة عميل، واحصل على مسودة مقترحة. لا شيء هنا يُرسل إلى واتساب.">
    <Field label="رسالة العميل (للاختبار)"><textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder="مثال: هل العقد جاهز للتوقيع؟" /></Field>
    <div className="btn-row"><button className="btn" onClick={suggest}>اقتراح مسودة</button></div>
    {draft && <div className="wa-bubble"><b>المسودة المقترحة:</b><div>{draft}</div></div>}
    {draftNote && <p className="msg">{draftNote}</p>}
    <p className="muted">المسودة تُبنى من قاعدة المعرفة أولاً، ثم من رد عام محايد. لإرسال أي رد حقيقي، انسخ المسودة إلى الإنبكس بعد مراجعتها.</p>
  </Card>;
  if (sub === 'triggers') return <Card title="مشغّلات المساعد (Triggers)" sub="مشغّلات التدفقات الفعلية في الخادم — المساعد نفسه لا يملك مشغّل إرسال مستقل.">
    {b.workflows.length === 0 ? <Empty text="لا تدفقات بعد." /> :
      <table><thead><tr><th>التدفق</th><th>المشغّل</th><th>القيمة</th><th>نشط</th></tr></thead><tbody>{b.workflows.map((w: Workflow) => <tr key={w.id}><td>{w.name}</td><td>{w.trigger_type}</td><td>{w.trigger_value || '—'}</td><td>{w.is_active ? 'نعم' : 'لا'}</td></tr>)}</tbody></table>}
  </Card>;
  if (sub === 'business-hours') return <Card title="ساعات عمل المساعد (Business Hours)" sub="إعداد محلي: خارج هذه الساعات تُقترح مسودة ترحيب/غياب فقط، ولا إرسال تلقائي.">
    <BusinessHoursForm />
  </Card>;
  // knowledge-base (default)
  return <Card title="قاعدة المعرفة (Knowledge Base)" sub="مدخلات محلية فقط: سؤال وجواب يستخدمها اختبار المساعد لاقتراح المسودات. لا بيانات عميل حقيقية هنا إلا ما تدخله أنت.">
    <div className="grid2">
      <Field label="السؤال"><input value={kbQ} onChange={(e) => setKbQ(e.target.value)} placeholder="مثال: هل العقد جاهز؟" /></Field>
      <Field label="الجواب المقترح كمسودة"><input value={kbA} onChange={(e) => setKbA(e.target.value)} placeholder="مثال: نعم، العقد جاهز وسنرسل التفاصيل…" /></Field>
    </div>
    <div className="btn-row"><button className="btn" onClick={() => { if (!kbQ.trim() || !kbA.trim()) { setMsg('أدخل السؤال والجواب.'); return; } const next = [...kb, { q: kbQ.trim(), a: kbA.trim() }]; setKb(next); saveLocal('ps_kb', next); setKbQ(''); setKbA(''); setMsg('تمت إضافة المدخل إلى قاعدة المعرفة محلياً.'); }}>إضافة مدخل</button></div>
    {kb.length === 0 ? <Empty text="لا مدخلات بعد." /> :
      <table><thead><tr><th>السؤال</th><th>الجواب</th><th></th></tr></thead><tbody>{kb.map((e, i) => <tr key={i}><td>{e.q}</td><td>{e.a}</td><td><button className="btn small ghost" onClick={() => { const next = kb.filter((_, j) => j !== i); setKb(next); saveLocal('ps_kb', next); }}>حذف</button></td></tr>)}</tbody></table>}
    {msg && <p className="msg">{msg}</p>}
  </Card>;
}
function BusinessHoursForm() {
  const [h, setH] = useState(() => loadLocal('ps_business_hours', { start: '09:00', end: '17:00', days: 'الأحد–الخميس' }));
  const [msg, setMsg] = useState('');
  return <>
    <div className="grid2">
      <Field label="من"><input value={h.start} onChange={(e) => setH({ ...h, start: e.target.value })} /></Field>
      <Field label="إلى"><input value={h.end} onChange={(e) => setH({ ...h, end: e.target.value })} /></Field>
      <Field label="الأيام"><input value={h.days} onChange={(e) => setH({ ...h, days: e.target.value })} /></Field>
    </div>
    <div className="btn-row"><button className="btn" onClick={() => { saveLocal('ps_business_hours', h); setMsg('تم حفظ ساعات العمل محلياً.'); }}>حفظ</button></div>
    {msg && <p className="msg">{msg}</p>}
  </>;
}

// ---------- Team ----------
export function TeamPerformance({ b }: { b: Bundle }) {
  const rows = b.users.map((u) => {
    const assigned = realConvs(b).filter((c) => c.assigned_to === u.full_name).length;
    const sent = b.messages.filter((m) => m.direction === 'out' && !m.is_internal_note && m.sender_name === u.full_name).length;
    const unread = realConvs(b).filter((c) => c.assigned_to === u.full_name).reduce((s, c) => s + (c.unread_count || 0), 0);
    return { u, assigned, sent, unread };
  });
  return <Card title="أداء الفريق ومؤشراته (Team Performance & KPIs)" sub="من بيانات حقيقية: محادثات مكلَّف بها، ردود صادرة، غير مقروءة — وليس تقييم مبيعات.">
    <table><thead><tr><th>الموظف</th><th>الدور</th><th>محادثات مكلَّف بها</th><th>ردود صادرة</th><th>غير مقروءة لديه</th></tr></thead><tbody>{rows.map((r) => <tr key={r.u.id}><td>{r.u.full_name}</td><td>{r.u.role}</td><td>{r.assigned}</td><td>{r.sent}</td><td>{r.unread}</td></tr>)}</tbody></table>
  </Card>;
}
export function Distribution({ b, reload }: { b: Bundle; reload: () => void }) {
  const [msg, setMsg] = useState('');
  const unassigned = realConvs(b).filter((c) => !c.assigned_to && ['new', 'open', 'pending'].includes(c.status));
  const load = b.users.map((u) => ({ u, n: realConvs(b).filter((c) => c.assigned_to === u.full_name).length })).sort((a, b2) => a.n - b2.n);
  async function distribute() {
    if (!load.length || !unassigned.length) { setMsg('لا محادثات غير معيّنة أو لا موظفين.'); return; }
    try {
      for (const c of unassigned) { const target = load[0].u; await api.assignConversation(c.id, target.full_name); load[0].n++; load.sort((a, b2) => a.n - b2.n); }
      setMsg(`تم توزيع ${unassigned.length} محادثة غير معيّنة على الأقل عبئاً، محادثة بمحادثة.`);
      reload();
    } catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  return <Card title="توزيع المهام (Lead Distribution — مكيَّف)" sub="توزيع محادثات غير معيّنة على الموظفين حسب العبء — وليس توزيع عملاء محتملين للتسويق. كل تعيين يُسجَّل في التدقيق.">
    <p>محادثات غير معيّنة مفتوحة: <b>{unassigned.length}</b></p>
    <table><thead><tr><th>الموظف</th><th>محادثات مكلَّف بها الآن</th></tr></thead><tbody>{load.map((r) => <tr key={r.u.id}><td>{r.u.full_name}</td><td>{r.n}</td></tr>)}</tbody></table>
    <div className="btn-row"><button className="btn" disabled={unassigned.length === 0} onClick={distribute}>وزّع غير المعيّنة على الأقل عبئاً</button></div>
    {msg && <p className="msg">{msg}</p>}
  </Card>;
}
export function QASettings() {
  const [s, setS] = useState(() => loadLocal('ps_qa', { secondReview: true, blockMoney: true, templateApproval: true, demoCheck: true }));
  const [msg, setMsg] = useState('');
  return <Card title="إعدادات الجودة (QA Settings)" sub="ضوابط مراجعة بشرية — محلية. القيدان الماليان مقفولان ولا يمكن إيقافهما من هنا.">
    <label className="check"><input type="checkbox" checked={s.secondReview} onChange={(e) => setS({ ...s, secondReview: e.target.checked })} /> مراجعة ثانية قبل إرسال أي قالب</label>
    <label className="check"><input type="checkbox" checked disabled /> منع أي خطوة مالية آلية (مقفول — قيد نظام)</label>
    <label className="check"><input type="checkbox" checked disabled /> اعتماد القالب محلياً + لدى Meta قبل الإرسال (مقفول — قيد نظام)</label>
    <label className="check"><input type="checkbox" checked={s.demoCheck} onChange={(e) => setS({ ...s, demoCheck: e.target.checked })} /> التحقق من حذف البيانات التجريبية قبل أي تقرير حقيقي</label>
    <div className="btn-row"><button className="btn" onClick={() => { saveLocal('ps_qa', s); setMsg('تم حفظ إعدادات الجودة محلياً.'); }}>حفظ</button></div>
    {msg && <p className="msg">{msg}</p>}
  </Card>;
}

// ---------- Tickets / Feedback ----------
export function MyTickets({ b, reload, me }: { b: Bundle; reload: () => void; me: MeUser | null }) {
  const [msg, setMsg] = useState('');
  const mine = b.tasks.filter((t) => me && ((t as { assigned_to?: string | null }).assigned_to === me.full_name || (t as { assigned_to?: string | null }).assigned_to === me.email));
  const open = mine.filter((t) => t.status === 'open');
  return <Card title="تذاكري (My Tickets)" sub="مهام تشغيل مكلَّف بها أنت — الإكمال والإلغاء عبر الخادم ويُسجَّلان في التدقيق.">
    {mine.length === 0 ? <Empty text="لا مهام مكلَّف بها أنت بعد — المهام تُنشأ مع العقود أو من صفحة مهام التشغيل." /> :
      <table><thead><tr><th>المهمة</th><th>العقد</th><th>النوع</th><th>الحالة</th><th></th></tr></thead><tbody>{mine.map((t) => <tr key={t.id}><td>{t.title}</td><td>{t.contract_id}</td><td>{t.type}</td><td>{t.status}</td><td>{t.status === 'open' && <><button className="btn small" onClick={async () => { try { await api.taskAction(t.id, 'complete'); setMsg('تم إكمال المهمة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>إكمال</button> <button className="btn small ghost" onClick={async () => { try { await api.taskAction(t.id, 'cancel'); setMsg('تم إلغاء المهمة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>إلغاء</button></>}</td></tr>)}</tbody></table>}
    <p className="muted">مهامك المفتوحة: {open.length} من {mine.length}</p>
    {msg && <p className="msg">{msg}</p>}
  </Card>;
}
interface FeedbackItem { title: string; kind: string; body: string; status: string }
export function FeedbackPage() {
  const [list, setList] = useState<FeedbackItem[]>(() => loadLocal('ps_feedback', []));
  const [f, setF] = useState({ title: '', kind: 'idea', body: '' });
  const [msg, setMsg] = useState('');
  return <Card title="أفكار وملاحظات (Ideas & Feedback)" sub="قائمة محلية فقط — تُحفظ في متصفحك، وليست قناة دعم خارجية ولا تُرسل لأي طرف.">
    <div className="grid2">
      <Field label="العنوان"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="النوع"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="idea">فكرة</option><option value="feedback">ملاحظة</option><option value="bug">مشكلة</option></select></Field>
      <Field label="التفاصيل"><textarea rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
    </div>
    <div className="btn-row"><button className="btn" onClick={() => { if (!f.title.trim()) { setMsg('أدخل العنوان.'); return; } const next = [...list, { ...f, status: 'جديدة' }]; setList(next); saveLocal('ps_feedback', next); setF({ title: '', kind: 'idea', body: '' }); setMsg('تم حفظ الملاحظة محلياً.'); }}>إضافة</button></div>
    {list.length === 0 ? <Empty text="لا ملاحظات بعد." /> :
      <table><thead><tr><th>العنوان</th><th>النوع</th><th>الحالة</th><th></th></tr></thead><tbody>{list.map((it, i) => <tr key={i}><td>{it.title}<div className="small">{it.body}</div></td><td>{it.kind}</td><td>{it.status}</td><td><button className="btn small ghost" onClick={() => { const next = list.map((x, j) => j === i ? { ...x, status: x.status === 'جديدة' ? 'تمت المراجعة' : 'جديدة' } : x); setList(next); saveLocal('ps_feedback', next); }}>تبديل الحالة</button> <button className="btn small ghost" onClick={() => { const next = list.filter((_, j) => j !== i); setList(next); saveLocal('ps_feedback', next); }}>حذف</button></td></tr>)}</tbody></table>}
    {msg && <p className="msg">{msg}</p>}
  </Card>;
}

// ---------- Settings expansion ----------
export function BillingPage({ b }: { b: Bundle }) {
  return <Card title="تفاصيل الفوترة (Billing Details) — عرض فقط" sub="لا يتم تحصيل أي مبلغ من داخل النظام، ولا توجد نماذج دفع هنا. هذه أرقام استخدام فقط.">
    <div className="chips"><span className="chip">الخطة: Pilot — تجريبي مغلق</span><span className="chip">عقود حقيقية: {realContracts(b).length}</span><span className="chip">محادثات حقيقية: {realConvs(b).length}</span><span className="chip">رسائل: {b.messages.length}</span><span className="chip">قوالب: {b.templates.length}</span></div>
    <p className="muted">تكاليف الاستضافة وMeta تُدفع خارج النظام، لدى مزوديها، وباسم العميل — وليس عبر Pilot System.</p>
  </Card>;
}
export function WebhookPage() {
  const [link, setLink] = useState<LinkingPayload | null>(null);
  useEffect(() => { api.linking().then(setLink).catch(() => setLink(null)); }, []);
  return <Card title="Webhook" sub="إعداد Webhook الفعلي من الخادم — لا أسرار ولا رموز هنا أبداً، فقط حالات مضبوط/غير مضبوط.">
    {!link ? <p className="muted">جارٍ القراءة…</p> : <>
      <p>الرابط: <code>{link.webhook_url || 'غير مضبوط'}</code></p>
      <p>عنوان النظام: {link.app_base_url || 'غير مضبوط'}</p>
      <div className="chips"><span className="chip">Verify Token: {link.webhook_verify_configured ? 'مضبوط' : 'غير مضبوط'}</span><span className="chip">HMAC Secret: {link.webhook_hmac_configured ? 'مضبوط' : 'غير مضبوط'}</span><span className="chip">WABA: {link.waba_configured ? 'مضبوط' : 'غير مضبوط'}</span><span className="chip">رقم الهاتف: {link.phone_number_configured ? 'مضبوط' : 'غير مضبوط'}</span></div>
      <p className="muted">الحقول المشترك بها: messages ، message_status ، message_template_status_update.</p>
    </>}
  </Card>;
}
export function ApiPage() {
  const rows = [
    ['GET', '/api/contracts', 'contracts:view', 'قائمة العقود'],
    ['POST', '/api/contracts', 'contracts:create', 'إنشاء عقد'],
    ['GET', '/api/contracts/:id/pdf', 'contracts:view', 'تنزيل العقد PDF'],
    ['GET', '/api/conversations', 'inbox:view', 'قائمة المحادثات'],
    ['POST', '/api/demo-conversation', 'inbox:edit', 'إنشاء محادثة تجريبية'],
    ['DELETE', '/api/demo-conversation', 'inbox:edit', 'حذف المحادثة التجريبية'],
    ['POST', '/api/demo-contract', 'contracts:create', 'إنشاء عقد تجريبي'],
    ['DELETE', '/api/demo-contract', 'contracts:create', 'حذف العقد التجريبي'],
    ['GET', '/api/whatsapp/linking', 'whatsapp:view', 'حالة الربط (7 خطوات)'],
    ['GET', '/api/reports/summary', 'dashboard:view', 'تقرير حقيقي (التجريبي مستبعد)'],
    ['POST', '/api/workflows', 'automation:create', 'إنشاء تدفق (خطوات مالية مرفوضة)'],
    ['GET', '/api/audit', 'audit:view', 'سجل التدقيق (قراءة فقط)'],
  ];
  return <Card title="واجهة برمجة التطبيقات (API)" sub="كتالوج نقاط النهاية الداخلية — لا مفاتيح API لطرف ثالث ولا وصول خارجي في هذا النظام المغلق، وكل نقطة تتطلب رمز دخول HMAC صالحاً.">
    <table><thead><tr><th>الطريقة</th><th>المسار</th><th>الصلاحية</th><th>الوصف</th></tr></thead><tbody>{rows.map(([m, p, perm, d]) => <tr key={p}><td>{m}</td><td><code>{p}</code></td><td>{perm}</td><td>{d}</td></tr>)}</tbody></table>
    <p className="muted">لا يوجد توليد مفاتيح هنا عمداً: أي تكامل خارجي يجب أن يمر عبر موافقة المالك وإعدادات بيئة الخادم، وليس عبر زر في الواجهة.</p>
  </Card>;
}
export function IntegrationsPage({ b }: { b: Bundle }) {
  const [link, setLink] = useState<LinkingPayload | null>(null);
  useEffect(() => { api.linking().then(setLink).catch(() => setLink(null)); }, []);
  const rows = [
    ['Meta WhatsApp Cloud API', link ? (link.configured ? 'موصول' : 'غير موصول بعد') : 'جارٍ القراءة…', 'الربط الرسمي فقط — لا واتساب ويب ولا QR'],
    ['PostgreSQL للإنتاج', 'قيد الانتظار', 'المخطط موجود (db/schema.sql)؛ التشغيل الحالي بملف JSON للتجربة فقط — لا بيانات عميل حقيقية قبل الترحيل'],
    ['المؤسسة المالية (يدوي)', 'اتفاق يدوي خارج النظام', 'لا واجهة بنكية آلية — تأكيد الدفع بمرجع منها فقط'],
    ['الاستضافة (Render)', b.healthOk ? 'تعمل' : 'غير متصل', 'النشر التلقائي عند الرفع إلى main'],
    ['GitHub (المستودع الخاص)', 'مستودع خاص', 'التخزين والنشر فقط — لا أسرار في أي رفع'],
  ];
  return <Card title="التكاملات (Integrations)" sub="حالات حقيقية فقط — لا تكامل يُعرض موصولاً وهو غير موصول.">
    <table><thead><tr><th>التكامل</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>{rows.map(([n, s, note]) => <tr key={n}><td>{n}</td><td>{s}</td><td>{note}</td></tr>)}</tbody></table>
  </Card>;
}
