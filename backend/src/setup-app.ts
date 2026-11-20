import { INestApplication, ValidationPipe } from '@nestjs/common';
import { config } from './config';
import { badRequest } from './vesting/errors';

/** Shared by main.ts and the e2e spec so both run the same pipes and CORS. */
export function configureApp(app: INestApplication): void {
  app.enableCors({ origin: config.corsOrigin });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (errs) =>
        badRequest(errs.flatMap((e) => Object.values(e.constraints ?? {})).join('; ') || 'Invalid request'),
    }),
  );
}
