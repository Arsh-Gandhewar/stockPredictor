import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

import { config } from 'dotenv';
import { resolve } from 'path';

// Load root .env file reliably in NestJS
config({ path: resolve(process.cwd(), '../../.env') });
config({ path: resolve(__dirname, '../../../.env') });
config();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Apply Security Headers with Clerk/Next.js compatible CSP
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://*.clerk.accounts.dev',
            'https://challenges.cloudflare.com',
          ],
          connectSrc: [
            "'self'",
            'https://*.clerk.accounts.dev',
            'https://api.clerk.com',
          ],
          imgSrc: [
            "'self'",
            'data:',
            'https://img.clerk.com',
            'https://images.unsplash.com',
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Enable Strict CORS
  const configuredOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  if (process.env.FRONTEND_URL) {
    configuredOrigins.push(process.env.FRONTEND_URL);
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      if (
        configuredOrigins.includes(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
        /\.vercel\.app$/.test(new URL(origin).hostname)
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global DTO Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Global Structured Logging & Exception Filters
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(
    `🚀 QuantX Production API Gateway listening on 0.0.0.0:${port}`,
  );
}
bootstrap();
