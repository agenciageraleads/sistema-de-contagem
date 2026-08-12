// Serviço de Agendamento (Cron Jobs)
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SankhyaService } from '../sankhya/sankhya.service';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(private sankhyaService: SankhyaService) {}

  private isLocalValidation() {
    return process.env.INVENTARIO_LOCAL_VALIDATION === 'true';
  }

  // Roda todo dia às 3 da manhã
  @Cron('0 0 3 * * *')
  async handleNightlySnapshot() {
    if (this.isLocalValidation()) {
      this.logger.warn(
        'Snapshot noturno ignorado: INVENTARIO_LOCAL_VALIDATION=true',
      );
      return;
    }

    this.logger.log('--- Executando Snapshot Noturno Automático (03:00) ---');
    try {
      await this.sankhyaService.syncAllSnapshots();
      this.logger.log('--- Snapshot Noturno concluído com sucesso ---');
    } catch (e) {
      this.logger.error('Erro ao gerar snapshot noturno', e.stack);
    }
  }

  // Rotina de debug: Roda a cada 1 hora para teste (opcional)
  @Cron(CronExpression.EVERY_HOUR)
  async hourlyLog() {
    this.logger.debug(
      'Fila de contagem saudável. Aguardando sincronização noturna.',
    );
  }

  // Processa fila de ajustes pendentes a cada 30 minutos
  @Cron('0 */30 * * * *')
  async processAdjustments() {
    if (this.isLocalValidation()) {
      this.logger.debug(
        'Sincronização de ajustes ignorada no modo de validação local.',
      );
      return;
    }

    try {
      await this.sankhyaService.syncPendingAdjustments();
    } catch (e) {
      this.logger.error('Erro ao processar ajustes pendentes', e.stack);
    }
  }
}
