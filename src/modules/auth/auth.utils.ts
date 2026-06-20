import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

import type { RoleName } from '../../database/schema';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [salt, storedHash] = passwordHash.split(':');

  if (!salt || !storedHash) {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const storedBuffer = Buffer.from(storedHash, 'hex');

  if (derivedKey.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, storedBuffer);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateTokenId(): string {
  return randomUUID();
}

export function parseRole(value: string): RoleName {
  if (value === 'admin' || value === 'staff') {
    return value;
  }

  throw new Error(`Unsupported role value: ${value}`);
}

export function durationToMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/i.exec(value.trim());

  if (!match) {
    throw new Error(`Unsupported duration format: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60_000;
    case 'h':
      return amount * 3_600_000;
    case 'd':
      return amount * 86_400_000;
    default:
      throw new Error(`Unsupported duration unit: ${unit}`);
  }
}
