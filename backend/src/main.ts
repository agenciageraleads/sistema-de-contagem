// Ponto de entrada da aplicação
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefixo global /api para todas as rotas
  app.setGlobalPrefix('api');

  // Habilitar CORS para o frontend
  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? ['https://contagem.portaleletricos.com.br']
      : ['http://localhost:3000', 'http://10.100.1.72:3000'],
    credentials: true,
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
}
bootstrap();
