import type { ReactNode } from 'react';
import { IconInbox } from './icons';

export function fmt(dt?: string | null) {
  if (!dt) return '—';
  try { return new Date(dt).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return dt; }
}
export function Card({ title, sub, children, actions }: { title: string; sub?: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="card">
    <div className="card-head"><div><h2>{title}</h2>{sub && <p className="muted">{sub}</p>}</div>{actions}</div>
    {children}
  </section>;
}
export function LocalNote({ children }: { children: ReactNode }) {
  return <p className="local-note">ملاحظة: بيانات محلية في هذا المتصفح فقط — لا يوجد endpoint في الخادم الحالي لهذا الإجراء. {children}</p>;
}
export function Empty({ text }: { text: string }) { return <p className="empty"><span className="empty-icon" aria-hidden="true"><IconInbox /></span>{text}</p>; }
export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
export function stateTone(s: string): 'ok' | 'warn' | 'bad' | 'info' | 'neutral' {
  if (['completed', 'refunded', 'payment_confirmed'].includes(s)) return 'ok';
  if (['disputed', 'refund_pending', 'cancelled'].includes(s)) return 'bad';
  if (['payment_pending', 'preparing', 'delivered'].includes(s)) return 'warn';
  if (['draft', 'issued', 'accepted'].includes(s)) return 'info';
  return 'neutral';
}
