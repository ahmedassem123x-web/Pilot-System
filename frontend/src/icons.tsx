// Inline SVG icons (stroke style, currentColor) — no emoji, no external assets.
// Every icon is a simple geometric drawing; paths are hand-written here.
import type { JSX } from 'react';

type P = { className?: string };
function Svg({ className, children }: P & { children: React.ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
export function IconShield(p: P) {
  return <Svg {...p}><path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3z" /><path d="M9 12l2 2 4-4" /></Svg>;
}
export function IconGrid(p: P) {
  return <Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Svg>;
}
export function IconDoc(p: P) {
  return <Svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></Svg>;
}
export function IconChat(p: P) {
  return <Svg {...p}><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5z" /><path d="M8 10h8M8 13.5h5" /></Svg>;
}
export function IconCheck(p: P) {
  return <Svg {...p}><path d="M20 6L9 17l-5-5" /></Svg>;
}
export function IconCheckSquare(p: P) {
  return <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 12l2 2 4-4" /></Svg>;
}
export function IconWorkflow(p: P) {
  return <Svg {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="12" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.5 6.5L15.5 11M8.5 17.5L15.5 13" /></Svg>;
}
export function IconTemplate(p: P) {
  return <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></Svg>;
}
export function IconBolt(p: P) {
  return <Svg {...p}><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></Svg>;
}
export function IconUsers(p: P) {
  return <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /><circle cx="17" cy="9" r="2.5" /><path d="M16 15.2c2.6.3 4.6 1.8 5.3 4.3" /></Svg>;
}
export function IconLink(p: P) {
  return <Svg {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></Svg>;
}
export function IconInbox(p: P) {
  return <Svg {...p}><path d="M3 7l9 6 9-6" /><path d="M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /><path d="M12 13v6" /></Svg>;
}
export function IconMoney(p: P) {
  return <Svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></Svg>;
}
export function IconReport(p: P) {
  return <Svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" /><path d="M8 13v4M12 10v7M16 13v4" /></Svg>;
}
export function IconSettings(p: P) {
  return <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Svg>;
}
export function IconPower(p: P) {
  return <Svg {...p}><path d="M18.36 6.64a9 9 0 1 1-12.72 0" /><path d="M12 2v10" /></Svg>;
}
export type { JSX };
