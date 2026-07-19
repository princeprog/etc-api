import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { join } from 'path';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://etc-cars.vercel.app',
];

export function configureApp(app: INestApplication | NestExpressApplication) {
  app.enableCors({
    origin: resolveCorsOrigin,
    credentials: true,
  });

  app.use(cookieParser());

  const expressApp = app as NestExpressApplication;
  expressApp.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });
}

function resolveCorsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) {
  if (!origin) {
    callback(null, true);
    return;
  }

  const allowedOrigins = getAllowedOrigins();

  if (allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`Origin ${origin} is not allowed by CORS`));
}

function getAllowedOrigins() {
  const configuredOrigins = process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configuredOrigins?.length
    ? configuredOrigins
    : DEFAULT_ALLOWED_ORIGINS;
}
