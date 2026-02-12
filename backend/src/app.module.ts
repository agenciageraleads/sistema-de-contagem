// Módulo principal da aplicação - Registra todos os módulos
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ContagemModule } from './contagem/contagem.module';
import { SankhyaModule } from './sankhya/sankhya.module';
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

    // Módulos do sistema
    PrismaModule,
    AuthModule,
    ContagemModule,
    SankhyaModule,
  ],
  providers: [ScheduleService],
})
export class AppModule { }
