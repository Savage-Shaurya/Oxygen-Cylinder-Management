import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Role, User } from '../shared/types.ts';

export interface StoredUser extends User {
  passwordHash: string;
  /** Credential/authorization version this user object was loaded with. Server-only. */
  authEpoch?: number;
}
export function hashPassword(password: string): string {
  if (password.length < 12 || password.length > 256 || !/[\p{L}\p{N}\p{S}\p{P}]/u.test(password))
    throw new Error('Password must be 12–256 characters and contain a non-space character');
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(password, Buffer.from(salt, 'hex'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}
export function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function isRole(value: unknown): value is Role {
  return ['admin', 'operations', 'quality', 'finance', 'driver', 'auditor'].includes(String(value));
}
export function safeUser(user: StoredUser): User {
  const { passwordHash: _secret, authEpoch: _epoch, ...safe } = user;
  return safe;
}
