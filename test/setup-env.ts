import { resolve } from 'node:path';
import { config } from 'dotenv';

process.env.DOTENV_CONFIG_QUIET ??= 'true';

config({ path: resolve(__dirname, '../.env'), quiet: true });
config({ path: resolve(__dirname, '../.env.test'), override: true, quiet: true });
