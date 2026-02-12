// Controller para integração Sankhya
import { Controller, Post, Get, UseGuards, Logger, Param } from '@nestjs/common';
import { SankhyaService } from './sankhya.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('sankhya')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SankhyaController {
    private readonly logger = new Logger(SankhyaController.name);

    constructor(private sankhyaService: SankhyaService) { }

    @Post('sync')
    @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
    async syncNow() {
        this.logger.log('Sincronização manual disparada pelo supervisor');
        return this.sankhyaService.syncAllSnapshots();
    }

    @Post('sync-adjustments')
    @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
    async syncAdjustments() {
        this.logger.log('Sincronização de ajustes (notas) disparada manualmente');
        return this.sankhyaService.syncPendingAdjustments();
    }

    @Post('test')
    @Roles(UserRole.ADMIN)
    async testConnection() {
        return this.sankhyaService.testConnection();
    }

    @Post('repopulate-fila')
    @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
    async repopulateFila() {
        try {
            this.logger.log('Repopulação de fila disparada manualmente');
            return await this.sankhyaService.repopulateFila();
        } catch (error: any) {
            this.logger.error(`Erro na repopulação: ${error.message}`);
            return {
                success: false,
                message: 'Erro interno ao repopular fila',
                error: error.message
            };
        }
    }

    @Get('diagnose')
    async diagnose() {
        return this.sankhyaService.diagnose();
    }

    @Post('reset-cycle')
    @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
    async resetCycle() {
        try {
            this.logger.log('Reset de ciclo disparado manualmente');
            return await this.sankhyaService.resetCycle();
        } catch (error: any) {
            this.logger.error(`Erro no reset: ${error.message}`);
            return {
                success: false,
                message: 'Erro ao resetar ciclo',
                error: error.message
            };
        }
    }

    @Get('last-sync')
    @Roles(UserRole.SUPERVISOR, UserRole.ADMIN, UserRole.OPERADOR)
    async getLastSync() {
        return this.sankhyaService.getLastSyncLog();
    }

    @Post('inspect/:table')
    @Roles(UserRole.ADMIN)
    async inspect(@Param('table') table: string) {
        return this.sankhyaService.inspectTable(table);
    }
}
