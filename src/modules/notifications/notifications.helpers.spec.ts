import { resolveFollowUpNotificationType } from './notifications.helpers';

describe('notifications helpers', () => {
  const originalTimeZone = process.env.APP_TIMEZONE;

  beforeEach(() => {
    process.env.APP_TIMEZONE = 'UTC';
  });

  afterEach(() => {
    process.env.APP_TIMEZONE = originalTimeZone;
  });

  it('resolves overdue follow-ups', () => {
    expect(
      resolveFollowUpNotificationType(
        new Date('2026-07-20T08:59:00.000Z'),
        new Date('2026-07-20T09:00:00.000Z'),
        '2026-07-20',
      ),
    ).toBe('follow_up_overdue');
  });

  it('resolves follow-ups due later today', () => {
    expect(
      resolveFollowUpNotificationType(
        new Date('2026-07-20T10:00:00.000Z'),
        new Date('2026-07-20T09:00:00.000Z'),
        '2026-07-20',
      ),
    ).toBe('follow_up_due_today');
  });

  it('resolves follow-ups due within the next seven days', () => {
    expect(
      resolveFollowUpNotificationType(
        new Date('2026-07-25T09:00:00.000Z'),
        new Date('2026-07-20T09:00:00.000Z'),
        '2026-07-20',
      ),
    ).toBe('follow_up_due_soon');
  });

  it('skips follow-ups outside the reminder window', () => {
    expect(
      resolveFollowUpNotificationType(
        new Date('2026-07-28T09:00:00.000Z'),
        new Date('2026-07-20T09:00:00.000Z'),
        '2026-07-20',
      ),
    ).toBeNull();
  });
});
