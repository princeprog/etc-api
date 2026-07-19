import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

let server: ReturnType<NestExpressApplication['getHttpAdapter']> extends {
  getInstance(): infer T;
}
  ? T
  : unknown;

async function getServer() {
  if (!server) {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn', 'log'],
    });
    configureApp(app);
    await app.init();
    server = app.getHttpAdapter().getInstance();
  }

  return server as (request: Request, response: Response) => void;
}

export default async function handler(request: Request, response: Response) {
  const expressServer = await getServer();
  return expressServer(request, response);
}
