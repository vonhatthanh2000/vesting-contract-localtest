import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertLocalRpc, config } from './config';
import { configureApp } from './setup-app';

async function bootstrap() {
  assertLocalRpc(config.rpcUrl);
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(config.port);
}
bootstrap().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
