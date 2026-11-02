// Pilot System v3.1 — Sprint 2 (PB-06 to PB-10).
// Repository interface + entity shapes. These shapes mirror
// backend/prisma/schema.prisma field for field (amount is a plain number
// here; the Prisma implementation in Sprint 3 maps it to Decimal).
// The interface is the contract Sprint 3's Prisma implementation must
// satisfy WITHOUT changing any service or Guard logic.
//
// SCOPE RULES BAKED INTO THIS INTERFACE:
// - No wallet, balance, ledger, gateway, bank API, fee or commission
//   field exists anywhere below. Transaction.amount is DESCRIPTIVE ONLY.
// - Buyer/Seller lives ONLY on TransactionParty. User has no role field.
// - ContractVersion.accepted_by records ONLY the staff member who
//   recorded acceptance (see transition-matrix.md §8 resolution (b)).
//   Two-party proof lives in AuditEvent + MessageLog, never in
//   accepted_by alone.
// - Current contract version = highest version_number per transaction.
//   superseded_by is NEVER used to determine currency and is never
//   back-filled (see transition-matrix.md §8 resolution (a)).
// - AuditEvent and ContractVersion have NO working update/delete path:
//   the store methods for those operations always throw IMMUTABLE_ROW.

import type {
  DeliveryEventType,
  PartyRole,
  TransactionState,
  UserStatus,
} from '../common/transaction-state';

export interface User {
  id: string;
  whatsapp_number: string;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

export interface StaffUser {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
}

export interface Permission {
  id: string;
  name: string;
  description: string | null;
}

export interface Transaction {
  id: string;
  state: TransactionState;
  amount: number;
  currency: string;
  product_description: string;
  quantity: number;
  delivery_point: string;
  cancellation_terms: string;
  external_payment_reference: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TransactionParty {
  id: string;
  transaction_id: string;
  user_id: string;
  role: PartyRole;
}

export interface ContractVersion {
  id: string;
  transaction_id: string;
  version_number: number;
  content_hash: string;
  storage_file_id: string | null;
  accepted_at: Date | null;
  accepted_by: string | null;
  superseded_by: string | null;
  created_at: Date;
}

export interface PaymentEvidence {
  id: string;
  transaction_id: string;
  channel: string;
  sender_name: string;
  beneficiary_name_as_shown: string | null;
  amount: number;
  currency: string;
  external_payment_reference: string;
  receipt_file_id: string | null;
  submitted_at: Date;
  submitted_by: string;
  // Single value by design: evidence can NEVER read as funded/confirmed.
  status: 'PAYMENT_EVIDENCE_SUBMITTED';
}

export interface FinancialCoordinationRecord {
  id: string;
  transaction_id: string;
  staff_id: string;
  contact_method: string;
  message_sent: string | null;
  institution_response: string | null;
  deposit_reference: string | null;
  settlement_reference: string | null;
  institution_confirmed: boolean;
  recorded_at: Date;
}

export interface DeliveryEvent {
  id: string;
  transaction_id: string;
  event_type: DeliveryEventType;
  recorded_at: Date;
  recorded_by: string;
  note: string | null;
}

export interface Dispute {
  id: string;
  transaction_id: string;
  reason: string;
  evidence_file_ids: string[];
  status: 'OPEN' | 'RESOLVED';
  resolution: string | null;
  resolution_outcome: 'REFUND' | 'PROCEED' | 'CANCELLED' | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SettlementSummary {
  id: string;
  transaction_id: string;
  deposit_reference: string;
  settlement_reference: string;
  amount: number;
  currency: string;
  beneficiary_name: string;
  delivery_proof_or_dispute_outcome: string;
  prepared_by: string;
  prepared_at: Date;
  institution_confirmation_at: Date | null;
}

export interface AuditEvent {
  id: string;
  correlation_id: string;
  transaction_id: string | null;
  actor_id: string | null;
  actor_role: string;
  action: string;
  previous_state: TransactionState | null;
  new_state: TransactionState | null;
  timestamp: Date;
  details: Record<string, unknown> | null;
}

export interface MessageLog {
  id: string;
  whatsapp_message_id: string;
  transaction_id: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  template_name: string | null;
  template_local_approval: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  template_meta_approval: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  template_rejection_reason: string | null;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  is_dry_run: boolean;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
}

export interface CreateUserInput {
  whatsapp_number: string;
  status?: UserStatus;
}

export interface CreateTransactionInput {
  amount: number;
  currency: string;
  product_description: string;
  quantity: number;
  delivery_point: string;
  cancellation_terms: string;
}

export interface CreateContractVersionInput {
  transaction_id: string;
  version_number: number;
  content_hash: string;
  storage_file_id?: string | null;
  // Only settable at insert time, when the superseding version is
  // already known. Never back-filled. Ignored for currency.
  superseded_by?: string | null;
}

export interface CreateAuditEventInput {
  correlation_id: string;
  transaction_id: string | null;
  actor_id: string | null;
  actor_role: string;
  action: string;
  previous_state: TransactionState | null;
  new_state: TransactionState | null;
  details?: Record<string, unknown> | null;
}

export interface CreatePaymentEvidenceInput {
  transaction_id: string;
  channel: string;
  sender_name: string;
  beneficiary_name_as_shown?: string | null;
  amount: number;
  currency: string;
  external_payment_reference: string;
  receipt_file_id?: string | null;
  submitted_by: string;
}

export interface CreateCoordinationInput {
  transaction_id: string;
  staff_id: string;
  contact_method: string;
  message_sent?: string | null;
  institution_response?: string | null;
  deposit_reference?: string | null;
  settlement_reference?: string | null;
  institution_confirmed?: boolean;
}

export interface CreateDeliveryEventInput {
  transaction_id: string;
  event_type: DeliveryEventType;
  recorded_by: string;
  note?: string | null;
}

export interface CreateDisputeInput {
  transaction_id: string;
  reason: string;
  evidence_file_ids: string[];
}

export interface CreateSettlementSummaryInput {
  transaction_id: string;
  deposit_reference: string;
  settlement_reference: string;
  amount: number;
  currency: string;
  beneficiary_name: string;
  delivery_proof_or_dispute_outcome: string;
  prepared_by: string;
}

export interface CreateMessageLogInput {
  whatsapp_message_id: string;
  transaction_id?: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  template_name?: string | null;
  // Sprint 3: local vs Meta approval are stored SEPARATELY on the row,
  // mirroring the Prisma schema. A locally-approved but Meta-rejected
  // template is un-sendable; the rejection reason travels here.
  template_local_approval?: MessageLog['template_local_approval'];
  template_meta_approval?: MessageLog['template_meta_approval'];
  template_rejection_reason?: string | null;
  status?: MessageLog['status'];
  is_dry_run?: boolean;
}

export interface UpdateMessageLogInput {
  status?: MessageLog['status'];
  template_name?: string | null;
  template_local_approval?: MessageLog['template_local_approval'];
  template_meta_approval?: MessageLog['template_meta_approval'];
  template_rejection_reason?: string | null;
  sent_at?: Date | null;
  delivered_at?: Date | null;
  read_at?: Date | null;
}

/**
 * Sprint 3 snapshot shape for the backup/restore procedure
 * (docs/backup-restore-runbook.md). The snapshot is a plain-data copy
 * of every collection the Store owns; it is the unit-testable form of
 * "export, then restore into a fresh store". Production restore uses
 * database dumps (see the runbook) — this snapshot is NOT a claim
 * about live PostgreSQL behaviour, which remains UNVERIFIED here.
 */
export interface StoreSnapshot {
  users: User[];
  staffUsers: StaffUser[];
  roles: Role[];
  permissions: Permission[];
  staffRoles: string[];
  rolePermissions: string[];
  transactions: Transaction[];
  parties: TransactionParty[];
  contractVersions: ContractVersion[];
  auditEvents: AuditEvent[];
  evidences: PaymentEvidence[];
  coordinations: FinancialCoordinationRecord[];
  deliveryEvents: DeliveryEvent[];
  disputes: Dispute[];
  settlementSummaries: SettlementSummary[];
  messageLogs: MessageLog[];
}

/**
 * Store contract. Sprint 3 replaces the in-memory implementation with a
 * Prisma/PostgreSQL implementation of THIS interface. Service and Guard
 * code must not depend on anything outside this interface.
 */
export interface Store {
  // Users / identity (PB-06)
  createUser(input: CreateUserInput): User;
  findUserById(id: string): User | undefined;
  findUserByWhatsapp(whatsappNumber: string): User | undefined;
  updateUserStatus(id: string, status: UserStatus): User;
  countUsers(): number;

  // Staff / RBAC
  createStaffUser(
    input: Omit<StaffUser, 'id' | 'created_at' | 'updated_at'>,
  ): StaffUser;
  findStaffById(id: string): StaffUser | undefined;
  findStaffByEmail(email: string): StaffUser | undefined;
  createRole(name: string, description?: string | null): Role;
  findRoleByName(name: string): Role | undefined;
  createPermission(name: string, description?: string | null): Permission;
  findPermissionByName(name: string): Permission | undefined;
  assignRoleToStaff(staffUserId: string, roleId: string): void;
  assignPermissionToRole(roleId: string, permissionId: string): void;
  staffPermissions(staffUserId: string): string[];

  // Transactions / parties / contracts (PB-07)
  createTransaction(input: CreateTransactionInput): Transaction;
  findTransactionById(id: string): Transaction | undefined;
  updateTransactionState(id: string, state: TransactionState): Transaction;
  addParty(
    transactionId: string,
    userId: string,
    role: PartyRole,
  ): TransactionParty;
  partiesForTransaction(transactionId: string): TransactionParty[];
  createContractVersion(input: CreateContractVersionInput): ContractVersion;
  versionsForTransaction(transactionId: string): ContractVersion[];
  currentVersion(transactionId: string): ContractVersion | undefined;
  // Append-only enforcement: these ALWAYS throw IMMUTABLE_ROW.
  updateContractVersion(id: string, patch: Partial<ContractVersion>): never;
  deleteContractVersion(id: string): never;

  // Audit (PB-09) — append-only.
  createAuditEvent(input: CreateAuditEventInput): AuditEvent;
  auditForTransaction(transactionId: string): AuditEvent[];
  allAuditEvents(): AuditEvent[];
  updateAuditEvent(id: string, patch: Partial<AuditEvent>): never;
  deleteAuditEvent(id: string): never;

  // Evidence / coordination / delivery / disputes / settlement
  createPaymentEvidence(input: CreatePaymentEvidenceInput): PaymentEvidence;
  evidencesForTransaction(transactionId: string): PaymentEvidence[];
  createCoordinationRecord(
    input: CreateCoordinationInput,
  ): FinancialCoordinationRecord;
  coordinationsForTransaction(
    transactionId: string,
  ): FinancialCoordinationRecord[];
  findCoordinationByDepositReference(
    depositReference: string,
  ): FinancialCoordinationRecord | undefined;
  updateCoordinationRecord(
    id: string,
    patch: Partial<FinancialCoordinationRecord>,
  ): FinancialCoordinationRecord;
  createDeliveryEvent(input: CreateDeliveryEventInput): DeliveryEvent;
  deliveryEventsForTransaction(transactionId: string): DeliveryEvent[];
  createDispute(input: CreateDisputeInput): Dispute;
  disputesForTransaction(transactionId: string): Dispute[];
  updateDispute(id: string, patch: Partial<Dispute>): Dispute;
  createSettlementSummary(
    input: CreateSettlementSummaryInput,
  ): SettlementSummary;
  findSettlementSummaryById(id: string): SettlementSummary | undefined;
  settlementSummariesForTransaction(
    transactionId: string,
  ): SettlementSummary[];
  updateSettlementSummary(
    id: string,
    patch: Partial<SettlementSummary>,
  ): SettlementSummary;

  // WhatsApp message log (evidence for acceptance; idempotency key)
  createMessageLog(input: CreateMessageLogInput): MessageLog;
  messageLogsForTransaction(transactionId: string): MessageLog[];
  findMessageLogByWhatsappId(whatsappMessageId: string): MessageLog | undefined;
  // Sprint 3: status/template updates on a MessageLog row. Status
  // monotonicity (never downgrade except to FAILED) is enforced by the
  // WhatsApp service, NOT by this method — the store applies the patch
  // it is given. MessageLog rows are NOT append-only audit rows.
  updateMessageLog(id: string, patch: UpdateMessageLogInput): MessageLog;

  // Sprint 3: backup/restore snapshot (see StoreSnapshot above).
  // importSnapshot is fresh-store-only: it refuses when the store
  // already holds transactions or audit events, so a restore can never
  // silently merge into live data.
  exportSnapshot(): StoreSnapshot;
  importSnapshot(snapshot: StoreSnapshot): void;
}
