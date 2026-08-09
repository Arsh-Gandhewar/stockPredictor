import { config } from 'dotenv';
import { resolve } from 'path';

// Load root .env file reliably in NestJS
config({ path: resolve(process.cwd(), '../../.env') });
config({ path: resolve(__dirname, '../../../.env') });
config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`🚀 NestJS Backend listening on http://127.0.0.1:${port}`);
}
bootstrap();
