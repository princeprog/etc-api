import {
  durationToMs,
  hashPassword,
  parseRole,
  verifyPassword,
} from './auth.utils';

describe('auth utils', () => {
  it('hashes and verifies passwords', async () => {
    const passwordHash = await hashPassword('Password123!');

    await expect(verifyPassword('Password123!', passwordHash)).resolves.toBe(
      true,
    );
    await expect(verifyPassword('wrong-password', passwordHash)).resolves.toBe(
      false,
    );
  });

  it('parses supported duration values', () => {
    expect(durationToMs('15m')).toBe(900000);
    expect(durationToMs('30d')).toBe(2592000000);
  });

  it('parses supported roles', () => {
    expect(parseRole('admin')).toBe('admin');
    expect(parseRole('staff')).toBe('staff');
    expect(() => parseRole('guest')).toThrow('Unsupported role value: guest');
  });
});
