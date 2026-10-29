// WhatsApp workspace — Round 3 triptych. NO cards, NO admin page chrome,
// NO pill sub-tabs inside the workspace. It is the whole content area:
//   desktop (>=820px): conversation list | chat | details panel, full height
//   phone (<820px):    list first; tapping a conversation REPLACES it with
//                      the chat (back button returns to the list); details
//                      is a side drawer opened from the chat header.
// One workspace, one template library, one automation engine behind it.
// Internal notes render as centred system notices, never as bubbles.
// The demo conversation (if created) is labelled everywhere as test-only,
// has no real phone number and no contract, and is never sent to Meta.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type AutomationLog, type WhatsAppUpload } from './api';
import { Badge, Empty, Field, fmt } from './components';
import { TEMPLATE_AR, type Contact, type QuickReply, type Contract, type Conversation, type MeUser, type Message, type Template, type User, type Workflow } from './types';

export interface WorkspaceBundle {
  contracts: Contract[]; conversations: Conversation[]; messages: Message[];
  templates: Template[]; users: User[];
}
function contractOf(b: WorkspaceBundle, id: number | null) { return b.contracts.find((c) => c.id === id) || null; }
function phoneOf(b: WorkspaceBundle, conv: Conversation): string {
  if (conv.is_demo) return '';
  const c = contractOf(b, conv.contract_id);
  if (c) return conv.party === 'seller' ? c.seller_phone : c.buyer_phone;
  return conv.phone || '';
}
function nameOf(b: WorkspaceBundle, conv: Conversation): string {
  if (conv.display_name) return conv.display_name;
  const c = contractOf(b, conv.contract_id);
  if (c) return `${c.code} — ${conv.party === 'buyer' ? 'المشتري' : conv.party === 'seller' ? 'البائع' : 'عام'}`;
  return `محادثة عامة — ${conv.phone || conv.id}`;
}
function statusAr(m: Message): string {
  if (m.is_internal_note) return 'ملاحظة داخلية (لا تُرسل)';
  if (m.dry_run) return 'تجريبي — لم يُرسل إلى واتساب';
  if (!m.meta_status) return m.direction === 'in' ? 'وارد' : 'مسجّل محلياً';
  return m.meta_status === 'sent' ? 'أُرسلت' : m.meta_status === 'delivered' ? 'سُلّمت' : m.meta_status === 'read' ? 'قُرئت' : m.meta_status === 'failed' ? 'فشلت' : m.meta_status;
}
function initials(s: string): string { const w = s.replace(/[^\w\u0600-\u06FF ]/g, '').trim().split(/\s+/).filter(Boolean); if (!w.length) return '؟'; return (w[0][0] + (w[1] ? w[1][0] : '')).toUpperCase(); }
function shortTime(dt?: string | null): string { if (!dt) return ''; const d = new Date(dt); const today = new Date(); const same = d.toDateString() === today.toDateString(); return same ? d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ar', { day: 'numeric', month: 'numeric' }); }
function dateLabel(dt: string): string { const d = new Date(dt); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1); if (d.toDateString() === today.toDateString()) return 'اليوم'; if (d.toDateString() === y.toDateString()) return 'أمس'; return d.toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function ticks(m: Message): string { if (m.direction !== 'out' || m.is_internal_note) return ''; if (m.dry_run) return 'تجريبي'; if (m.meta_status === 'read') return '✓✓ مقروءة'; if (m.meta_status === 'delivered') return '✓✓ سُلّمت'; if (m.meta_status === 'sent') return '✓ أُرسلت'; if (m.meta_status === 'failed') return '✗ فشلت — أعد المحاولة'; return '✓ مسجّلة'; }
function templateButtons(tpl: Template | undefined, m?: Message): string[] {
  if (tpl && tpl.buttons) {
    if (Array.isArray(tpl.buttons)) { const v = tpl.buttons.map((x: unknown) => typeof x === 'string' ? x : (x as { title?: string; text?: string }).title || (x as { text?: string }).text || '').filter(Boolean); if (v.length) return v; }
  }
  return m?.buttons || [];
}

export function WhatsAppWorkspace({ b, reload, me }: { b: WorkspaceBundle; reload: () => void; me: MeUser | null }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'mine' | 'open' | 'resolved' | 'unassigned'>('all');
  const [channel, setChannel] = useState('all');
  const [agentFilter, setAgentFilter] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [tagFilter, setTagFilter] = useState('');
  const [selId, setSelId] = useState<number | null>(null);
  const [chatQ, setChatQ] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerContact, setDrawerContact] = useState<Contact | null>(null);
  const [msg, setMsg] = useState('');
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [macros, setMacros] = useState<Workflow[]>([]);
  const [uploads, setUploads] = useState<WhatsAppUpload[]>([]);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [mode, setMode] = useState<'text' | 'template' | 'media'>('text');
  const [body, setBody] = useState('');
  const [template, setTemplate] = useState('');
  const [internal, setInternal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [macroId, setMacroId] = useState<number | ''>('');
  const [attachKind, setAttachKind] = useState<'image' | 'video' | 'document' | 'audio' | null>(null);
  const [showQr, setShowQr] = useState(false);
  const attachRef = useRef<HTMLInputElement>(null);
  const [tagsInput, setTagsInput] = useState('');
  const [replyToId, setReplyToId] = useState<number | null>(null);
  const [jumpId, setJumpId] = useState<number | null>(null);

  const demo = b.conversations.find((c) => c.is_demo) || null;
  useEffect(() => {
    api.quickReplies().then(setQuickReplies).catch(() => setQuickReplies([]));
    api.macros().then(setMacros).catch(() => setMacros([]));
    api.whatsappUploads().then(setUploads).catch(() => setUploads([]));
  }, []);
  useEffect(() => { setLastUpdated(new Date()); }, [b.conversations, b.messages]);
  // On desktop, open the demo thread automatically so the triptych shape is
  // visible at once. On phone the list stays first (CSS hides the chat
  // until a row is tapped), so never auto-open there.
  useEffect(() => {
    if (selId === null && demo && typeof window !== 'undefined' && window.innerWidth >= 820) setSelId(demo.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo?.id]);

  const isMine = (c: Conversation) => !!me && (c.assigned_to === me.full_name || c.assigned_to === me.email || c.assigned_to === String(me.id));
  const allTags = useMemo(() => [...new Set(b.conversations.flatMap((c) => c.labels || []))], [b.conversations]);
  const agents = useMemo(() => [...new Set([...b.users.map((u) => u.full_name), ...b.conversations.map((c) => c.assigned_to || '').filter(Boolean)])], [b.users, b.conversations]);
  const list = [...b.conversations].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)).filter((c) => {
    if (channel === 'whatsapp') { /* only channel in this pilot is WhatsApp */ }
    if (filter === 'unread' && !(c.unread_count || 0)) return false;
    if (filter === 'mine' && !isMine(c)) return false;
    if (filter === 'open' && !['new', 'open', 'pending'].includes(c.status)) return false;
    if (filter === 'resolved' && c.status !== 'resolved') return false;
    if (filter === 'unassigned' && c.assigned_to) return false;
    if (agentFilter === '__unassigned__' && c.assigned_to) return false;
    if (agentFilter && agentFilter !== '__unassigned__' && c.assigned_to !== agentFilter) return false;
    if (tagFilter && !(c.labels || []).includes(tagFilter)) return false;
    if (q.trim()) {
      const hay = `${nameOf(b, c)} ${phoneOf(b, c)} ${c.assigned_to || ''} ${(c.labels || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });
  const sel = b.conversations.find((c) => c.id === selId) || null;
  const thread = sel ? b.messages.filter((m) => m.conversation_id === sel.id).sort((x, y) => x.id - y.id) : [];
  const shownThread = chatQ.trim() ? thread.filter((m) => String(m.body || '').toLowerCase().includes(chatQ.trim().toLowerCase()) || String(m.template_name || '').toLowerCase().includes(chatQ.trim().toLowerCase())) : thread;
  const lastInbound = sel ? [...thread].reverse().find((m) => m.direction === 'in' && !m.is_internal_note) : null;
  const windowOpen = lastInbound ? (Date.now() - Date.parse(lastInbound.created_at)) < 24 * 3600 * 1000 : false;
  const unreadTotal = b.conversations.filter((c) => !c.is_demo).reduce((s, c) => s + (c.unread_count || 0), 0);
  const canEdit = !!me && ((me as { actions?: Record<string, string[]> }).actions?.whatsapp?.includes('edit') || me.role === 'owner' || me.is_primary_admin);
  const qrMatches = body.startsWith('/') ? quickReplies.filter((r) => r.shortcut.startsWith(body.split(' ')[0])) : [];
  const selContract = sel ? contractOf(b, sel.contract_id) : null;
  const otherConvs = sel ? b.conversations.filter((c) => c.id !== sel.id && ((sel.contract_id !== null && c.contract_id === sel.contract_id) || (phoneOf(b, sel) && phoneOf(b, c) === phoneOf(b, sel)))) : [];
  const notes = thread.filter((m) => m.is_internal_note);

  async function openDrawer() {
    if (!sel) return;
    setDrawerOpen(true); setDrawerContact(null);
    try {
      const phone = phoneOf(b, sel);
      const found = phone ? await api.contacts({ q: phone }) : [];
      setDrawerContact(found[0] || null);
    } catch { setDrawerContact(null); }
  }
  async function createDemo() {
    setMsg('');
    try { const r = await api.createDemoConversation(); setSelId(r.conversation.id); setMsg(r.already ? 'المحادثة التجريبية موجودة أصلاً — فُتحت أمامك.' : 'تم إنشاء المحادثة التجريبية — تجريبي فقط، بلا رقم حقيقي، ولن يُرسل إلى واتساب.'); reload(); }
    catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  async function deleteDemo() {
    try { const r = await api.deleteDemoConversation(); setSelId(null); setMsg(`تم حذف المحادثة التجريبية — ${r.conversations_deleted} محادثة و${r.messages_deleted} رسالة.`); reload(); }
    catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  async function send() {
    if (!sel) return;
    setMsg('');
    try {
      // Demo thread: everything stays local, is_demo, never Meta.
      if (sel.is_demo) {
        if (mode === 'media') { setMsg('المحادثة التجريبية لا ترسل وسائط إلى واتساب — الخيط التجريبي يحتوي مثال وسائط جاهزاً.'); return; }
        if (internal) {
          if (!body.trim()) { setMsg('اكتب نص الملاحظة الداخلية أولاً.'); return; }
          await api.sendMessage({ conversation_id: sel.id, direction: 'out', sender_name: me?.full_name || 'operator', body: body.trim(), is_internal_note: true, is_demo: true, reply_to_id: replyToId });
          setReplyToId(null); setBody(''); setInternal(false); setMsg('تم حفظ الملاحظة التجريبية — لم تُرسل للعميل أبداً.'); reload(); return;
        }
        if (mode === 'template') {
          if (!template) { setMsg('اختر قالباً.'); return; }
          await api.sendMessage({ conversation_id: sel.id, direction: 'out', sender_name: me?.full_name || 'operator', body: `قالب: ${template}`, template_name: template, is_internal_note: false, is_demo: true, reply_to_id: replyToId });
          setTemplate(''); setMsg('تم تسجيل القالب التجريبي محلياً — لم يُرسل إلى واتساب.'); reload(); return;
        }
        if (!body.trim()) { setMsg('اكتب نصاً أو اختر قالباً.'); return; }
        await api.sendMessage({ conversation_id: sel.id, direction: 'out', sender_name: me?.full_name || 'operator', body: body.trim(), is_internal_note: false, is_demo: true, reply_to_id: replyToId });
        setBody(''); setReplyToId(null); setMsg('تم تسجيل الرد التجريبي محلياً — لم يُرسل إلى واتساب.'); reload(); return;
      }
      if (internal) {
        if (!body.trim()) { setMsg('اكتب نص الملاحظة الداخلية أولاً.'); return; }
        await api.sendMessage({ conversation_id: sel.id, direction: 'out', sender_name: me?.full_name || 'operator', body: body.trim(), is_internal_note: true, reply_to_id: replyToId });
        setReplyToId(null); setMsg('تم حفظ الملاحظة الداخلية — لم تُرسل للعميل أبداً.'); setBody(''); setInternal(false); reload(); return;
      }
      if (mode === 'media') {
        if (!file) { setMsg('اختر ملفاً أولاً (حتى 16 ميجابايت).'); return; }
        const r = await api.whatsappUpload(file, { conversation_id: sel.id });
        setMsg(r.dry_run ? 'تم حفظ الملف محلياً (وضع تجريبي — لم يُرسل إلى واتساب).' : 'تم رفع الملف وإرساله بمعرّف وسائط Meta.');
        setFile(null); setUploads(await api.whatsappUploads().catch(() => uploads)); reload(); return;
      }
      if (mode === 'template') {
        if (!template) { setMsg('اختر قالباً.'); return; }
        const tpl = b.templates.find((t) => t.name === template);
        if (tpl && tpl.approval_status !== 'approved') { setMsg('القالب غير معتمد محلياً — لا يمكن إرساله.'); return; }
        const phone = phoneOf(b, sel);
        if (phone) {
          const r = await api.whatsappSend({ to: phone, template_name: template, language: 'ar' });
          setMsg(r.ok ? (r.dry_run ? 'وضع تجريبي: لم يُرسل القالب إلى واتساب (Meta غير موصول).' : `أُرسل القالب إلى واتساب — ${r.wamid || ''}.`) : `لم يُرسل: ${r.error || 'خطأ غير معروف'}.`);
        } else {
          await api.sendMessage({ conversation_id: sel.id, direction: 'out', sender_name: me?.full_name || 'operator', body: `قالب: ${template}`, template_name: template, is_internal_note: false });
          setMsg('تم تسجيل القالب محلياً (لا رقم مرتبط بهذه المحادثة).');
        }
        setTemplate(''); reload(); return;
      }
      if (!body.trim()) { setMsg('اكتب نصاً أو اختر قالباً أو وسائط.'); return; }
      if (!windowOpen) { setMsg('خارج نافذة 24 ساعة: لا يمكن إرسال نص حر الآن — أرسل قالباً معتمداً بدلاً منه، أو انتظر رسالة جديدة من العميل.'); return; }
      const phone = phoneOf(b, sel);
      if (phone) {
        const r = await api.whatsappSend({ to: phone, body: body.trim() });
        setMsg(r.ok ? (r.dry_run ? 'وضع تجريبي: لم يُرسل النص إلى واتساب (Meta غير موصول).' : 'أُرسل النص إلى واتساب.') : `لم يُرسل: ${r.error || 'خطأ غير معروف'}.`);
      } else {
        await api.sendMessage({ conversation_id: sel.id, direction: 'out', sender_name: me?.full_name || 'operator', body: body.trim(), is_internal_note: false });
        setMsg('تم تسجيل الرد محلياً (لا رقم مرتبط بهذه المحادثة).');
      }
      setBody(''); reload();
    } catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }

  const triage: { id: typeof filter; label: string }[] = [
    { id: 'all', label: 'الكل' }, { id: 'unread', label: 'غير مقروءة' }, { id: 'mine', label: 'المعيّنة لي' },
    { id: 'unassigned', label: 'غير معيّنة' }, { id: 'open', label: 'المفتوحة' }, { id: 'resolved', label: 'المحلولة' },
  ];
  return <div className={`wa-triptych ${sel ? 'wa-chat-open' : ''}`}>
    {/* ===== Panel 1: conversation list (full height) ===== */}
    <aside className="wa-panel wa-list-panel">
      <div className="wa-list-head">
        <div className="wa-list-title"><b>المحادثات</b><span className="small">{list.length} محادثة • {unreadTotal} غير مقروءة حقيقية • آخر تحديث {lastUpdated.toLocaleTimeString('ar')}</span></div>
        <input className="wa-search" placeholder="بحث في المحادثات…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="wa-filters">
          <select aria-label="القناة" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="all">كل القنوات</option><option value="whatsapp">واتساب</option></select>
          <select aria-label="الوسم" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}><option value="">كل الوسوم</option>{allTags.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <select aria-label="الوكيل" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}><option value="">كل الوكلاء</option><option value="__unassigned__">غير معيّنة لوكيل</option>{agents.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        </div>
        <div className="wa-chips-row">{triage.map((t) => <button key={t.id} className={`wa-chip-btn ${filter === t.id ? 'active' : ''}`} onClick={() => setFilter(t.id)}>{t.label}</button>)}</div>
        <div className="wa-demo-row">
          {demo
            ? <><span className="wa-demo-badge">تجريبي موجود</span><button className="btn small ghost" onClick={deleteDemo}>حذف المحادثة التجريبية</button></>
            : <button className="btn small" onClick={createDemo}>عرض محادثة تجريبية</button>}
          <button className="btn small ghost" onClick={reload}>تحديث</button>
        </div>
        <p className="wa-demo-note">المحادثة التجريبية موسومة «تجريبي — ليس عميلاً حقيقياً»، بلا رقم، ولا تُحتسب في التقارير، وتُحذف بزر واحد.</p>
      </div>
      <div className="wa-list-scroll">
        {list.length === 0 ? <Empty text="لا محادثات مطابقة للبحث أو التصفية الحالية." /> :
          <ul className="conv-list triptych-list">{list.map((c) => {
            const contract = contractOf(b, c.contract_id);
            const lm = [...b.messages].filter((m) => m.conversation_id === c.id && !m.is_internal_note).sort((x, y) => x.id - y.id).pop();
            return <li key={c.id} className={selId === c.id ? 'sel' : ''} onClick={() => { setSelId(c.id); setDrawerOpen(false); setChatQ(''); setTagsInput((c.labels || []).join(', ')); }}>
              <div className="wa-list-row"><span className="wa-avatar">{initials(nameOf(b, c))}</span><span className="wa-list-main"><span className="wa-list-top"><b className={((c.unread_count || 0) > 0 && !c.is_demo) ? 'wa-unread-name' : ''}>{c.pinned ? '[مثبتة] ' : ''}{nameOf(b, c)}</b><span className="small">{shortTime(lm?.created_at)}</span></span><span className="wa-list-sub">{lm ? (lm.template_name ? `قالب: ${lm.template_name}` : `${lm.direction === 'out' ? (ticks(lm) ? ticks(lm).split(' ')[0] + ' ' : '') : ''}${(lm.body || '').slice(0, 60)}`) : (contract?.product_description || phoneOf(b, c) || 'محادثة جديدة')}</span><span className="small">{c.assigned_to ? `مكلَّف به: ${c.assigned_to} ` : ''}{(c.labels || []).join('، ')}</span></span>{c.is_demo ? <span className="wa-demo-badge">تجريبي</span> : (c.unread_count || 0) > 0 ? <span className="unread">{c.unread_count}</span> : null}</div>
            </li>;
          })}</ul>}
      </div>
    </aside>

    {/* ===== Panel 2: chat (full height) ===== */}
    <section className="wa-panel wa-chat-panel">
      {!sel ? <div className="wa-empty-chat"><h2>اختر محادثة</h2><Empty text="اختر محادثة من القائمة لعرض رسائلها والرد عليها من المحرر الواحد أدناه. أو أنشئ المحادثة التجريبية لترى شكل الدردشة كاملاً قبل الربط مع Meta." /><button className="btn" onClick={createDemo}>عرض محادثة تجريبية</button></div> : <>
        <div className="wa-chat-head">
          <button className="wa-back" onClick={() => setSelId(null)} aria-label="العودة إلى قائمة المحادثات">→ القائمة</button>
          <span className="wa-avatar">{initials(nameOf(b, sel))}</span>
          <div className="wa-chat-title">
            <b>{nameOf(b, sel)}</b>
            <span className="small">{sel.is_demo ? 'تجريبي — ليس عميلاً حقيقياً • بلا رقم حقيقي' : `الرقم: ${phoneOf(b, sel) || '—'}`} • {windowOpen ? 'نافذة 24 ساعة مفتوحة' : 'لا يمكنك الرد بعد الآن — قالب فقط'} {selContract ? `• عقد مرتبط: ${selContract.code} (${selContract.state})` : '• بلا عقد مرتبط'}</span>
          </div>
          <div className="wa-head-actions">
            <span className={`wa-window ${windowOpen ? 'open' : 'closed'}`}>{windowOpen ? '24 ساعة مفتوحة' : 'لا يمكنك الرد بعد الآن'}</span>
            <button className="btn small ghost" onClick={async () => { try { await api.pinConversation(sel.id); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>{sel.pinned ? 'إلغاء التثبيت' : 'تثبيت'}</button>
            <button className="btn small ghost" onClick={async () => { setShowLogs(!showLogs); if (!showLogs) setLogs(await api.automationLogs(sel.id).catch(() => [])); }}>{showLogs ? 'إخفاء سجل الأتمتة' : 'سجل الأتمتة'}</button>
            <button className="btn small ghost wa-details-toggle" onClick={() => { setDrawerOpen(!drawerOpen); if (!drawerOpen) openDrawer(); }}>{drawerOpen ? 'إغلاق التفاصيل' : 'التفاصيل'}</button>
          </div>
        </div>
        {sel.is_demo && <div className="wa-demo-banner">تجريبي — ليس عميلاً حقيقياً • لن يُرسل إلى واتساب أبداً • يُحذف بزر واحد من القائمة <button className="btn small ghost" onClick={deleteDemo}>حذف المحادثة التجريبية</button></div>}
        <div className="wa-chat-tools">
          <input className="wa-search" placeholder="بحث داخل المحادثة" value={chatQ} onChange={(e) => setChatQ(e.target.value)} />
          <select aria-label="التعيين" value={sel.assigned_to || ''} onChange={async (e) => { try { await api.assignConversation(sel.id, e.target.value); setMsg('تم تعيين المحادثة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
            <option value="">تعيين لموظف…</option>{me && <option value={me.full_name}>{me.full_name} (أنا)</option>}{b.users.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
          </select>
          <select aria-label="حالة المحادثة" value={sel.status} onChange={async (e) => { try { await api.updateConversation(sel.id, { status: e.target.value }); setMsg('تم تحديث حالة المحادثة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
            {['new', 'open', 'pending', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {(sel.unread_count || 0) > 0 && <button className="btn small ghost" onClick={async () => { try { await api.readConversation(sel.id); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تعيين كمقروءة ({sel.unread_count})</button>}
          <button className="btn small ghost" disabled={!canEdit} onClick={async () => { try { await api.handoffConversation(sel.id); setMsg('تم تحويل المحادثة لموظف — الأتمتة متوقفة حتى الاستئناف.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>نقل لموظف</button>
          <button className="btn small ghost" disabled={!canEdit} onClick={async () => { try { await api.resumeAutomation(sel.id); setMsg('تم استئناف الأتمتة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>استئناف الأتمتة</button>
        </div>
        {showLogs && (logs.length === 0 ? <Empty text="لا سجل تنفيذ أتمتة لهذه المحادثة بعد." /> :
          <table><thead><tr><th>التدفق</th><th>النتيجة</th><th>الوقت</th></tr></thead><tbody>{logs.slice(-20).reverse().map((x) => <tr key={x.id}><td>{x.workflow_name || '—'}</td><td>{x.outcome}</td><td className="small">{fmt(x.created_at)}</td></tr>)}</tbody></table>)}
        <div className="thread triptych-thread">
          {shownThread.length === 0 ? <Empty text={thread.length === 0 ? 'لا رسائل في هذه المحادثة بعد.' : 'لا رسائل مطابقة للبحث داخل المحادثة.'} /> : (() => { const groups: { label: string; items: Message[] }[] = []; shownThread.forEach((m) => { const lb = dateLabel(m.created_at); const g = groups.find((x) => x.label === lb); if (g) g.items.push(m); else groups.push({ label: lb, items: [m] }); }); return <>{groups.map((g) => <div key={g.label}><div className="wa-date-sep"><span>{g.label}</span></div>{g.items.map((m) => {
            if (m.is_internal_note) return <div key={m.id} id={`msg-${m.id}`} className="wa-system-note"><span>ملاحظة داخلية — {m.sender_name || 'فريق'} • {fmt(m.created_at)} • لا يراها العميل أبداً</span><div>{m.body}</div></div>;
            const qm = m.reply_to_id ? thread.find((x) => x.id === m.reply_to_id) : null;
            const tpl = m.template_name ? b.templates.find((x) => x.name === m.template_name) : undefined;
            return <div key={m.id} id={`msg-${m.id}`} className={`bubble ${m.direction === 'in' ? 'in' : 'out'} ${jumpId === m.id ? 'jump' : ''}`}>
              <div className="bubble-head">{m.direction === 'in' ? 'وارد' : 'صادر'} • {m.sender_name || '—'} {m.template_name ? `• قالب: ${m.template_name}` : ''} {m.media_type ? `• وسائط: ${m.media_type}` : ''}</div>
              {qm && <div className="wa-quote">رد على: {(qm.body || qm.template_name || '').slice(0, 80)}</div>}
              {m.media_type ? <div className="wa-media">{m.media_type === 'image' ? 'صورة' : m.media_type === 'video' ? 'فيديو' : m.media_type === 'audio' ? 'رسالة صوتية' : 'مستند'} • {m.media_filename || m.body || 'ملف وسائط'}{m.media_caption ? ` — ${m.media_caption}` : ''}</div> : <div>{m.body || (m.template_name ? `قالب: ${m.template_name}` : '—')}</div>}
              {m.template_name && <div className="wa-tpl">{tpl?.header_text ? <div><b>{tpl.header_text}</b></div> : null}<div>{tpl?.body || ''}</div>{tpl?.footer ? <div className="small">{tpl.footer}</div> : null}<div className="wa-chips">{templateButtons(tpl, m).map((bt) => <span key={bt} className="wa-chip">{bt}</span>)}</div></div>}
              <div className="small wa-meta">{fmt(m.created_at)} • {statusAr(m)} {ticks(m) ? `• ${ticks(m)}` : ''}</div>
              <div className="btn-row wa-msg-actions"><button className="btn small ghost" onClick={() => setReplyToId(m.id)}>رد مقتبس</button>{chatQ.trim() && <button className="btn small ghost" onClick={() => { setJumpId(m.id); document.getElementById(`msg-${m.id}`)?.scrollIntoView({ block: 'center' }); }}>القفز إلى الرسالة</button>}</div>
            </div>;
          })}</div>)}</>; })()}
        </div>
        <div className="wa-composer">
          {replyToId && <p className="wa-quote">رد مقتبس على رسالة #{replyToId} — {(thread.find((x) => x.id === replyToId)?.body || thread.find((x) => x.id === replyToId)?.template_name || '').slice(0, 80)} <button className="btn small ghost" onClick={() => setReplyToId(null)}>إلغاء الاقتباس</button></p>}
          {!windowOpen && !internal && !sel.is_demo && <p className="local-note">خارج نافذة 24 ساعة: النص الحر والوسائط والأزرار مرفوضة — أرسل قالباً معتمداً فقط.</p>}
          {mode === 'template' && <Field label="القالب (من مكتبة القوالب الواحدة)"><select value={template} onChange={(e) => setTemplate(e.target.value)}><option value="">— اختر قالباً —</option>{b.templates.map((t) => <option key={t.id} value={t.name}>{t.name} ({TEMPLATE_AR[t.name] || t.name}) — محلي: {t.approval_status}، Meta: {t.meta_status || '—'}</option>)}</select></Field>}
          {file && <p className="small">الملف المختار: {file.name} ({(file.size / 1024).toFixed(0)} ك.ب)</p>}
          <div className="wa-composer-bar">
            <input type="file" ref={attachRef} className="wa-hidden-file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(e) => { setFile(e.target.files?.[0] || null); setMode('media'); }} />
            <button title="إرفاق صورة" className="wa-attach-btn" onClick={() => { setAttachKind('image'); setMode('media'); attachRef.current?.click(); }}>🖼️</button>
            <button title="إرفاق فيديو" className="wa-attach-btn" onClick={() => { setAttachKind('video'); setMode('media'); attachRef.current?.click(); }}>🎬</button>
            <button title="إرفاق مستند" className="wa-attach-btn" onClick={() => { setAttachKind('document'); setMode('media'); attachRef.current?.click(); }}>📄</button>
            <button title="إرفاق صوت" className="wa-attach-btn" onClick={() => { setAttachKind('audio'); setMode('media'); attachRef.current?.click(); }}>🎙️</button>
            <button title="إرسال قالب" className="wa-attach-btn" onClick={() => setMode('template')}>📋</button>
            <button title="ردود سريعة" className="wa-attach-btn" onClick={() => setShowQr(!showQr)}>/</button>
            <button title="ملاحظة داخلية فقط — لا تُرسل أبداً" className={`wa-attach-btn ${internal ? 'active' : ''}`} onClick={() => setInternal(!internal)}>📝</button>
            <input className="wa-composer-input" value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? 'نص الملاحظة الداخلية…' : mode === 'template' ? 'ملاحظة (لا تُرسل مع القالب)' : mode === 'media' ? 'تعليق مع الوسائط…' : 'اكتب الرد هنا… اكتب / للردود السريعة'} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button title="إرسال الرد أو حفظ الملاحظة الداخلية" className="wa-send-btn" disabled={!canEdit} onClick={send}>{internal ? 'حفظ' : '➤'}</button>
          </div>
          {(showQr || qrMatches.length > 0) && <div className="btn-row">{(qrMatches.length > 0 ? qrMatches : quickReplies).map((r) => <button key={r.id} className="btn small ghost" onClick={() => { setBody(r.body); setShowQr(false); }}>{r.shortcut}</button>)}</div>}
          <div className="btn-row">
            <select className="inline-select" value={macroId} onChange={(e) => setMacroId(e.target.value ? Number(e.target.value) : '')}><option value="">تشغيل ماكرو بضغطة واحدة…</option>{macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <button className="btn small ghost" disabled={!canEdit || macroId === ''} onClick={async () => { try { const r = await api.runMacro(Number(macroId), sel.id); setMsg(r.ok ? `تم تنفيذ الماكرو — ${r.outcome || 'done'}.` : `لم يُنفَّذ — ${r.blocked_reason || ''}.`); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تشغيل الماكرو</button>
          </div>
          {!canEdit && <p className="muted">الإرسال يتطلب صلاحية تعديل واتساب (whatsapp:edit).</p>}
          {msg && <p className="msg">{msg}</p>}
        </div>
      </>}
    </section>

    {/* ===== Panel 3: details (desktop: always with a chat; phone: drawer) ===== */}
    {sel && <aside className={`wa-panel wa-details-panel ${drawerOpen ? 'open' : ''}`}>
      <div className="wa-details-head"><span className="wa-avatar">{initials(nameOf(b, sel))}</span><div><b>{nameOf(b, sel)}</b><span className="small">{sel.is_demo ? 'تجريبي — ليس عميلاً حقيقياً • بلا رقم حقيقي' : phoneOf(b, sel) || 'بلا رقم'}</span></div><button className="btn small ghost wa-details-close" onClick={() => setDrawerOpen(false)}>إغلاق</button></div>
      {sel.is_demo && <p className="wa-demo-banner">تجريبي — ليس عميلاً حقيقياً</p>}
      <h3>التفاصيل</h3>
      <p className="small">القناة: واتساب • الحالة: {sel.status} • مكلَّف به: {sel.assigned_to || 'غير معيّن'} • غير مقروءة: {sel.unread_count || 0}</p>
      {!drawerContact ? <p className="small">لا سجل جهة اتصال لهذا الرقم بعد — أنشئه من تبويب جهات الاتصال.</p> : <>
        <p><b>{drawerContact.name}</b> — {drawerContact.phone}</p>
        <p className="small">أهلية Utility (محسوبة): {drawerContact.utility_eligible ? 'نعم' : 'لا'} • {drawerContact.eligibility_basis || 'لا أساس بعد'}</p>
        {drawerContact.notes && <p className="small">ملاحظات: {drawerContact.notes}</p>}
      </>}
      <h3>الوسوم</h3>
      <div className="wa-details-row"><input className="wa-search" placeholder="وسوم مفصولة بفواصل" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} /><button className="btn small ghost" onClick={async () => { try { await api.setConversationTags(sel.id, tagsInput.split(',').map((x) => x.trim()).filter(Boolean)); setMsg('تم حفظ الوسوم.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>حفظ</button></div>
      <p className="small">الوسوم الحالية: {(sel.labels || []).join('، ') || '—'}</p>
      <h3>العقد المرتبط</h3>
      {selContract ? <p>{selContract.code} — {selContract.product_description} — {selContract.amount} {selContract.currency} — {selContract.state}</p> : <p className="small">هذه محادثة عامة بلا عقد مرتبط.</p>}
      <h3>ملاحظات داخلية</h3>
      {notes.length === 0 ? <p className="small">لا ملاحظات داخلية بعد — تُنشأ من المحرر بتفعيل «ملاحظة داخلية فقط».</p> :
        <ul className="wa-notes-list">{notes.map((n) => <li key={n.id}><b>{n.sender_name || 'فريق'}</b> • <span className="small">{fmt(n.created_at)}</span><div>{n.body}</div></li>)}</ul>}
      <h3>ملفات مشتركة</h3>
      {uploads.filter((u) => u.conversation_id === sel.id).length === 0 ? <p className="small">لا وسائط مرفوعة لهذه المحادثة بعد.</p> :
        <ul>{uploads.filter((u) => u.conversation_id === sel.id).map((u) => <li key={u.id} className="small">{u.filename} ({u.kind}، {u.size_bytes} بايت){u.media_id ? ' — له معرّف Meta' : ''}</li>)}</ul>}
      <h3>محادثات أخرى لهذه الجهة</h3>
      {otherConvs.length === 0 ? <p className="small">لا محادثات أخرى لهذه الجهة.</p> :
        <ul>{otherConvs.map((c) => <li key={c.id}><button className="btn small ghost" onClick={() => setSelId(c.id)}>{nameOf(b, c)}</button></li>)}</ul>}
      <h3>سجل المحادثة</h3>
      <p className="small">{thread.length} رسالة • {thread.filter((m) => m.direction === 'in').length} واردة • {notes.length} ملاحظة داخلية • غير مقروءة: {sel.unread_count || 0}</p>
    </aside>}
  </div>;
}
