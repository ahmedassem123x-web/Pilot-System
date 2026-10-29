// whatsapp.js — phone normalisation, 24h window, Meta status ranking.
// No credential, phone number value or message content is stored here;
// these are pure helpers used by server.js and the webhook handler.
function normPhone(p) { return String(p || '').replace(/[\s\-()]/g, ''); }
function phoneKey(p) { return normPhone(p).replace(/^\+/, ''); }
function within24h(iso) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && (Date.now() - t) < 24 * 3600 * 1000;
}
const META_STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };
function mapMetaStatus(s) {
  const v = String(s || '').toLowerCase();
  if (['sent', 'delivered', 'read', 'failed'].includes(v)) return v;
  return null;
}
function mapMetaTemplateStatus(s) {
  const v = String(s || '').toUpperCase();
  if (v === 'APPROVED') return 'approved';
  if (v === 'PENDING') return 'pending';
  if (v === 'REJECTED') return 'rejected';
  if (v === 'PAUSED') return 'paused';
  if (v === 'DISABLED') return 'disabled';
  return null;
}
// Status ranking: never let an older status overwrite a newer one,
// except 'failed', which always applies.
function newerStatus(current, incoming) {
  if (!incoming) return current || null;
  if (incoming === 'failed') return 'failed';
  if (!current) return incoming;
  return (META_STATUS_RANK[incoming] || 0) > (META_STATUS_RANK[current] || 0) ? incoming : current;
}
module.exports = { normPhone, phoneKey, within24h, META_STATUS_RANK, mapMetaStatus, mapMetaTemplateStatus, newerStatus };
