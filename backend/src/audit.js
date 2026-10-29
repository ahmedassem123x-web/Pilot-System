// audit.js — append-only audit log. The API never updates or deletes
// audit rows; this module only appends. Actor is always the real user
// (or 'system'/'automation' for non-human events), never a placeholder.
function appendAudit(db, nextId, save, actor, entity, id, action, details = {}) {
  db.audit.push({ id: nextId(), actor, entity, entity_id: id, action, details, created_at: new Date().toISOString() });
  save();
}
module.exports = { appendAudit };
