// WhatsApp workspace — the ONE inbox component, used from every entry
// point (main Inbox tab and the WhatsApp section). There is no second
// inbox component anywhere: list + chat + composer + contact drawer are
// one workspace, with one template library (b.templates) and one
// automation engine (workflows/macros) behind it.
// Layout: phone = list on top, chat below, composer pinned at bottom;
// web (>=820px) = list right, chat centre, drawer left (CSS in styles.css).
import { useEffect, useMemo, useState } from 'react';
import { api, type AutomationLog, type WhatsAppUpload } from './api';
import { Badge, Card, Empty, Field, fmt } from './components';
import { TEMPLATE_AR, type Contact, type QuickReply, type Contract, type Conversation, type MeUser, type Message, type Template, type User, type Workflow } from './types';

export interface WorkspaceBundle {
  contracts: Contract[]; conversations: Conversation[]; messages: Message[];
  templates: Template[]; users: User[];
}
function contractOf(b: WorkspaceBundle, id: number | null) { return b.contracts.find((c) => c.id === id) || null; }
function phoneOf(b: WorkspaceBundle, conv: Conversation): string {
  const c = contractOf(b, conv.contract_id);
  if (c) return conv.party === 'seller' ? c.seller_phone : c.buyer_phone;
  return conv.phone || '';
}
function nameOf(b: WorkspaceBundle, conv: Conversation): string {
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


function initials(s: string): string { const w = s.replace(/[^\w\u0600-\u06FF ]/g,'').trim().split(/\s+/).filter(Boolean); if (!w.length) return '؟'; return (w[0][0] + (w[1] ? w[1][0] : '')).toUpperCase(); }
function shortTime(dt?: string | null): string { if (!dt) return ''; const d = new Date(dt); const today = new Date(); const same = d.toDateString() === today.toDateString(); return same ? d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ar', { day: 'numeric', month: 'numeric' }); }
function dateLabel(dt: string): string { const d = new Date(dt); const today = new Date(); const y = new Date(); y.setDate(today.getDate()-1); if (d.toDateString()===today.toDateString()) return 'اليوم'; if (d.toDateString()===y.toDateString()) return 'أمس'; return d.toLocaleDateString('ar', { weekday:'long', day:'numeric', month:'long', year:'numeric' }); }
function ticks(m: Message): string { if (m.direction !== 'out' || m.is_internal_note) return ''; if (m.dry_run) return 'تجريبي'; if (m.meta_status === 'read') return '✓✓ مقروءة'; if (m.meta_status === 'delivered') return '✓✓ سُلّمت'; if (m.meta_status === 'sent') return '✓ أُرسلت'; if (m.meta_status === 'failed') return '✗ فشلت — أعد المحاولة'; return '✓ مسجّلة'; }
function templateButtons(tpl: Template | undefined): string[] { if (!tpl || !tpl.buttons) return []; if (Array.isArray(tpl.buttons)) return tpl.buttons.map((b: unknown) => typeof b === 'string' ? b : (b as {title?: string; text?: string}).title || (b as {text?: string}).text || '').filter(Boolean); return []; }

export function WhatsAppWorkspace({ b, reload, me }: { b: WorkspaceBundle; reload: () => void; me: MeUser | null }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'mine' | 'open' | 'resolved' | 'unassigned'>('all');
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
  // Composer state (single composer: text | template | media | quick reply | internal note)
  const [mode, setMode] = useState<'text' | 'template' | 'media'>('text');
  const [body, setBody] = useState('');
  const [template, setTemplate] = useState('');
  const [internal, setInternal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [macroId, setMacroId] = useState<number | ''>('');
  const [tagsInput, setTagsInput] = useState('');
  const [replyToId, setReplyToId] = useState<number | null>(null);
  const [jumpId, setJumpId] = useState<number | null>(null);

  useEffect(() => {
    api.quickReplies().then(setQuickReplies).catch(() => setQuickReplies([]));
    api.macros().then(setMacros).catch(() => setMacros([]));
    api.whatsappUploads().then(setUploads).catch(() => setUploads([]));
  }, []);
  useEffect(() => { setLastUpdated(new Date()); }, [b.conversations, b.messages]);
  const isMine = (c: Conversation) => !!me && (c.assigned_to === me.full_name || c.assigned_to === me.email || c.assigned_to === String(me.id));
  const allTags = useMemo(() => [...new Set(b.conversations.flatMap((c) => c.labels || []))], [b.conversations]);
  const list = [...b.conversations].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)).filter((c) => {
    if (filter === 'unread' && !(c.unread_count || 0)) return false;
    if (filter === 'mine' && !isMine(c)) return false;
    if (filter === 'open' && !['new', 'open', 'pending'].includes(c.status)) return false;
    if (filter === 'resolved' && c.status !== 'resolved') return false;
    if (filter === 'unassigned' && c.assigned_to) return false;
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
  const unreadTotal = b.conversations.reduce((s, c) => s + (c.unread_count || 0), 0);
  const canEdit = !!me && ((me as { actions?: Record<string, string[]> }).actions?.whatsapp?.includes('edit') || me.role === 'owner' || me.is_primary_admin);
  const qrMatches = body.startsWith('/') ? quickReplies.filter((r) => r.shortcut.startsWith(body.split(' ')[0])) : [];

  async function openDrawer() {
    if (!sel) return;
    setDrawerOpen(true); setDrawerContact(null);
    try {
      const phone = phoneOf(b, sel);
      const found = phone ? await api.contacts({ q: phone }) : [];
      setDrawerContact(found[0] || null);
    } catch { setDrawerContact(null); }
  }
  async function send() {
    if (!sel) return;
    setMsg('');
    try {
      if (internal) {
        if (!body.trim()) { setMsg('اكتب نص الملاحظة الداخلية أولاً.'); return; }
        await api.sendMessage({ conversation_id: sel.id, direction: 'out', sender_name: me?.full_name || 'operator', body: body.trim(), is_internal_note: true, reply_to_id: replyToId });
        setReplyToId(null);
        setMsg('تم حفظ الملاحظة الداخلية — لم تُرسل للعميل أبداً.'); setBody(''); setInternal(false); reload(); return;
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
      // text
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

  const selContract = sel ? contractOf(b, sel.contract_id) : null;
  return <div className="wa-workspace">
    <Card title="مساحة عمل واتساب" sub={`الإنبكس الواحد — ${b.conversations.length} محادثة، ${unreadTotal} غير مقروءة. آخر تحديث: ${lastUpdated.toLocaleTimeString('ar')}. محادثة واحدة لكل جهة وعقد، ومحادثة عامة للرسائل غير المرتبطة بعقد. لا يُنشأ عقد تلقائياً من رسالة أبداً.`} actions={<button className="btn ghost small" onClick={reload}>تحديث</button>}>
      <div className="btn-row">
        <input className="inline-input" placeholder="بحث: اسم عقد، رقم، منتج، مكلَّف به، وسم" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inline-select" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">كل المحادثات</option><option value="unread">غير مقروءة</option><option value="mine">المعيّنة لي</option><option value="unassigned">غير معيّنة</option><option value="open">المفتوحة</option><option value="resolved">المحلولة</option>
        </select>
        <select className="inline-select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">كل الوسوم</option>{allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    </Card>
    <div className="wa-grid">
      <section className="card wa-list">
        <h2>قائمة المحادثات</h2>
        {list.length === 0 ? <Empty text="لا محادثات مطابقة للبحث أو التصفية الحالية." /> :
          <ul className="conv-list">{list.map((c) => {
            const contract = contractOf(b, c.contract_id);
            const lm = [...b.messages].filter((m) => m.conversation_id === c.id && !m.is_internal_note).sort((x, y) => x.id - y.id).pop();
            return <li key={c.id} className={selId === c.id ? 'sel' : ''} onClick={() => { setSelId(c.id); setDrawerOpen(false); setChatQ(''); setTagsInput((c.labels || []).join(', ')); }}>
              <div className="wa-list-row"><span className="wa-avatar">{initials(nameOf(b, c))}</span><span className="wa-list-main"><span className="wa-list-top"><b>{c.pinned ? '[مثبتة] ' : ''}{contract?.code || `عقد ${c.contract_id}`}</b><span className="small">{shortTime(lm?.created_at)}</span></span><span className="wa-list-sub">{c.party === 'buyer' ? 'المشتري' : c.party === 'seller' ? 'البائع' : 'عام'} • {lm ? (lm.template_name ? `قالب: ${lm.template_name}` : `${lm.direction === 'out' ? (ticks(lm) ? ticks(lm).split(' ')[0] + ' ' : '') : ''}${(lm.body || '').slice(0, 60)}`) : (contract?.product_description || phoneOf(b, c))}</span><span className="small">{c.assigned_to ? `مكلَّف به: ${c.assigned_to} ` : ''}{(c.labels || []).join('، ')}</span></span>{(c.unread_count || 0) > 0 && <span className="unread">{c.unread_count}</span>}</div>
            </li>;
          })}</ul>}
      </section>
      <section className="card wa-chat">
        {!sel ? <><h2>اختر محادثة</h2><Empty text="اختر محادثة من القائمة لعرض رسائلها والرد عليها من المحرر الواحد أدناه." /></> : <>
          <div className="wa-chat-head">
            <div><h2>{nameOf(b, sel)}</h2>
              <p className="muted">الرقم: {phoneOf(b, sel) || '—'} • {windowOpen ? <Badge tone="ok">نافذة 24 ساعة مفتوحة</Badge> : <Badge tone="warn">خارج نافذة 24 ساعة — قالب فقط</Badge>} {sel.assigned_to ? `• مكلَّف به: ${sel.assigned_to}` : ''} {selContract ? `• عقد مرتبط: ${selContract.code} (${selContract.state})` : '• بلا عقد مرتبط'}</p>
            </div>
            <div className="btn-row">
              <button className="btn small ghost" onClick={async () => { try { await api.pinConversation(sel.id); setMsg(sel.pinned ? 'تم إلغاء تثبيت المحادثة.' : 'تم تثبيت المحادثة أعلى القائمة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>{sel.pinned ? 'إلغاء التثبيت' : 'تثبيت المحادثة'}</button>
              <button className="btn small ghost" onClick={openDrawer}>درج جهة الاتصال</button>
              <button className="btn small ghost" onClick={async () => { setShowLogs(!showLogs); if (!showLogs) setLogs(await api.automationLogs(sel.id).catch(() => [])); }}>{showLogs ? 'إخفاء سجل الأتمتة' : 'سجل تنفيذ الأتمتة'}</button>
            </div>
          </div>
          <div className="btn-row">
            <input className="inline-input" placeholder="بحث داخل المحادثة" value={chatQ} onChange={(e) => setChatQ(e.target.value)} />
            <select className="inline-select" value={sel.assigned_to || ''} onChange={async (e) => { try { await api.assignConversation(sel.id, e.target.value); setMsg('تم تعيين المحادثة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
              <option value="">غير مكلَّف</option>{me && <option value={me.full_name}>{me.full_name} (أنا)</option>}{b.users.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
            </select>
            <select className="inline-select" value={sel.status} onChange={async (e) => { try { await api.updateConversation(sel.id, { status: e.target.value }); setMsg('تم تحديث حالة المحادثة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>
              {['new', 'open', 'pending', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {(sel.unread_count || 0) > 0 && <button className="btn small ghost" onClick={async () => { try { await api.readConversation(sel.id); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تعيين كمقروءة ({sel.unread_count})</button>}
          </div>
          <div className="btn-row">
            <input className="inline-input" placeholder="وسوم المحادثة (مفصولة بفواصل)" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
            <button className="btn small ghost" onClick={async () => { try { await api.setConversationTags(sel.id, tagsInput.split(',').map((x) => x.trim()).filter(Boolean)); setMsg('تم حفظ الوسوم.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>حفظ الوسوم</button>
            <button className="btn small ghost" disabled={!canEdit} onClick={async () => { try { await api.handoffConversation(sel.id); setMsg('تم تحويل المحادثة لموظف — الأتمتة متوقفة حتى الاستئناف.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تحويل لموظف</button>
            <button className="btn small ghost" disabled={!canEdit} onClick={async () => { try { await api.resumeAutomation(sel.id); setMsg('تم استئناف الأتمتة.'); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>استئناف الأتمتة</button>
          </div>
          {showLogs && (logs.length === 0 ? <Empty text="لا سجل تنفيذ أتمتة لهذه المحادثة بعد." /> :
            <table><thead><tr><th>التدفق</th><th>النتيجة</th><th>الوقت</th></tr></thead><tbody>{logs.slice(-20).reverse().map((x) => <tr key={x.id}><td>{x.workflow_name || '—'}</td><td>{x.outcome}</td><td className="small">{fmt(x.created_at)}</td></tr>)}</tbody></table>)}
          <div className="thread">
            {shownThread.length === 0 ? <Empty text={thread.length === 0 ? 'لا رسائل في هذه المحادثة بعد.' : 'لا رسائل مطابقة للبحث داخل المحادثة.'} /> : (() => { const groups: { label: string; items: Message[] }[] = []; shownThread.forEach((m) => { const lb = dateLabel(m.created_at); const g = groups.find((x) => x.label === lb); if (g) g.items.push(m); else groups.push({ label: lb, items: [m] }); }); return <>{groups.map((g) => <div key={g.label}><div className="wa-date-sep"><span>{g.label}</span></div>{g.items.map((m) => { const qm = m.reply_to_id ? thread.find((x) => x.id === m.reply_to_id) : null; const tpl = m.template_name ? b.templates.find((x) => x.name === m.template_name) : undefined; return <div key={m.id} id={`msg-${m.id}`} className={`bubble ${m.direction === 'in' ? 'in' : 'out'} ${m.is_internal_note ? 'internal' : ''} ${jumpId === m.id ? 'jump' : ''}`}>
              <div className="bubble-head">{m.is_internal_note ? 'ملاحظة داخلية فقط — لا تُرسل للعميل' : m.direction === 'in' ? 'وارد' : 'صادر'} • {m.sender_name || '—'} {m.template_name ? `• قالب: ${m.template_name}` : ''} {m.media_type ? `• وسائط: ${m.media_type}` : ''}</div>
              {qm && <div className="wa-quote">رد على: {(qm.body || qm.template_name || '').slice(0, 80)}</div>}
              {m.media_type ? <div className="wa-media">{m.media_type === 'image' ? 'صورة' : m.media_type === 'video' ? 'فيديو' : m.media_type === 'audio' ? 'رسالة صوتية' : 'مستند'} • {m.media_filename || m.body || 'ملف وسائط'}{m.media_caption ? ` — ${m.media_caption}` : ''}</div> : <div>{m.body || (m.template_name ? `قالب: ${m.template_name}` : '—')}</div>}
              {tpl && <div className="wa-tpl">{tpl.header_text ? <div><b>{tpl.header_text}</b></div> : null}<div>{tpl.body || ''}</div>{tpl.footer ? <div className="small">{tpl.footer}</div> : null}<div className="wa-chips">{templateButtons(tpl).map((bt) => <span key={bt} className="wa-chip">{bt}</span>)}</div></div>}
              <div className="small wa-meta">{fmt(m.created_at)} • {statusAr(m)} {ticks(m) ? `• ${ticks(m)}` : ''}</div>
              <div className="btn-row wa-msg-actions"><button className="btn small ghost" onClick={() => setReplyToId(m.id)}>رد مقتبس</button>{chatQ.trim() && <button className="btn small ghost" onClick={() => { setJumpId(m.id); document.getElementById(`msg-${m.id}`)?.scrollIntoView({ block: 'center' }); }}>القفز إلى الرسالة</button>}</div>
            </div>; })}</div>)}</>; })()}
          </div>
          <div className="wa-composer">
            <div className="btn-row">
              <button className={`btn small ${mode === 'text' ? '' : 'ghost'}`} onClick={() => setMode('text')}>نص</button>
              <button className={`btn small ${mode === 'template' ? '' : 'ghost'}`} onClick={() => setMode('template')}>قالب</button>
              <button className={`btn small ${mode === 'media' ? '' : 'ghost'}`} onClick={() => setMode('media')}>وسائط</button>
              <label className="check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> ملاحظة داخلية فقط (لا تُرسل أبداً)</label>
            </div>
            {replyToId && <p className="wa-quote">رد مقتبس على رسالة #{replyToId} — {(thread.find((x) => x.id === replyToId)?.body || thread.find((x) => x.id === replyToId)?.template_name || '').slice(0, 80)} <button className="btn small ghost" onClick={() => setReplyToId(null)}>إلغاء الاقتباس</button></p>}
            {!windowOpen && !internal && <p className="local-note">خارج نافذة 24 ساعة: النص الحر والوسائط والأزرار مرفوضة — أرسل قالباً معتمداً فقط.</p>}
            {mode === 'template' && <Field label="القالب (من مكتبة القوالب الواحدة)"><select value={template} onChange={(e) => setTemplate(e.target.value)}><option value="">— اختر قالباً —</option>{b.templates.map((t) => <option key={t.id} value={t.name}>{t.name} ({TEMPLATE_AR[t.name] || t.name}) — محلي: {t.approval_status}، Meta: {t.meta_status || '—'}</option>)}</select></Field>}
            {mode === 'media' && <Field label="ملف (حتى 16 ميجابايت — صورة/فيديو/صوت/مستند)"><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>}
            {mode !== 'media' && <Field label={internal ? 'نص الملاحظة الداخلية' : mode === 'template' ? 'ملاحظة (لا تُرسل مع القالب)' : 'نص الرد — اكتب / لعرض الردود السريعة'}><textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={mode === 'template' ? 'اختياري' : 'اكتب الرد هنا…'} /></Field>}
            {qrMatches.length > 0 && <div className="btn-row">{qrMatches.map((r) => <button key={r.id} className="btn small ghost" onClick={() => setBody(r.body)}>{r.shortcut}</button>)}</div>}
            <div className="btn-row">
              <button className="btn" disabled={!canEdit} onClick={send}>{internal ? 'حفظ ملاحظة داخلية' : mode === 'media' ? 'رفع وإرسال الوسائط' : 'إرسال'}</button>
              <select className="inline-select" value={macroId} onChange={(e) => setMacroId(e.target.value ? Number(e.target.value) : '')}><option value="">تشغيل ماكرو بضغطة واحدة…</option>{macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <button className="btn small ghost" disabled={!canEdit || macroId === ''} onClick={async () => { try { const r = await api.runMacro(Number(macroId), sel.id); setMsg(r.ok ? `تم تنفيذ الماكرو — ${r.outcome || 'done'}.` : `لم يُنفَّذ — ${r.blocked_reason || ''}.`); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>تشغيل الماكرو</button>
            </div>
            {!canEdit && <p className="muted">الإرسال يتطلب صلاحية تعديل واتساب (whatsapp:edit).</p>}
            {msg && <p className="msg">{msg}</p>}
            <p className="muted">الوسائط المرفوعة هنا تُعاد من مكتبة الوسائط دون إعادة رفع، وحذف ملف من المكتبة لا يحذف الرسائل التي استخدمته.</p>
          </div>
        </>}
      </section>
      {drawerOpen && sel && <section className="card wa-drawer">
        <h2>درج جهة الاتصال</h2>
        <button className="btn small ghost" onClick={() => setDrawerOpen(false)}>إغلاق الدرج</button>
        {!drawerContact ? <Empty text="لا سجل جهة اتصال لهذا الرقم بعد — أنشئه من تبويب جهات الاتصال، أو اعرض عقود هذه المحادثة أدناه." /> : <>
          <p><b>{drawerContact.name}</b> — {drawerContact.phone}</p>
          <p className="small">أهلية Utility (محسوبة): {drawerContact.utility_eligible ? 'نعم' : 'لا'} • {drawerContact.eligibility_basis || 'لا أساس بعد'}</p>
          {drawerContact.notes && <p className="small">ملاحظات: {drawerContact.notes}</p>}
          <p className="small">وسوم جهة الاتصال: {(drawerContact.labels || []).join('، ') || '—'}</p>
        </>}
        <h3>عقود هذه المحادثة</h3>
        {selContract ? <p>{selContract.code} — {selContract.product_description} — {selContract.amount} {selContract.currency} — {selContract.state}</p> : <Empty text="هذه محادثة عامة بلا عقد مرتبط." />}
        <h3>سجل المحادثة</h3>
        <p className="small">{thread.length} رسالة • {thread.filter((m) => m.direction === 'in').length} واردة • {thread.filter((m) => m.is_internal_note).length} ملاحظة داخلية • غير مقروءة: {sel.unread_count || 0}</p>
        <h3>الوسائط المرتبطة</h3>
        {uploads.filter((u) => u.conversation_id === sel.id).length === 0 ? <Empty text="لا وسائط مرفوعة لهذه المحادثة بعد." /> :
          <ul>{uploads.filter((u) => u.conversation_id === sel.id).map((u) => <li key={u.id} className="small">{u.filename} ({u.kind}، {u.size_bytes} بايت){u.media_id ? ' — له معرّف Meta' : ''}</li>)}</ul>}
      </section>}
    </div>
  </div>;
}
