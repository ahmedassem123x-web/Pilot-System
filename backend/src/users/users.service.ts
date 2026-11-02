// Pilot System v3.1 — Sprint 2 (PB-06). Identity: one permanent UUID
// per person, one whatsapp_number for communication, status
// APPROVED / NOT_APPROVED / SUSPENDED. Buyer/Seller is NOT a user
// attribute: it lives only on TransactionParty (see transactions
// service). The same person as buyer in one transaction and seller in
// another creates NO second User row — callers reuse the same id.
import { Injectable } from '@nestjs/common';
import type { Store, User } from '../store/repository';
import type { UserStatus } from '../common/transaction-state';
import { NotFoundError } from '../common/errors';

@Injectable()
export class UsersService {
  constructor(private readonly store: Store) {}

  createPerson(whatsappNumber: string, status?: UserStatus): User {
    return this.store.createUser({ whatsapp_number: whatsappNumber, status });
  }

  findById(id: string): User {
    const user = this.store.findUserById(id);
    if (!user) throw new NotFoundError('User', id);
    return user;
  }

  findByWhatsapp(whatsappNumber: string): User | undefined {
    return this.store.findUserByWhatsapp(whatsappNumber);
  }

  approve(id: string): User {
    return this.store.updateUserStatus(id, 'APPROVED');
  }

  suspend(id: string): User {
    return this.store.updateUserStatus(id, 'SUSPENDED');
  }

  markNotApproved(id: string): User {
    return this.store.updateUserStatus(id, 'NOT_APPROVED');
  }
}
