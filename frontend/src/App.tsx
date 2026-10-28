import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Audit, Automation, Checklist, Contracts, Dashboard, Inbox, Tasks, Templates, Users, type Bundle } from './views';
import { WorkflowDesigner } from './workflow';

type View = 'dashboard' | 'contracts' | 'inbox' | 'tasks' | 'workflows' | 'templates' | 'automation' | 'users' | 'checklist' | 'audit';
const GROUPS: { title: string; items: { id: View; label: string }[] }[] = [
  { title: 'العمليات اليومية', items: [
    { id: 'dashboard', label: '📊 لوحة القيادة' },
    { id: 'contracts', label: '📄 العقود' },
    { id: 'inbox', label: '💬 الإنبكس' },
    { id: 'tasks', label: '✅ مهام التشغيل' },
  ] },
  { title: 'واتساب والأتمتة', items: [
    { id: 'workflows', label: '🔀 مصمّم التدفقات' },
    { id: 'templates', label: '📋 قوالب واتساب' },
    { id: 'automation', label: '⛔ الأتمتة ومفتاح الإيقاف' },
  ] },
  { title: 'الإدارة', items: [
    { id: 'users', label: '👥 المستخدمون' },
    { id: 'checklist', label: '🔗 قائمة الربط' },
    { id: 'audit', label: '📜 سجل التدقيق' },
  ] },
];
const EMPTY: Bundle = { contracts: [], conversations: [], messages: [], tasks: [], workflows: [], templates: [], users: [], audit: [], killSwitch: false, healthOk: false };

export default function App() {
  const [view, setView] = useState<View>(() => {
    const h = location.hash.replace('#', '') as View;
    return (['dashboard', 'contracts', 'inbox', 'tasks', 'workflows', 'templates', 'automation', 'users', 'checklist', 'audit'] as View[]).includes(h) ? h : 'dashboard';
  });
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Bundle>(EMPTY);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    try {
      const [health, contracts, conversations, messages, tasks, workflows, templates, users, audit, ks] = await Promise.all([
        api.health().catch(() => null),
        api.contracts(), api.conversations(), api.messages(), api.tasks(),
        api.workflows(), api.templates(), api.users(), api.audit(), api.killSwitchGet(),
      ]);
      setData({ contracts, conversations, messages, tasks, workflows, templates, users, audit, killSwitch: ks.killSwitch, healthOk: !!health?.ok });
      setErr('');
    } catch (e) { setErr('تعذر الاتصال بالخادم: ' + (e as Error).message + ' — تأكد أن الخادم يعمل على نفس المضيف.'); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  function go(v: View) { setView(v); location.hash = v; setOpen(false); window.scrollTo(0, 0); }
  const unread = data.conversations.reduce((s, c) => s + (c.unread_count || 0), 0);

  return <div className="app">
    <header className="topbar">
      <button className="burger" onClick={() => setOpen(!open)} aria-label="القائمة">☰</button>
      <div><b className="brand">Pilot System</b><span className="brand-sub"> لوحة تشغيل — النسخة المستقلة</span></div>
      <div className="top-status">
        {data.killSwitch && <span className="pill danger">⛔ الأتمتة موقوفة</span>}
        {unread > 0 && <button className="pill" onClick={() => go('inbox')}>💬 {unread} غير مقروءة</button>}
        <span className={`pill ${data.healthOk ? 'ok' : 'danger'}`}>{data.healthOk ? '● متصل' : '● غير متصل'}</span>
      </div>
    </header>
    {err && <div className="errbar">{err}</div>}
    <div className="layout">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        {GROUPS.map((g) => <div key={g.title} className="group">
          <div className="group-title">{g.title}</div>
          {g.items.map((it) => <button key={it.id} className={view === it.id ? 'active' : ''} onClick={() => go(it.id)}>{it.label}{it.id === 'inbox' && unread > 0 ? ` (${unread})` : ''}</button>)}
        </div>)}
        <div className="side-guard">
          <b>ضوابط ثابتة</b>
          <p>لا محفظة داخلية، لا متجر، لا إجراء مالي آلي. تأكيد الدفع لا يتم إلا بمرجع من المؤسسة المالية الخارجية.</p>
          <p>بيانات الربط والمفاتيح في متغيرات بيئة الخادم فقط — لا تُدخل هنا أبداً.</p>
        </div>
      </aside>
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}
      <main>
        {view === 'dashboard' && <Dashboard b={data} reload={reload} />}
        {view === 'contracts' && <Contracts b={data} reload={reload} />}
        {view === 'inbox' && <Inbox b={data} reload={reload} />}
        {view === 'tasks' && <Tasks b={data} reload={reload} />}
        {view === 'workflows' && <WorkflowDesigner workflows={data.workflows} templates={data.templates} reload={reload} />}
        {view === 'templates' && <Templates b={data} />}
        {view === 'automation' && <Automation b={data} reload={reload} />}
        {view === 'users' && <Users b={data} reload={reload} />}
        {view === 'checklist' && <Checklist />}
        {view === 'audit' && <Audit b={data} />}
      </main>
    </div>
  </div>;
}
