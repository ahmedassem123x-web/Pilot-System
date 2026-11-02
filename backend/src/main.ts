import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // rawBody is required for WhatsApp webhook HMAC verification: the
  // signature is computed over the RAW request bytes, never over a
  // re-serialised body (see whatsapp.service.ts).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Pilot System v3.1 backend (Sprint 3) listening on port ${port}`);
}

void bootstrap();
