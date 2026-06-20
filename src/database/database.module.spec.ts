import { Test } from '@nestjs/testing';
import { DATABASE } from './database.constants';
import { DatabaseModule } from './database.module';

const destroy = jest.fn();
const selectFrom = jest.fn();

jest.mock('kysely', () => {
  class MockKysely {
    destroy = destroy;
    selectFrom = selectFrom;
  }

  class MockPostgresDialect {
    constructor(public readonly config: unknown) {}
  }

  return {
    Kysely: MockKysely,
    PostgresDialect: MockPostgresDialect,
  };
});

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({})),
}));

describe('DatabaseModule', () => {
  beforeEach(() => {
    destroy.mockReset();
    selectFrom.mockReset();
  });

  it('provides the DATABASE injection token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    const db = moduleRef.get(DATABASE);

    expect(db).toBeDefined();
    expect(typeof db.destroy).toBe('function');
    expect(typeof db.selectFrom).toBe('function');

    await moduleRef.close();

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
