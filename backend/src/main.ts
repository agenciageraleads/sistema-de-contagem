// Ponto de entrada da aplicação
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();

  // Necessário para obter IP real atrás de proxy (Traefik/Nginx)
  expressApp.set('trust proxy', 1);

  // Prefixo global /api para todas as rotas
  app.setGlobalPrefix('api');

  // Headers de segurança HTTP
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  // Habilitar CORS para o frontend
  const originsRaw =
    process.env.FRONTEND_ALLOWED_ORIGINS ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.FRONTEND_URL ||
    '';
  const allowedOrigins = originsRaw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin:
      allowedOrigins.length > 0
        ? allowedOrigins
        : [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:3030',
            'http://127.0.0.1:3030',
          ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Validação global dos DTOs (class-validator)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Remove campos não declarados no DTO
      forbidNonWhitelisted: true, // Retorna erro se enviar campo extra
      transform: true, // Transforma tipos automaticamente
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Backend rodando em http://localhost:${port}/api`);
  console.log(`📦 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔒 Origens CORS: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : 'localhost-only fallback'}`);
}
bootstrap();
