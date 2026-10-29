// contacts.js — phone validation, label parsing, CSV parse/escape.
// Contacts are a contract-scoped address book only: never an audience,
// never a broadcast list, and creating one never confers Utility eligibility
// (that is computed in server.js from real inbound / Meta-sent history).
const { normPhone, phoneKey } = require('./whatsapp');
function validContactPhone(p) { return /^\+?\d{7,15}$/.test(normPhone(p)); }
function parseContactLabels(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
  if (typeof v === 'string') return v.split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
  return [];
}
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let inQ = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
module.exports = { validContactPhone, parseContactLabels, parseCsv, csvEscape, normPhone, phoneKey };
