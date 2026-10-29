// contracts.js — the 12-state contract machine and clause fingerprint.
// Single source of truth for states/transitions; server.js imports these
// (it no longer defines its own copy).
const crypto = require('crypto');
const STATES = ['draft', 'issued', 'accepted', 'payment_pending', 'payment_confirmed', 'preparing', 'delivered', 'completed', 'disputed', 'refund_pending', 'refunded', 'cancelled'];
const TRANSITIONS = {
  draft: ['issued', 'cancelled'],
  issued: ['accepted', 'cancelled'],
  accepted: ['payment_pending', 'cancelled'],
  payment_pending: ['payment_confirmed', 'cancelled'],
  payment_confirmed: ['preparing', 'cancelled'],
  preparing: ['delivered', 'disputed'],
  delivered: ['completed', 'disputed'],
  disputed: ['refund_pending', 'cancelled', 'preparing'],
  refund_pending: ['refunded'],
  completed: [], refunded: [], cancelled: [],
};
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function contractCode(n) { return 'PS-' + String(1000 + n); }
function canTransition(from, to) { return (TRANSITIONS[from] || []).includes(to); }
module.exports = { STATES, TRANSITIONS, sha256, contractCode, canTransition };
