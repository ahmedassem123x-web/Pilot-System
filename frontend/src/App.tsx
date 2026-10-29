import { useCallback, useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken } from './api';
import {
  Audit, Automation, Contacts, ContractVersions, Contracts, Dashboard, Inbox, NoPermission,
  SystemSettings, Tasks, Templates, Users, WhatsApp, WhatsAppMedia, hasAction, hasSection, type Bundle,
} from './views';
import { WorkflowDesigner } from './workflow';
import { Sidebar, type MainTab as SideTab } from './sidebar';
import { type MeUser } from './types';
import {
  IconBolt, IconChat, IconCheckSquare, IconDoc, IconGrid, IconLink, IconReport,
  IconSettings, IconShield, IconTemplate, IconUsers, IconWorkflow,
} from './icons';

type MainTab = 'dashboard' | 'contracts' | 'inbox' | 'whatsapp' | 'automation' | 'users' | 'audit' | 'settings';
interface Sub { id: string; label: string; section?: string; action?: string; }
interface NavItem { id: MainTab; label: string; section: string; icon: (p: { className?: string }) => React.ReactElement; subs: Sub[]; }
const NAV: NavItem[] = [
  { id: 'dashboard', label: 'لوحة القيادة', section: 'dashboard', icon: IconGrid, subs: [] },
  { id: 'contracts', label: 'العقود', section: 'contracts', icon: IconDoc, subs: [
    { id: 'list', label: 'قائمة العقود' },
    { id: 'new', label: 'عقد جديد', action: 'create' },
    { id: 'versions', label: 'النسخ' },
    { id: 'tasks', label: 'مهام التشغيل', section: 'tasks' },
  ] },
  { id: 'inbox', label: 'الإنبكس والدردشة', section: 'inbox', icon: IconChat, subs: [
    { id: 'conversations', label: 'المحادثات' },
    { id: 'chat', label: 'عرض الدردشة' },
    { id: 'assigned', label: 'المعيّنة لي' },
    { id: 'notes', label: 'الملاحظات الداخلية' },
  ] },
  // Professional hierarchy (Pass 3): ONE entry per screen. Inbox lives only
  // under the Inbox tab, Automation only under Automation, linking only
  // under WhatsApp > connection. WhatsApp subs are only what WhatsApp owns.
  { id: 'whatsapp', label: 'واتساب', section: 'whatsapp', icon: IconLink, subs: [
    { id: 'connection', label: 'الربط والحسابات' },
    { id: 'templates', label: 'القوالب' },
    { id: 'contacts', label: 'جهات الاتصال' },
    { id: 'media', label: 'الوسائط' },
    { id: 'settings', label: 'الإعدادات' },
  ] },
  { id: 'automation', label: 'الأتمتة', section: 'automation', icon: IconBolt, subs: [
    { id: 'rules', label: 'القواعد' },
    { id: 'designer', label: 'مصمّم التدفقات' },
    { id: 'killswitch', label: 'مفتاح الإيقاف' },
  ] },
  { id: 'users', label: 'المستخدمون', section: 'users', icon: IconUsers, subs: [
    { id: 'list', label: 'قائمة المستخدمين' },
    { id: 'add', label: 'إضافة مستخدم' },
    { id: 'passwords', label: 'كلمات السر' },
    { id: 'permissions', label: 'الصلاحيات' },
    { id: 'departments', label: 'الأقسام' },
  ] },
  { id: 'audit', label: 'التدقيق والتقارير', section: 'audit', icon: IconReport, subs: [] },
  { id: 'settings', label: 'إعدادات النظام', section: 'settings', icon: IconSettings, subs: [
    { id: 'system', label: 'إعدادات النظام' },
  ] },
];
const EMPTY: Bundle = { contracts: [], conversations: [], messages: [], tasks: [], workflows: [], templates: [], users: [], audit: [], killSwitch: false, healthOk: false };
const MAIN_IDS = NAV.map((n) => n.id);

function parseHash(): { main: MainTab; sub: string } {
  const parts = location.hash.replace('#', '').split('/');
  const main = (MAIN_IDS.includes(parts[0] as MainTab) ? parts[0] : 'dashboard') as MainTab;
  const nav = NAV.find((n) => n.id === main)!;
  const sub = nav.subs.some((s) => s.id === parts[1]) ? parts[1] : (nav.subs[0]?.id || '');
  return { main, sub };
}

// Phone top tabs (Preview list, verbatim) + the two extra pills (audit,
// system settings) that keep every existing section reachable on phone.
// Visibility is permission-gated exactly like the sidebar (hasSection).
interface TopTab { key: string; label: string; icon: (p: { className?: string }) => React.ReactElement; main: MainTab; sub?: string; section: string; }
const TOP_TABS: TopTab[] = [
  { key: 'dashboard', label: 'لوحة القيادة', icon: IconGrid, main: 'dashboard', section: 'dashboard' },
  { key: 'contracts', label: 'العقود والمعاملات', icon: IconDoc, main: 'contracts', sub: 'list', section: 'contracts' },
  { key: 'inbox', label: 'الإنبكس', icon: IconChat, main: 'inbox', sub: 'conversations', section: 'inbox' },
  { key: 'tasks', label: 'مهام التشغيل', icon: IconCheckSquare, main: 'contracts', sub: 'tasks', section: 'tasks' },
  { key: 'designer', label: 'مصمّم الورك فلو', icon: IconWorkflow, main: 'automation', sub: 'designer', section: 'automation' },
  { key: 'templates', label: 'قوالب واتساب', icon: IconTemplate, main: 'whatsapp', sub: 'templates', section: 'whatsapp' },
  { key: 'contacts', label: 'جهات الاتصال', icon: IconUsers, main: 'whatsapp', sub: 'contacts', section: 'whatsapp' },
  { key: 'media', label: 'الوسائط', icon: IconDoc, main: 'whatsapp', sub: 'media', section: 'whatsapp' },
  { key: 'automation', label: 'الأتمتة والتقارير', icon: IconBolt, main: 'automation', sub: 'rules', section: 'automation' },
  { key: 'audit', label: 'التدقيق', icon: IconReport, main: 'audit', section: 'audit' },
  { key: 'users', label: 'المستخدمون والأدوار', icon: IconUsers, main: 'users', sub: 'list', section: 'users' },
  { key: 'linking', label: 'الربط والإعداد', icon: IconLink, main: 'whatsapp', sub: 'connection', section: 'whatsapp' },
  { key: 'settings', label: 'إعدادات النظام', icon: IconSettings, main: 'settings', sub: 'system', section: 'settings' },
];
function activeTopKey(main: MainTab, sub: string): string {
  if (main === 'contracts' && sub === 'tasks') return 'tasks';
  if (main === 'contracts') return 'contracts';
  if (main === 'whatsapp' && sub === 'templates') return 'templates';
  if (main === 'whatsapp' && sub === 'contacts') return 'contacts';
  if (main === 'whatsapp' && sub === 'media') return 'media';
  if (main === 'whatsapp') return 'linking';
  if (main === 'automation' && sub === 'designer') return 'designer';
  if (main === 'automation') return 'automation';
  if (main === 'settings') return 'settings';
  return main;
}

export default function App() {
  const [me, setMe] = useState<MeUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginErr, setLoginErr] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [{ main, sub }, setNav] = useState(parseHash);
  const [data, setData] = useState<Bundle>(EMPTY);
  const [err, setErr] = useState('');
  // Sidebar V2: collapsed rail persisted; phone never uses it (CSS).
  const [sideCollapsed, setSideCollapsed] = useState(() => {
    try { return localStorage.getItem('ps:sidebar-collapsed') === '1'; } catch { return false; }
  });
  function toggleSideCollapsed() {
    setSideCollapsed((v) => {
      try { localStorage.setItem('ps:sidebar-collapsed', v ? '0' : '1'); } catch { /* storage unavailable */ }
      return !v;
    });
  }
  // Keep the active phone tab scrolled into view (scroll hint + snap).
  useEffect(() => {
    const el = document.querySelector('.topnav .tab.active');
    if (el) (el as HTMLElement).scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [main, sub]);

  const reload = useCallback(async () => {
    try {
      const [health, contracts, conversations, messages, tasks, workflows, templates, users, audit, ks] = await Promise.all([
        api.health().catch(() => null),
        api.contracts().catch(() => []),
        api.conversations().catch(() => []),
        api.messages().catch(() => []),
        api.tasks().catch(() => []),
        api.workflows().catch(() => []),
        api.templates().catch(() => []),
        api.users().catch(() => []),
        api.audit().catch(() => []),
        api.killSwitchGet().catch(() => ({ killSwitch: false })),
      ]);
      setData({ contracts, conversations, messages, tasks, workflows, templates, users, audit, killSwitch: ks.killSwitch, healthOk: !!health?.ok });
      setErr('');
    } catch (e) { setErr('تعذر الاتصال بالخادم: ' + (e as Error).message + ' — تأكد أن الخادم يعمل على نفس المضيف.'); }
  }, []);

  // Session bootstrap: token -> /me, else login screen. A 401 anywhere
  // clears the token (see api.ts) and fires ps:unauthorized -> login screen.
  useEffect(() => {
    const onUnauth = () => setMe(null);
    window.addEventListener('ps:unauthorized', onUnauth);
    (async () => {
      if (getToken()) {
        try { const u = await api.me(); setMe(u); await reload(); }
        catch { setMe(null); }
      }
      setAuthChecked(true);
    })();
    return () => window.removeEventListener('ps:unauthorized', onUnauth);
  }, [reload]);

  function go(m: MainTab, s?: string) {
    const nav = NAV.find((n) => n.id === m)!;
    const subId = s || nav.subs[0]?.id || '';
    setNav({ main: m, sub: subId });
    location.hash = subId ? `${m}/${subId}` : m;
    window.scrollTo(0, 0);
  }
  async function doLogin(e: React.FormEvent) {
    e.preventDefault(); setLoginErr(''); setLoggingIn(true);
    try {
      const r = await api.login(loginForm.email.trim(), loginForm.password);
      setToken(r.token); setMe(r.user); setLoginForm({ email: '', password: '' });
      await reload();
    } catch (err) { setLoginErr('فشل الدخول: ' + (err as Error).message); }
    finally { setLoggingIn(false); }
  }
  function logout() { clearToken(); setMe(null); setData(EMPTY); }

  const brand = (
    <div className="brand-row">
      <span className="brand-mark"><IconShield /></span>
      <span><b className="brand">Pilot System</b><span className="brand-sub">نظام إدارة العقود والمعاملات</span></span>
    </div>
  );

  if (!authChecked) return <div className="app"><main><div className="skeleton skeleton-title" /><div className="skeleton" /><div className="skeleton" /><p className="muted">جارٍ التحقق من الجلسة…</p></main></div>;
  if (!me) return <div className="app login-wrap" dir="rtl">
    <header className="topbar">{brand}</header>
    <main>
      <section className="card login-card">
        <div className="login-brand">
          <span className="brand-mark"><IconShield /></span>
          <span><b>Pilot System</b><span>نظام إدارة العقود والمعاملات</span></span>
        </div>
        <div className="login-body">
          <h2>تسجيل الدخول</h2>
          <p className="muted">لا يستطيع أحد الدخول إلا بعد أن يضيفه المسؤول. المسؤول الأساسي يُنشأ عند أول تشغيل من متغيرات بيئة الخادم فقط.</p>
          <form onSubmit={doLogin}>
            <label className="field"><span>البريد الإلكتروني</span><input required type="email" autoComplete="email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} placeholder="name@example.com" /></label>
            <label className="field"><span>كلمة السر</span><input required type="password" autoComplete="current-password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} /></label>
            <button className="btn" type="submit" disabled={loggingIn}>{loggingIn ? 'جارٍ الدخول…' : 'دخول'}</button>
          </form>
          {loginErr && <p className="login-error" role="alert">{loginErr}</p>}
        </div>
      </section>
    </main>
  </div>;

  const nav = NAV.find((n) => n.id === main)!;
  const visibleNav = NAV.filter((n) => hasSection(me, n.section));
  const mainAllowed = hasSection(me, nav.section);
  const subDef = nav.subs.find((s) => s.id === sub);
  const subAllowed = !subDef || (!subDef.section || hasSection(me, subDef.section)) && (!subDef.action || hasAction(me, nav.section, subDef.action));
  const forbidden = !mainAllowed || !subAllowed;
  const unread = data.conversations.reduce((s, c) => s + (c.unread_count || 0), 0);
  const activeSubs = nav.subs.filter((s) => (!s.section || hasSection(me, s.section)) && (!s.action || hasAction(me, nav.section, s.action)));
  const topKey = activeTopKey(main, sub);
  const visibleTopTabs = TOP_TABS.filter((t) => hasSection(me, t.section));

  const openTasks = data.tasks.filter((t) => t.status !== 'done').length;
  return <div className={`app ${sideCollapsed ? 'side-collapsed' : ''}`}>
    {/* Slim utility bar (web/desktop). Brand lives in the sidebar; the
        user card + logout live in the sidebar footer — never floating. */}
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-brand"><span className="brand-mark small"><IconShield /></span><b>Pilot System</b></span>
        <span className="page-crumb">{nav.label}{subDef ? ` / ${subDef.label}` : ''}</span>
      </div>
      <div className="top-status">
        {data.killSwitch && <span className="pill danger">الأتمتة موقوفة</span>}
        {unread > 0 && <button className="pill" onClick={() => go('inbox', 'conversations')}>غير مقروءة: {unread}</button>}
        <span className={`pill ${data.healthOk ? 'ok' : 'danger'}`}><span className="dot" />{data.healthOk ? 'متصل' : 'غير متصل'}</span>
      </div>
    </header>
    {/* Phone-only top tab bar (CSS shows it < 820px, hides it >= 820px).
        Horizontally scrollable pills; the active tab scrolls into view.
        No burger, no drawer — the sidebar is never rendered on phone. */}
    <nav className="topnav" aria-label="التنقل الرئيسي">
      {visibleTopTabs.map((t) => {
        const Icon = t.icon;
        return <button key={t.key} className={`tab ${topKey === t.key ? 'active' : ''}`} onClick={() => go(t.main, t.sub)}>
          <Icon />{t.label}{t.key === 'inbox' && unread > 0 && <span className="unread-badge">{unread}</span>}
        </button>;
      })}
    </nav>
    {err && <div className="errbar">{err}</div>}
    <div className="layout">
      {/* Web/desktop sidebar — ONE component, same permission gating as
          the phone tabs (visibleNav). Collapsed state is frontend-only. */}
      <Sidebar me={me} main={main as SideTab} visible={visibleNav.map((n) => n.id as SideTab)}
        unread={unread} openTasks={openTasks} collapsed={sideCollapsed}
        onToggleCollapse={toggleSideCollapsed} go={(m) => go(m)} logout={logout} />
      <main>
        {activeSubs.length > 0 && <div className="btn-row subnav">
          {activeSubs.map((s) => <button key={s.id} className={`btn small ${sub === s.id ? '' : 'ghost'}`} onClick={() => go(main, s.id)}>{s.label}</button>)}
        </div>}
        {forbidden ? <NoPermission /> : <>
          {main === 'dashboard' && <Dashboard b={data} reload={reload} onOpenDesigner={hasSection(me, 'automation') ? () => go('automation', 'designer') : undefined} />}
          {main === 'contracts' && sub === 'versions' && <ContractVersions b={data} />}
          {main === 'contracts' && sub === 'tasks' && <Tasks b={data} reload={reload} />}
          {main === 'contracts' && (sub === 'list' || sub === 'new') && <Contracts b={data} reload={reload} sub={sub as 'list' | 'new'} />}
          {main === 'inbox' && <Inbox b={data} reload={reload} me={me} sub={sub as 'conversations' | 'chat' | 'assigned' | 'notes'} />}
          {main === 'whatsapp' && sub === 'templates' && <Templates b={data} reload={reload} canEdit={hasAction(me, 'whatsapp', 'edit')} />}
          {main === 'whatsapp' && sub === 'contacts' && <Contacts b={data} reload={reload} me={me} />}
          {main === 'whatsapp' && sub === 'media' && <WhatsAppMedia b={data} reload={reload} me={me} />}
          {main === 'whatsapp' && (sub === 'connection' || sub === 'settings') && <WhatsApp b={data} reload={reload} me={me} sub={sub as 'connection' | 'settings'} />}
          {main === 'automation' && sub === 'designer' && <WorkflowDesigner workflows={data.workflows} templates={data.templates} reload={reload} />}
          {main === 'automation' && sub === 'rules' && <Automation b={data} reload={reload} only="rules" />}
          {main === 'automation' && sub === 'killswitch' && <Automation b={data} reload={reload} only="killswitch" />}
          {main === 'users' && <Users b={data} reload={reload} me={me} sub={sub as 'list' | 'add' | 'passwords' | 'permissions' | 'departments'} />}
          {main === 'audit' && <Audit b={data} />}
          {main === 'settings' && sub === 'system' && <SystemSettings />}
        </>}
      </main>
    </div>
  </div>;
}
