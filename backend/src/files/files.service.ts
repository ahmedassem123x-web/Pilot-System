// Pilot System v3.1 — Sprint 3 (PB-25). File metadata + short-lived
// signed links.
//
// STORAGE STATUS — READ THIS FIRST: this is the LOCAL / TEST
// implementation. It stores file METADATA only (name, type, size,
// owning transaction, uploader); it stores NO file bytes and makes NO
// claim about any real object-storage bucket. The S3-compatible
// implementation is a Sprint 5 swap behind the ObjectStore interface
// below (same metadata shape, bytes in the bucket, same signed-link
// scheme). Do NOT present metadata rows here as stored files.
//
// SIGNED LINKS: HMAC SHA-256 over `<fileId>.<expiryEpochSeconds>`
// with the secret from the environment variable name FILE_LINK_SECRET
// (value never in code; tests pass their own test-only value). Links
// expire: an expired or tampered link verifies as invalid. No link is
// issued without an expiry, and no secret value ever appears in a
// link, a log, or a response.
//
// MASKING: the metadata display masks the uploader identifier (see
// common/masking.ts). The raw uploader id is kept inside the record
// for audit, not shown in the display payload.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DomainError, NotFoundError } from '../common/errors';
import { newId } from '../common/ids';
import { maskIdentifier } from '../common/masking';

export interface FileRecord {
  id: string;
  transaction_id: string | null;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  created_at: Date;
}

export interface ObjectStore {
  /** Stores metadata only in the test implementation (see header). */
  saveMetadata(record: FileRecord): FileRecord;
  findMetadata(id: string): FileRecord | undefined;
}

export class LocalTestObjectStore implements ObjectStore {
  private records = new Map<string, FileRecord>();

  saveMetadata(record: FileRecord): FileRecord {
    this.records.set(record.id, record);
    return record;
  }

  findMetadata(id: string): FileRecord | undefined {
    return this.records.get(id);
  }
}

export interface FilesServiceOptions {
  linkSecret?: string;
}

@Injectable()
export class FilesService {
  private readonly linkSecret?: string;

  constructor(
    private readonly store: ObjectStore = new LocalTestObjectStore(),
    options: FilesServiceOptions = {},
  ) {
    this.linkSecret = options.linkSecret;
  }

  uploadMetadata(input: {
    transactionId?: string | null;
    filename: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    uploadedBy: string;
  }): FileRecord {
    if (!input.filename) {
      throw new DomainError('INVALID_INPUT', 422, 'filename is required');
    }
    return this.store.saveMetadata({
      id: newId(),
      transaction_id: input.transactionId ?? null,
      filename: input.filename,
      mime_type: input.mimeType ?? null,
      size_bytes: input.sizeBytes ?? null,
      uploaded_by: input.uploadedBy,
      created_at: new Date(),
    });
  }

  /** Display payload: uploader identifier masked (see header). */
  displayMetadata(id: string): Record<string, unknown> {
    const record = this.store.findMetadata(id);
    if (!record) throw new NotFoundError('File', id);
    return {
      id: record.id,
      transaction_id: record.transaction_id,
      filename: record.filename,
      mime_type: record.mime_type,
      size_bytes: record.size_bytes,
      uploaded_by_masked: maskIdentifier(record.uploaded_by),
      created_at: record.created_at,
    };
  }

  generateSignedLink(
    fileId: string,
    ttlSeconds = 900,
  ): { link: string; expiresAt: Date } {
    if (!this.linkSecret) {
      throw new DomainError(
        'AUTH_FAILED',
        500,
        'File link secret is not configured (environment variable name FILE_LINK_SECRET)',
      );
    }
    const record = this.store.findMetadata(fileId);
    if (!record) throw new NotFoundError('File', fileId);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const exp = Math.floor(expiresAt.getTime() / 1000);
    const signature = createHmac('sha256', this.linkSecret)
      .update(`${fileId}.${exp}`)
      .digest('hex');
    return {
      link: `/api/files/${fileId}?sig=${signature}&exp=${exp}`,
      expiresAt,
    };
  }

  verifySignedLink(
    fileId: string,
    signature: string | undefined,
    exp: string | undefined,
  ): { valid: boolean; reason: string | null } {
    if (!this.linkSecret) {
      return { valid: false, reason: 'link secret is not configured' };
    }
    if (!signature || !exp) {
      return { valid: false, reason: 'signature and expiry are required' };
    }
    const expSeconds = Number(exp);
    if (!Number.isFinite(expSeconds)) {
      return { valid: false, reason: 'expiry is not a number' };
    }
    if (Math.floor(Date.now() / 1000) > expSeconds) {
      return { valid: false, reason: 'link has expired' };
    }
    const expected = createHmac('sha256', this.linkSecret)
      .update(`${fileId}.${expSeconds}`)
      .digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const suppliedBuffer = Buffer.from(signature, 'hex');
    if (suppliedBuffer.length !== expectedBuffer.length) {
      return { valid: false, reason: 'signature mismatch' };
    }
    if (!timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      return { valid: false, reason: 'signature mismatch' };
    }
    if (!this.store.findMetadata(fileId)) {
      return { valid: false, reason: 'file not found' };
    }
    return { valid: true, reason: null };
  }
}
