const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/src/app.module');
const { configureApp } = require('../dist/src/bootstrap');

let server;

async function getServer() {
  if (!server) {
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log'],
    });
    configureApp(app);
    await app.init();
    server = app.getHttpAdapter().getInstance();
  }

  return server;
}

module.exports = async function handler(request, response) {
  const expressServer = await getServer();
  return expressServer(request, response);
};
