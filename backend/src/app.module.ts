// Módulo principal da aplicação - Registra todos os módulos
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ContagemModule } from './contagem/contagem.module';
import { SankhyaModule } from './sankhya/sankhya.module';
import { SeparacaoModule } from './separacao/separacao.module';
import { EntregasModule } from './entregas/entregas.module';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { ScheduleService } from './schedule/schedule.service';

@Module({
  imports: [
    // Configuração global de variáveis de ambiente
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Agendamento de tarefas (jobs noturnos)
    ScheduleModule.forRoot(),

    // Proteção básica contra brute-force/flood
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL_MS || 60000),
        limit: Number(process.env.THROTTLE_LIMIT || 120),
      },
    ]),

    // Módulos do sistema
    PrismaModule,
    AuthModule,
    ContagemModule,
    SankhyaModule,
    SeparacaoModule,
    EntregasModule,
    DiagnosticsModule,
  ],
  providers: [
    ScheduleService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
