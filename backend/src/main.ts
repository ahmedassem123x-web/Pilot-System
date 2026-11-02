import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // rawBody is required for WhatsApp webhook HMAC verification: the
  // signature is computed over the RAW request bytes, never over a
  // re-serialised body (see whatsapp.service.ts).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // The staff panel runs on a different origin (Render frontend URL) from
  // this API, so browsers would otherwise block every panel request.
  // Allowed origins come from CORS_ORIGINS (comma-separated) when set;
  // the default is the deployed panel plus local development origins.
  // This changes nothing about authentication: every guarded route
  // still requires a JWT, CORS only decides which origins may call it.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin:
      corsOrigins.length > 0
        ? corsOrigins
        : [
            'https://pilot-system-frontend.onrender.com',
            'http://localhost:5173',
            'http://localhost:4173',
          ],
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Pilot System v3.1 backend (Sprint 3) listening on port ${port}`);
}

void bootstrap();
