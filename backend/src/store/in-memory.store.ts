// Pilot System v3.1 — Sprint 2.
// IN-MEMORY TEST DOUBLE — NOT Prisma, NOT PostgreSQL. This class exists
// ONLY because this environment has no live PostgreSQL and no Docker
// (verified: `which docker psql` returns nothing). It implements the
// Store interface exactly, including every database-level rule the
// schema expresses (uniques, append-only refusal), so Sprint 3 can swap
// in the Prisma implementation without changing service or Guard code.
// NEVER present results obtained through this class as live-database
// results. Labels in test files repeat this warning.

import { newId } from '../common/ids';
import {
  DomainError,
  DuplicateError,
  ImmutableRowError,
  NotFoundError,
} from '../common/errors';
import type {
  AuditEvent,
  ContractVersion,
  CreateAuditEventInput,
  CreateContractVersionInput,
  CreateCoordinationInput,
  CreateDeliveryEventInput,
  CreateDisputeInput,
  CreateFollowUpCaseInput,
  CreateMessageLogInput,
  CreatePaymentEvidenceInput,
  CreateSettlementSummaryInput,
  CreateTransactionInput,
  CreateUserInput,
  DeliveryEvent,
  Dispute,
  FinancialCoordinationRecord,
  FollowUpCase,
  MessageLog,
  PaymentEvidence,
  Permission,
  Role,
  SettlementSummary,
  StaffUser,
  Store,
  StoreSnapshot,
  Transaction,
  TransactionParty,
  UpdateMessageLogInput,
  User,
} from './repository';
import type {
  PartyRole,
  TransactionState,
  UserStatus,
} from '../common/transaction-state';

export class InMemoryStore implements Store {
  private users = new Map<string, User>();
  private staffUsers = new Map<string, StaffUser>();
  private roles = new Map<string, Role>();
  private permissions = new Map<string, Permission>();
  private staffRoles = new Set<string>(); // `${staffId}:${roleId}`
  private rolePermissions = new Set<string>(); // `${roleId}:${permissionId}`
  private transactions = new Map<string, Transaction>();
  private parties: TransactionParty[] = [];
  private contractVersions: ContractVersion[] = [];
  private auditEvents: AuditEvent[] = [];
  private evidences: PaymentEvidence[] = [];
  private coordinations: FinancialCoordinationRecord[] = [];
  private deliveryEvents: DeliveryEvent[] = [];
  private disputes: Dispute[] = [];
  private followUpCases: FollowUpCase[] = [];
  private summaries: SettlementSummary[] = [];
  private messageLogs: MessageLog[] = [];

  // -- Users ---------------------------------------------------------------
  createUser(input: CreateUserInput): User {
    const number = input.whatsapp_number.trim();
    if (!number) {
      throw new DomainError('INVALID_INPUT', 422, 'whatsapp_number is required');
    }
    if (this.findUserByWhatsapp(number)) {
      throw new DuplicateError(
        'DUPLICATE_WHATSAPP_NUMBER',
        `whatsapp_number already registered: ${number}`,
      );
    }
    const now = new Date();
    const user: User = {
      id: newId(),
      whatsapp_number: number,
      status: input.status ?? 'NOT_APPROVED',
      created_at: now,
      updated_at: now,
    };
    this.users.set(user.id, user);
    return user;
  }

  findUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  findUserByWhatsapp(whatsappNumber: string): User | undefined {
    for (const user of this.users.values()) {
      if (user.whatsapp_number === whatsappNumber) return user;
    }
    return undefined;
  }

  updateUserStatus(id: string, status: UserStatus): User {
    const user = this.users.get(id);
    if (!user) throw new NotFoundError('User', id);
    user.status = status;
    user.updated_at = new Date();
    return user;
  }

  countUsers(): number {
    return this.users.size;
  }

  // -- Staff / RBAC ----------------------------------------------------------
  createStaffUser(
    input: Omit<StaffUser, 'id' | 'created_at' | 'updated_at'>,
  ): StaffUser {
    if (this.findStaffByEmail(input.email)) {
      throw new DuplicateError('DUPLICATE_EMAIL', `email already registered`);
    }
    const now = new Date();
    const staff: StaffUser = { ...input, id: newId(), created_at: now, updated_at: now };
    this.staffUsers.set(staff.id, staff);
    return staff;
  }

  findStaffById(id: string): StaffUser | undefined {
    return this.staffUsers.get(id);
  }

  findStaffByEmail(email: string): StaffUser | undefined {
    for (const staff of this.staffUsers.values()) {
      if (staff.email === email) return staff;
    }
    return undefined;
  }

  createRole(name: string, description: string | null = null): Role {
    const existing = this.findRoleByName(name);
    if (existing) return existing;
    const role: Role = { id: newId(), name, description };
    this.roles.set(role.id, role);
    return role;
  }

  findRoleByName(name: string): Role | undefined {
    for (const role of this.roles.values()) {
      if (role.name === name) return role;
    }
    return undefined;
  }

  createPermission(name: string, description: string | null = null): Permission {
    const existing = this.findPermissionByName(name);
    if (existing) return existing;
    const permission: Permission = { id: newId(), name, description };
    this.permissions.set(permission.id, permission);
    return permission;
  }

  findPermissionByName(name: string): Permission | undefined {
    for (const permission of this.permissions.values()) {
      if (permission.name === name) return permission;
    }
    return undefined;
  }

  assignRoleToStaff(staffUserId: string, roleId: string): void {
    if (!this.staffUsers.has(staffUserId)) {
      throw new NotFoundError('StaffUser', staffUserId);
    }
    if (!this.roles.has(roleId)) throw new NotFoundError('Role', roleId);
    this.staffRoles.add(`${staffUserId}:${roleId}`);
  }

  assignPermissionToRole(roleId: string, permissionId: string): void {
    if (!this.roles.has(roleId)) throw new NotFoundError('Role', roleId);
    if (!this.permissions.has(permissionId)) {
      throw new NotFoundError('Permission', permissionId);
    }
    this.rolePermissions.add(`${roleId}:${permissionId}`);
  }

  staffPermissions(staffUserId: string): string[] {
    const names = new Set<string>();
    for (const key of this.staffRoles) {
      const [staffId, roleId] = key.split(':');
      if (staffId !== staffUserId) continue;
      for (const rp of this.rolePermissions) {
        const [rId, pId] = rp.split(':');
        if (rId !== roleId) continue;
        const permission = this.permissions.get(pId);
        if (permission) names.add(permission.name);
      }
    }
    return [...names];
  }

  // -- Transactions / parties / contracts ------------------------------------
  createTransaction(input: CreateTransactionInput): Transaction {
    if (
      !input.currency ||
      !input.product_description ||
      !input.delivery_point ||
      !input.cancellation_terms ||
      !(input.quantity > 0) ||
      !(input.amount >= 0)
    ) {
      throw new DomainError(
        'INVALID_INPUT',
        422,
        'Transaction requires amount, currency, product_description, quantity > 0, delivery_point and cancellation_terms',
      );
    }
    const now = new Date();
    const tx: Transaction = {
      id: newId(),
      state: 'DRAFT',
      amount: input.amount,
      currency: input.currency,
      product_description: input.product_description,
      quantity: input.quantity,
      delivery_point: input.delivery_point,
      cancellation_terms: input.cancellation_terms,
      external_payment_reference: null,
      created_at: now,
      updated_at: now,
    };
    this.transactions.set(tx.id, tx);
    return tx;
  }

  findTransactionById(id: string): Transaction | undefined {
    return this.transactions.get(id);
  }

  updateTransactionState(id: string, state: TransactionState): Transaction {
    const tx = this.transactions.get(id);
    if (!tx) throw new NotFoundError('Transaction', id);
    tx.state = state;
    tx.updated_at = new Date();
    return tx;
  }

  addParty(
    transactionId: string,
    userId: string,
    role: PartyRole,
  ): TransactionParty {
    if (!this.transactions.has(transactionId)) {
      throw new NotFoundError('Transaction', transactionId);
    }
    if (!this.users.has(userId)) throw new NotFoundError('User', userId);
    const clash = this.parties.find(
      (p) => p.transaction_id === transactionId && p.role === role,
    );
    if (clash) {
      throw new DuplicateError(
        'DUPLICATE_PARTY_ROLE',
        `Transaction already has a ${role} party`,
      );
    }
    const party: TransactionParty = {
      id: newId(),
      transaction_id: transactionId,
      user_id: userId,
      role,
    };
    this.parties.push(party);
    return party;
  }

  partiesForTransaction(transactionId: string): TransactionParty[] {
    return this.parties.filter((p) => p.transaction_id === transactionId);
  }

  createContractVersion(input: CreateContractVersionInput): ContractVersion {
    if (!this.transactions.has(input.transaction_id)) {
      throw new NotFoundError('Transaction', input.transaction_id);
    }
    const clash = this.contractVersions.find(
      (v) =>
        v.transaction_id === input.transaction_id &&
        v.version_number === input.version_number,
    );
    if (clash) {
      throw new DuplicateError(
        'INVALID_INPUT',
        `Contract version ${input.version_number} already exists for this transaction`,
      );
    }
    const version: ContractVersion = {
      id: newId(),
      transaction_id: input.transaction_id,
      version_number: input.version_number,
      content_hash: input.content_hash,
      storage_file_id: input.storage_file_id ?? null,
      accepted_at: null,
      accepted_by: null,
      superseded_by: input.superseded_by ?? null,
      created_at: new Date(),
    };
    this.contractVersions.push(version);
    return version;
  }

  versionsForTransaction(transactionId: string): ContractVersion[] {
    return this.contractVersions
      .filter((v) => v.transaction_id === transactionId)
      .sort((a, b) => a.version_number - b.version_number);
  }

  currentVersion(transactionId: string): ContractVersion | undefined {
    // Binding rule (transition-matrix.md §8a): current = HIGHEST
    // version_number. superseded_by is ignored for currency.
    const versions = this.versionsForTransaction(transactionId);
    return versions.length > 0 ? versions[versions.length - 1] : undefined;
  }

  updateContractVersion(
    _id: string,
    _patch: Partial<ContractVersion>,
  ): never {
    // Append-only: mirrors the migration trigger that raises on UPDATE.
    void _id;
    void _patch;
    throw new ImmutableRowError('contract_versions');
  }

  deleteContractVersion(_id: string): never {
    void _id;
    throw new ImmutableRowError('contract_versions');
  }

  // -- Audit (append-only) ---------------------------------------------------
  createAuditEvent(input: CreateAuditEventInput): AuditEvent {
    const event: AuditEvent = {
      id: newId(),
      correlation_id: input.correlation_id,
      transaction_id: input.transaction_id,
      actor_id: input.actor_id,
      actor_role: input.actor_role,
      action: input.action,
      previous_state: input.previous_state,
      new_state: input.new_state,
      timestamp: new Date(),
      details: input.details ?? null,
    };
    this.auditEvents.push(event);
    return event;
  }

  auditForTransaction(transactionId: string): AuditEvent[] {
    return this.auditEvents.filter((e) => e.transaction_id === transactionId);
  }

  allAuditEvents(): AuditEvent[] {
    return [...this.auditEvents];
  }

  updateAuditEvent(_id: string, _patch: Partial<AuditEvent>): never {
    void _id;
    void _patch;
    throw new ImmutableRowError('audit_events');
  }

  deleteAuditEvent(_id: string): never {
    void _id;
    throw new ImmutableRowError('audit_events');
  }

  // -- Evidence / coordination / delivery / disputes / settlement ------------
  createPaymentEvidence(input: CreatePaymentEvidenceInput): PaymentEvidence {
    if (!this.transactions.has(input.transaction_id)) {
      throw new NotFoundError('Transaction', input.transaction_id);
    }
    const evidence: PaymentEvidence = {
      id: newId(),
      transaction_id: input.transaction_id,
      channel: input.channel,
      sender_name: input.sender_name,
      beneficiary_name_as_shown: input.beneficiary_name_as_shown ?? null,
      amount: input.amount,
      currency: input.currency,
      external_payment_reference: input.external_payment_reference,
      receipt_file_id: input.receipt_file_id ?? null,
      submitted_at: new Date(),
      submitted_by: input.submitted_by,
      status: 'PAYMENT_EVIDENCE_SUBMITTED',
    };
    this.evidences.push(evidence);
    return evidence;
  }

  evidencesForTransaction(transactionId: string): PaymentEvidence[] {
    return this.evidences.filter((e) => e.transaction_id === transactionId);
  }

  createCoordinationRecord(
    input: CreateCoordinationInput,
  ): FinancialCoordinationRecord {
    if (!this.transactions.has(input.transaction_id)) {
      throw new NotFoundError('Transaction', input.transaction_id);
    }
    // Deposit-reference uniqueness across transactions (schema: UNIQUE).
    // NULLs never collide; one non-NULL value confirms at most one tx.
    if (input.deposit_reference) {
      const clash = this.findCoordinationByDepositReference(
        input.deposit_reference,
      );
      if (clash) {
        throw new DuplicateError(
          'DUPLICATE_DEPOSIT_REFERENCE',
          'Financial Institution Deposit Reference already used for another transaction; surface to staff for manual review',
        );
      }
    }
    const record: FinancialCoordinationRecord = {
      id: newId(),
      transaction_id: input.transaction_id,
      staff_id: input.staff_id,
      contact_method: input.contact_method,
      message_sent: input.message_sent ?? null,
      institution_response: input.institution_response ?? null,
      deposit_reference: input.deposit_reference ?? null,
      settlement_reference: input.settlement_reference ?? null,
      institution_confirmed: input.institution_confirmed ?? false,
      recorded_at: new Date(),
    };
    this.coordinations.push(record);
    return record;
  }

  coordinationsForTransaction(
    transactionId: string,
  ): FinancialCoordinationRecord[] {
    return this.coordinations.filter((c) => c.transaction_id === transactionId);
  }

  findCoordinationByDepositReference(
    depositReference: string,
  ): FinancialCoordinationRecord | undefined {
    return this.coordinations.find(
      (c) => c.deposit_reference === depositReference,
    );
  }

  updateCoordinationRecord(
    id: string,
    patch: Partial<FinancialCoordinationRecord>,
  ): FinancialCoordinationRecord {
    const record = this.coordinations.find((c) => c.id === id);
    if (!record) throw new NotFoundError('FinancialCoordinationRecord', id);
    // Deposit reference may never be silently re-pointed: a change to a
    // value already used elsewhere is a duplicate, surfaced to staff.
    if (
      patch.deposit_reference &&
      patch.deposit_reference !== record.deposit_reference
    ) {
      const clash = this.findCoordinationByDepositReference(
        patch.deposit_reference,
      );
      if (clash && clash.id !== id) {
        throw new DuplicateError(
          'DUPLICATE_DEPOSIT_REFERENCE',
          'Financial Institution Deposit Reference already used for another transaction',
        );
      }
    }
    Object.assign(record, patch);
    return record;
  }

  createDeliveryEvent(input: CreateDeliveryEventInput): DeliveryEvent {
    if (!this.transactions.has(input.transaction_id)) {
      throw new NotFoundError('Transaction', input.transaction_id);
    }
    const event: DeliveryEvent = {
      id: newId(),
      transaction_id: input.transaction_id,
      event_type: input.event_type,
      recorded_at: new Date(),
      recorded_by: input.recorded_by,
      note: input.note ?? null,
    };
    this.deliveryEvents.push(event);
    return event;
  }

  deliveryEventsForTransaction(transactionId: string): DeliveryEvent[] {
    return this.deliveryEvents.filter((e) => e.transaction_id === transactionId);
  }

  createDispute(input: CreateDisputeInput): Dispute {
    if (!this.transactions.has(input.transaction_id)) {
      throw new NotFoundError('Transaction', input.transaction_id);
    }
    const now = new Date();
    const dispute: Dispute = {
      id: newId(),
      transaction_id: input.transaction_id,
      reason: input.reason,
      evidence_file_ids: [...input.evidence_file_ids],
      status: 'OPEN',
      resolution: null,
      resolution_outcome: null,
      resolved_by: null,
      resolved_at: null,
      created_at: now,
      updated_at: now,
    };
    this.disputes.push(dispute);
    return dispute;
  }

  disputesForTransaction(transactionId: string): Dispute[] {
    return this.disputes.filter((d) => d.transaction_id === transactionId);
  }

  updateDispute(id: string, patch: Partial<Dispute>): Dispute {
    const dispute = this.disputes.find((d) => d.id === id);
    if (!dispute) throw new NotFoundError('Dispute', id);
    Object.assign(dispute, patch, { updated_at: new Date() });
    return dispute;
  }

  // -- Follow-up cases (OBS-1) ----------------------------------------------
  createFollowUpCase(input: CreateFollowUpCaseInput): FollowUpCase {
    if (!this.transactions.has(input.transaction_id)) {
      throw new NotFoundError('Transaction', input.transaction_id);
    }
    const now = new Date();
    const followUpCase: FollowUpCase = {
      id: newId(),
      transaction_id: input.transaction_id,
      type: input.type,
      status: 'OPEN',
      details: input.details,
      created_by: input.created_by,
      created_at: now,
      resolved_by: null,
      resolved_at: null,
      resolution: null,
    };
    this.followUpCases.push(followUpCase);
    return followUpCase;
  }

  followUpCasesForTransaction(transactionId: string): FollowUpCase[] {
    return this.followUpCases.filter(
      (c) => c.transaction_id === transactionId,
    );
  }

  findFollowUpCaseById(id: string): FollowUpCase | undefined {
    return this.followUpCases.find((c) => c.id === id);
  }

  updateFollowUpCase(
    id: string,
    patch: Partial<FollowUpCase>,
  ): FollowUpCase {
    const followUpCase = this.followUpCases.find((c) => c.id === id);
    if (!followUpCase) throw new NotFoundError('FollowUpCase', id);
    Object.assign(followUpCase, patch);
    return followUpCase;
  }

  createSettlementSummary(
    input: CreateSettlementSummaryInput,
  ): SettlementSummary {
    if (!this.transactions.has(input.transaction_id)) {
      throw new NotFoundError('Transaction', input.transaction_id);
    }
    const summary: SettlementSummary = {
      id: newId(),
      transaction_id: input.transaction_id,
      deposit_reference: input.deposit_reference,
      settlement_reference: input.settlement_reference,
      amount: input.amount,
      currency: input.currency,
      beneficiary_name: input.beneficiary_name,
      delivery_proof_or_dispute_outcome:
        input.delivery_proof_or_dispute_outcome,
      prepared_by: input.prepared_by,
      prepared_at: new Date(),
      institution_confirmation_at: null,
    };
    this.summaries.push(summary);
    return summary;
  }

  findSettlementSummaryById(id: string): SettlementSummary | undefined {
    return this.summaries.find((s) => s.id === id);
  }

  settlementSummariesForTransaction(
    transactionId: string,
  ): SettlementSummary[] {
    return this.summaries.filter((s) => s.transaction_id === transactionId);
  }

  updateSettlementSummary(
    id: string,
    patch: Partial<SettlementSummary>,
  ): SettlementSummary {
    const summary = this.summaries.find((s) => s.id === id);
    if (!summary) throw new NotFoundError('SettlementSummary', id);
    Object.assign(summary, patch);
    return summary;
  }

  // -- WhatsApp message log ---------------------------------------------------
  createMessageLog(input: CreateMessageLogInput): MessageLog {
    if (this.findMessageLogByWhatsappId(input.whatsapp_message_id)) {
      throw new DuplicateError(
        'DUPLICATE_MESSAGE_ID',
        `whatsapp_message_id already logged: ${input.whatsapp_message_id}`,
      );
    }
    const log: MessageLog = {
      id: newId(),
      whatsapp_message_id: input.whatsapp_message_id,
      transaction_id: input.transaction_id ?? null,
      direction: input.direction,
      template_name: input.template_name ?? null,
      template_local_approval: input.template_local_approval ?? null,
      template_meta_approval: input.template_meta_approval ?? null,
      template_rejection_reason: input.template_rejection_reason ?? null,
      status: input.status ?? 'QUEUED',
      is_dry_run: input.is_dry_run ?? false,
      sent_at: null,
      delivered_at: null,
      read_at: null,
    };
    this.messageLogs.push(log);
    return log;
  }

  updateMessageLog(id: string, patch: UpdateMessageLogInput): MessageLog {
    const log = this.messageLogs.find((m) => m.id === id);
    if (!log) throw new NotFoundError('MessageLog', id);
    Object.assign(log, patch);
    return log;
  }

  // -- Backup/restore snapshot (Sprint 3, PB-25) --------------------------
  exportSnapshot(): StoreSnapshot {
    const clone = <T>(rows: T[]): T[] =>
      rows.map((row) => JSON.parse(JSON.stringify(row)) as T);
    return {
      users: clone([...this.users.values()]),
      staffUsers: clone([...this.staffUsers.values()]),
      roles: clone([...this.roles.values()]),
      permissions: clone([...this.permissions.values()]),
      staffRoles: [...this.staffRoles],
      rolePermissions: [...this.rolePermissions],
      transactions: clone([...this.transactions.values()]),
      parties: clone(this.parties),
      contractVersions: clone(this.contractVersions),
      auditEvents: clone(this.auditEvents),
      evidences: clone(this.evidences),
      coordinations: clone(this.coordinations),
      deliveryEvents: clone(this.deliveryEvents),
      disputes: clone(this.disputes),
      followUpCases: clone(this.followUpCases),
      settlementSummaries: clone(this.summaries),
      messageLogs: clone(this.messageLogs),
    };
  }

  importSnapshot(snapshot: StoreSnapshot): void {
    if (this.transactions.size > 0 || this.auditEvents.length > 0) {
      throw new DomainError(
        'INVALID_INPUT',
        422,
        'Restore is fresh-store-only: refusing to merge a snapshot into a store that already holds transactions or audit events',
      );
    }
    const revive = <T>(rows: T[]): T[] =>
      rows.map((row) => JSON.parse(JSON.stringify(row)) as T);
    for (const user of revive(snapshot.users)) this.users.set(user.id, user);
    for (const staff of revive(snapshot.staffUsers)) {
      this.staffUsers.set(staff.id, staff);
    }
    for (const role of revive(snapshot.roles)) this.roles.set(role.id, role);
    for (const permission of revive(snapshot.permissions)) {
      this.permissions.set(permission.id, permission);
    }
    for (const key of snapshot.staffRoles) this.staffRoles.add(key);
    for (const key of snapshot.rolePermissions) {
      this.rolePermissions.add(key);
    }
    for (const tx of revive(snapshot.transactions)) {
      this.transactions.set(tx.id, tx);
    }
    this.parties.push(...revive(snapshot.parties));
    this.contractVersions.push(...revive(snapshot.contractVersions));
    this.auditEvents.push(...revive(snapshot.auditEvents));
    this.evidences.push(...revive(snapshot.evidences));
    this.coordinations.push(...revive(snapshot.coordinations));
    this.deliveryEvents.push(...revive(snapshot.deliveryEvents));
    this.disputes.push(...revive(snapshot.disputes));
    this.followUpCases.push(...revive(snapshot.followUpCases ?? []));
    this.summaries.push(...revive(snapshot.settlementSummaries));
    this.messageLogs.push(...revive(snapshot.messageLogs));
  }

  messageLogsForTransaction(transactionId: string): MessageLog[] {
    return this.messageLogs.filter((m) => m.transaction_id === transactionId);
  }

  findMessageLogByWhatsappId(
    whatsappMessageId: string,
  ): MessageLog | undefined {
    return this.messageLogs.find(
      (m) => m.whatsapp_message_id === whatsappMessageId,
    );
  }
}
