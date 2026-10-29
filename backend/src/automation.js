// automation.js — the ONE automation engine's pure rules: money-step
// rejection (recursive, at save AND execution), Arabic normalisation,
// keyword matching (exact before contains, longest wins), step ordering
// and business-hours parsing. Execution itself lives in server.js and
// calls these helpers, so rules, the designer and macros share one engine.
const BANNED_STEP_TYPES = ['release_money', 'refund_money', 'confirm_payment', 'settle_dispute', 'release_payment', 'refund_payment', 'payment_confirm', 'release_funds', 'refund_funds'];
const AUTOMATION_MAX_STEPS_PER_RUN = 20;
const AUTOMATION_COOLDOWN_MS = 60 * 1000;
const AUTOMATION_MAX_RUNS_PER_MINUTE = 5;
function stepIsBanned(s) {
  if (typeof s === 'string') return BANNED_STEP_TYPES.includes(s);
  if (!s || typeof s !== 'object') return false;
  const t = s.step_type || s.action || s.type || '';
  if (BANNED_STEP_TYPES.includes(t)) return true;
  if ((t === 'contract_transition' || t === 'state_change' || t === 'update_contract_state') &&
      ['payment_confirmed', 'refund_pending', 'refunded'].includes(String(s.to || s.target_state || ''))) return true;
  return false;
}
function hasBannedStep(steps) {
  const walk = (arr) => {
    for (const s of (arr || [])) {
      if (stepIsBanned(s)) return true;
      if (s && typeof s === 'object') {
        for (const k of ['then', 'else', 'steps', 'branches', 'children']) {
          if (Array.isArray(s[k]) && walk(s[k])) return true;
        }
      }
    }
    return false;
  };
  return walk(steps);
}
function normaliseSteps(steps) {
  return (steps || []).map((s, i) => ({ ...s, order: (typeof s.order === 'number' ? s.order : i) }))
    .sort((a, b) => a.order - b.order);
}
function normalizeArabic(s) {
  return String(s || '').toLowerCase()
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim();
}
function keywordMatchKind(triggerValue, normInbound) {
  const tv = normalizeArabic(triggerValue);
  if (!tv || !normInbound) return null;
  if (normInbound === tv) return 'exact';
  if (normInbound.includes(tv)) return 'contains';
  return null;
}
function parseHoursRange(v) {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return { start: 9 * 60, end: 17 * 60 };
  return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) };
}
function isBusinessHoursNow(v) {
  const { start, end } = parseHoursRange(v);
  const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes();
  return start <= end ? (mins >= start && mins < end) : (mins >= start || mins < end);
}
module.exports = {
  BANNED_STEP_TYPES, AUTOMATION_MAX_STEPS_PER_RUN, AUTOMATION_COOLDOWN_MS, AUTOMATION_MAX_RUNS_PER_MINUTE,
  stepIsBanned, hasBannedStep, normaliseSteps, normalizeArabic, keywordMatchKind, parseHoursRange, isBusinessHoursNow,
};
