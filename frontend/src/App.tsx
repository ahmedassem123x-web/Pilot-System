import { useCallback, useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken } from './api';
import {
  Audit, Automation, Checklist, ContractVersions, Contracts, Dashboard, Inbox, NoPermission,
  SystemSettings, Tasks, Templates, Users, WhatsApp, hasAction, hasSection, type Bundle,
} from './views';
import { WorkflowDesigner } from './workflow';
import { ROLE_AR, type MeUser } from './types';

type MainTab = 'dashboard' | 'contracts' | 'inbox' | 'whatsapp' | 'automation' | 'users' | 'audit' | 'settings';
interface Sub { id: string; label: string; section?: string; action?: string; }
interface NavItem { id: MainTab; label: string; section: string; subs: Sub[]; }
const NAV: NavItem[] = [
  { id: 'dashboard', label: '📊 لوحة القيادة', section: 'dashboard', subs: [] },
  { id: 'contracts', label: '📄 العقود', section: 'contracts', subs: [
    { id: 'list', label: 'قائمة العقود' },
    { id: 'new', label: 'عقد جديد', action: 'create' },
    { id: 'versions', label: 'النسخ' },
    { id: 'tasks', label: 'مهام التشغيل', section: 'tasks' },
  ] },
  { id: 'inbox', label: '💬 الإنبكس والدردشة', section: 'inbox', subs: [
    { id: 'conversations', label: 'المحادثات' },
    { id: 'chat', label: 'عرض الدردشة' },
    { id: 'assigned', label: 'المعيّنة لي' },
    { id: 'notes', label: 'الملاحظات الداخلية' },
  ] },
  { id: 'whatsapp', label: '🟢 واتساب', section: 'whatsapp', subs: [
    { id: 'connection', label: 'الربط والتوصيل' },
    { id: 'templates', label: 'القوالب' },
    { id: 'settings', label: 'الإعدادات' },
    { id: 'webhook', label: 'حالة Webhook' },
  ] },
  { id: 'automation', label: '⚙️ الأتمتة', section: 'automation', subs: [
    { id: 'rules', label: 'القواعد' },
    { id: 'designer', label: 'مصمّم التدفقات' },
    { id: 'killswitch', label: 'مفتاح الإيقاف' },
  ] },
  { id: 'users', label: '👥 المستخدمون', section: 'users', subs: [
    { id: 'list', label: 'قائمة المستخدمين' },
    { id: 'add', label: 'إضافة مستخدم' },
    { id: 'passwords', label: 'كلمات السر' },
    { id: 'permissions', label: 'الصلاحيات' },
    { id: 'departments', label: 'الأقسام' },
  ] },
  { id: 'audit', label: '📜 التدقيق والتقارير', section: 'audit', subs: [] },
  { id: 'settings', label: '🛠️ إعدادات النظام', section: 'settings', subs: [
    { id: 'system', label: 'إعدادات النظام' },
    { id: 'checklist', label: 'قائمة الربط (10 خطوات)' },
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

export default function App() {
  const [me, setMe] = useState<MeUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginErr, setLoginErr] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [{ main, sub }, setNav] = useState(parseHash);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Bundle>(EMPTY);
  const [err, setErr] = useState('');

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
    setOpen(false);
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

  if (!authChecked) return <div className="app"><main><p className="muted">جارٍ التحقق من الجلسة…</p></main></div>;
  if (!me) return <div className="app login-wrap" dir="rtl">
    <header className="topbar">
      <div><b className="brand">Pilot System</b><span className="brand-sub"> لوحة تشغيل — النسخة المستقلة</span></div>
    </header>
    <main>
      <section className="card login-card">
        <div className="login-brand"><b>Pilot System</b><span>لوحة تشغيل فريق العمليات — النسخة المستقلة</span></div>
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

  // Sidebar groups are presentation-only: they reorder nothing, hide nothing,
  // and never bypass hasSection gating (visibleNav is computed the same way).
  const SIDE_GROUPS: { title: string; ids: MainTab[] }[] = [
    { title: 'العمل اليومي', ids: ['dashboard', 'contracts', 'inbox'] },
    { title: 'القنوات والأتمتة', ids: ['whatsapp', 'automation'] },
    { title: 'الإدارة والمراجعة', ids: ['users', 'audit', 'settings'] },
  ];
  return <div className="app">
    <header className="topbar">
      <button className="burger" onClick={() => setOpen(!open)} aria-label="القائمة" aria-expanded={open}>☰</button>
      <div><b className="brand">Pilot System</b><span className="brand-sub"> لوحة تشغيل — النسخة المستقلة</span></div>
      <div className="top-status">
        {data.killSwitch && <span className="pill danger">⛔ الأتمتة موقوفة</span>}
        {unread > 0 && <button className="pill" onClick={() => go('inbox', 'conversations')}>💬 {unread} غير مقروءة</button>}
        <span className={`pill ${data.healthOk ? 'ok' : 'danger'}`}>{data.healthOk ? '● متصل' : '● غير متصل'}</span>
        <span className="pill">{me.full_name} ({ROLE_AR[me.role]})</span>
        <button className="pill" onClick={logout}>خروج</button>
      </div>
    </header>
    {err && <div className="errbar">{err}</div>}
    <div className="layout">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        {SIDE_GROUPS.map((g) => {
          const items = visibleNav.filter((n) => g.ids.includes(n.id));
          if (items.length === 0) return null;
          return <div key={g.title} className="side-group">
            <p className="side-group-title">{g.title}</p>
            {items.map((n) => <button key={n.id} className={`side-link ${main === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>{n.label}{n.id === 'inbox' && unread > 0 ? ` (${unread})` : ''}</button>)}
          </div>;
        })}
        <div className="side-guard">
          <b>ضوابط ثابتة</b>
          <p>لا محفظة داخلية، لا متجر، لا إجراء مالي آلي. تأكيد الدفع لا يتم إلا بمرجع من المؤسسة المالية الخارجية.</p>
          <p>بيانات الربط والمفاتيح في متغيرات بيئة الخادم فقط — لا تُدخل هنا أبداً.</p>
        </div>
      </aside>
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}
      <main>
        {activeSubs.length > 0 && <div className="btn-row subnav">
          {activeSubs.map((s) => <button key={s.id} className={`btn small ${sub === s.id ? '' : 'ghost'}`} onClick={() => go(main, s.id)}>{s.label}</button>)}
        </div>}
        {forbidden ? <NoPermission /> : <>
          {main === 'dashboard' && <Dashboard b={data} reload={reload} />}
          {main === 'contracts' && sub === 'versions' && <ContractVersions b={data} />}
          {main === 'contracts' && sub === 'tasks' && <Tasks b={data} reload={reload} />}
          {main === 'contracts' && (sub === 'list' || sub === 'new') && <Contracts b={data} reload={reload} sub={sub as 'list' | 'new'} />}
          {main === 'inbox' && <Inbox b={data} reload={reload} me={me} sub={sub as 'conversations' | 'chat' | 'assigned' | 'notes'} />}
          {main === 'whatsapp' && sub === 'templates' && <Templates b={data} reload={reload} canEdit={hasAction(me, 'whatsapp', 'edit')} />}
          {main === 'whatsapp' && sub !== 'templates' && <WhatsApp b={data} reload={reload} me={me} sub={sub as 'connection' | 'settings' | 'webhook'} />}
          {main === 'automation' && sub === 'designer' && <WorkflowDesigner workflows={data.workflows} templates={data.templates} reload={reload} />}
          {main === 'automation' && sub === 'rules' && <Automation b={data} reload={reload} only="rules" />}
          {main === 'automation' && sub === 'killswitch' && <Automation b={data} reload={reload} only="killswitch" />}
          {main === 'users' && <Users b={data} reload={reload} me={me} sub={sub as 'list' | 'add' | 'passwords' | 'permissions' | 'departments'} />}
          {main === 'audit' && <Audit b={data} />}
          {main === 'settings' && sub === 'system' && <SystemSettings />}
          {main === 'settings' && sub === 'checklist' && <Checklist />}
        </>}
      </main>
    </div>
  </div>;
}
