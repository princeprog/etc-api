import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { join } from 'path';

export function configureApp(app: INestApplication | NestExpressApplication) {
  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.use(cookieParser());

  const expressApp = app as NestExpressApplication;
  expressApp.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });
}
