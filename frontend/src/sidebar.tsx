import { ROLE_AR, type MeUser } from './types';
import {
  IconBolt, IconChat, IconCheckSquare, IconDoc, IconGrid, IconInbox, IconLink, IconReport,
  IconSettings, IconShield, IconUsers, IconWorkflow,
} from './icons';

export type MainTab = 'dashboard' | 'contracts' | 'inbox' | 'whatsapp' | 'automation' | 'ai' | 'team' | 'tickets' | 'feedback' | 'users' | 'audit' | 'settings';
export interface SideNavItem { id: MainTab; label: string; section: string; icon: (p: { className?: string }) => React.ReactElement; }
export const SIDE_GROUPS: { title: string; ids: MainTab[] }[] = [
  { title: 'العمل اليومي', ids: ['dashboard', 'contracts', 'inbox', 'tickets'] },
  { title: 'القنوات والأتمتة', ids: ['whatsapp', 'automation', 'ai'] },
  { title: 'الإدارة والمراجعة', ids: ['users', 'team', 'audit', 'feedback', 'settings'] },
];
export const SIDE_ITEMS: Record<MainTab, SideNavItem> = {
  dashboard: { id: 'dashboard', label: 'لوحة القيادة', section: 'dashboard', icon: IconGrid },
  contracts: { id: 'contracts', label: 'العقود', section: 'contracts', icon: IconDoc },
  inbox: { id: 'inbox', label: 'الإنبكس والدردشة', section: 'inbox', icon: IconChat },
  whatsapp: { id: 'whatsapp', label: 'واتساب', section: 'whatsapp', icon: IconLink },
  automation: { id: 'automation', label: 'الأتمتة', section: 'automation', icon: IconBolt },
  ai: { id: 'ai', label: 'مساعد الذكاء الاصطناعي', section: 'automation', icon: IconWorkflow },
  team: { id: 'team', label: 'الفريق', section: 'users', icon: IconCheckSquare },
  tickets: { id: 'tickets', label: 'تذاكري', section: 'tasks', icon: IconInbox },
  feedback: { id: 'feedback', label: 'أفكار وملاحظات', section: 'audit', icon: IconChat },
  users: { id: 'users', label: 'المستخدمون', section: 'users', icon: IconUsers },
  audit: { id: 'audit', label: 'التدقيق والتقارير', section: 'audit', icon: IconReport },
  settings: { id: 'settings', label: 'إعدادات النظام', section: 'settings', icon: IconSettings },
};

function initials(name: string): string {
  const w = name.replace(/[^\w\u0600-\u06FF ]/g, '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '؟';
  return (w[0][0] + (w[1] ? w[1][0] : '')).toUpperCase();
}

interface SidebarProps {
  me: MeUser; main: MainTab; visible: MainTab[];
  unread: number; openTasks: number;
  collapsed: boolean; onToggleCollapse: () => void;
  go: (m: MainTab) => void; logout: () => void;
}

/**
 * Sidebar V2 — ONE sidebar component, used only on web/desktop.
 * Phone never renders it (CSS hides it < 820px and App renders the
 * top tab bar instead). Brand header, grouped nav, badge slot,
 * solid-teal active pill + inline-start accent bar, hover wash,
 * icon-only collapsed rail (76px) with native tooltips, user footer.
 */
export function Sidebar({ me, main, visible, unread, openTasks, collapsed, onToggleCollapse, go, logout }: SidebarProps) {
  const badgeFor = (id: MainTab): number => (id === 'inbox' ? unread : id === 'contracts' ? openTasks : 0);
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="القائمة الجانبية">
      <div className="side-brand">
        <span className="side-brand-mark"><IconShield /></span>
        {!collapsed && (
          <span className="side-brand-text">
            <b>Pilot System</b>
            <span>نظام إدارة العقود والمعاملات</span>
          </span>
        )}
        <button className="side-collapse" type="button" title={collapsed ? 'توسيع القائمة' : 'طي القائمة إلى أيقونات'} aria-label={collapsed ? 'توسيع القائمة' : 'طي القائمة'} aria-expanded={!collapsed} onClick={onToggleCollapse}>
          {collapsed ? '»' : '«'}
        </button>
      </div>
      <nav className="side-nav">
        {SIDE_GROUPS.map((g) => {
          const items = g.ids.filter((id) => visible.includes(id));
          if (items.length === 0) return null;
          return (
            <div key={g.title} className="side-group">
              {!collapsed && <p className="side-group-title">{g.title}</p>}
              {items.map((id) => {
                const n = SIDE_ITEMS[id];
                const Icon = n.icon;
                const badge = badgeFor(id);
                const active = main === id;
                return (
                  <button key={id} type="button" title={n.label} aria-label={n.label} aria-current={active ? 'page' : undefined}
                    className={`side-link ${active ? 'active' : ''}`} onClick={() => go(id)}>
                    <span className="side-link-icon"><Icon /></span>
                    {!collapsed && <span className="side-link-label">{n.label}</span>}
                    {!collapsed && badge > 0 && <span className="side-unread">{badge}</span>}
                    {collapsed && badge > 0 && <span className="side-unread-dot" aria-label={`${badge} جديد`} />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="side-foot">
        {!collapsed && (
          <div className="side-guard">
            <b>ضوابط ثابتة</b>
            <p>لا محفظة داخلية، لا متجر، لا إجراء مالي آلي. تأكيد الدفع لا يتم إلا بمرجع من المؤسسة المالية الخارجية.</p>
          </div>
        )}
        <div className="side-user">
          <span className="side-user-avatar">{initials(me.full_name)}</span>
          {!collapsed && (
            <span className="side-user-text">
              <b>{me.full_name}</b>
              <span>{ROLE_AR[me.role] || me.role}</span>
            </span>
          )}
          <button className="side-logout" type="button" title="تسجيل الخروج" onClick={logout}>{collapsed ? '↩' : 'خروج'}</button>
        </div>
      </div>
    </aside>
  );
}
