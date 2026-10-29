// media.js — upload caps, allowed types, filename sanitising.
// Files live outside the repo (backend/uploads, gitignored); deleting a
// file record never deletes messages that used it (messages keep their
// own media metadata, not a foreign key to the file).
const UPLOAD_MAX_BYTES = 16 * 1024 * 1024; // 16 MiB, all types
const UPLOAD_ALLOWED = {
  '.jpg': { mime: 'image/jpeg', kind: 'image' }, '.jpeg': { mime: 'image/jpeg', kind: 'image' },
  '.png': { mime: 'image/png', kind: 'image' },
  '.mp4': { mime: 'video/mp4', kind: 'video' }, '.3gp': { mime: 'video/3gpp', kind: 'video' },
  '.aac': { mime: 'audio/aac', kind: 'audio' }, '.amr': { mime: 'audio/amr', kind: 'audio' },
  '.mp3': { mime: 'audio/mpeg', kind: 'audio' }, '.ogg': { mime: 'audio/ogg', kind: 'audio' },
  '.opus': { mime: 'audio/opus', kind: 'audio' },
  '.pdf': { mime: 'application/pdf', kind: 'document' }, '.doc': { mime: 'application/msword', kind: 'document' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' },
  '.xls': { mime: 'application/vnd.ms-excel', kind: 'document' },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'document' },
  '.ppt': { mime: 'application/vnd.ms-powerpoint', kind: 'document' },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'document' },
  '.txt': { mime: 'text/plain', kind: 'document' },
};
function sanitizeFilename(name) {
  let base = String(name || '').split(/[\\/]/).pop() || 'file';
  base = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.+/g, '.').replace(/^[^A-Za-z0-9]+/, '');
  if (!base || base === '.' || base === '..') base = 'file';
  const dot = base.lastIndexOf('.');
  if (dot > 0) {
    const ext = base.slice(dot); const stem = base.slice(0, dot).slice(0, 80);
    base = (stem || 'file') + ext;
  } else base = base.slice(0, 100);
  return base;
}
function publicUpload(u) {
  if (!u) return null;
  return { id: u.id, filename: u.sanitized_filename, stored_filename: u.stored_filename, mime_type: u.mime_type, kind: u.kind, size_bytes: u.size_bytes, media_id: u.media_id || null, conversation_id: u.conversation_id || null, uploaded_by: u.uploaded_by, dry_run: !!u.dry_run, created_at: u.created_at };
}
module.exports = { UPLOAD_MAX_BYTES, UPLOAD_ALLOWED, sanitizeFilename, publicUpload };
