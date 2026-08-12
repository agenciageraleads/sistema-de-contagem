// Controller de Contagem - Endpoints para Operadores
import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Param,
  ParseIntPipe,
  Logger,
  Query,
} from '@nestjs/common';
import { ContagemService } from './contagem.service';
import { RegistrarContagemDto } from './dto/registrar-contagem.dto';
import { ReportarProblemaDto } from './dto/reportar-problema.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('contagem')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContagemController {
  private readonly logger = new Logger(ContagemController.name);

  constructor(private readonly contagemService: ContagemService) {}

  // GET /api/contagem/proximo - Busca próximo item da fila
  @Get('proximo')
  @Roles(UserRole.OPERADOR, UserRole.SUPERVISOR)
  async buscaProximo(@CurrentUser('id') userId: number) {
    this.logger.log(`🔍 Controller: buscaProximo para User ${userId}`);
    return this.contagemService.buscaProximo(userId);
  }

  // GET /api/contagem/direcionada/minha-fila - Lista contagens direcionadas para o operador
  @Get('direcionada/minha-fila')
  @Roles(UserRole.OPERADOR, UserRole.SUPERVISOR)
  async getMinhaFilaDirecionada(@CurrentUser('id') userId: number) {
    return this.contagemService.getMinhaFilaDirecionada(userId);
  }

  // POST /api/contagem/direcionada/:id/selecionar - Puxa um item direcionado específico
  @Post('direcionada/:id/selecionar')
  @Roles(UserRole.OPERADOR, UserRole.SUPERVISOR)
  async selecionarItemDirecionado(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) filaId: number,
  ) {
    return this.contagemService.selecionarItemDirecionado(userId, filaId);
  }

  // GET /api/contagem/stats - Estatísticas do dia
  @Get('stats')
  @Roles(UserRole.OPERADOR, UserRole.SUPERVISOR)
  async getStats(@CurrentUser('id') userId: number) {
    return this.contagemService.getStats(userId);
  }

  // POST /api/contagem/registrar - Registra uma contagem concluída
  @Post('registrar')
  @Roles(UserRole.OPERADOR, UserRole.SUPERVISOR)
  async registrar(
    @CurrentUser('id') userId: number,
    @Body() dto: RegistrarContagemDto,
  ) {
    return this.contagemService.registrar(userId, dto);
  }

  // POST /api/contagem/nao-achei/:id - Marca item como não encontrado
  @Post('nao-achei/:id')
  @Roles(UserRole.OPERADOR, UserRole.SUPERVISOR)
  async naoAchei(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) filaId: number,
  ) {
    return this.contagemService.naoAchei(userId, filaId);
  }

  // POST /api/contagem/reportar-problema/:id - Reporta erro no Item
  @Post('reportar-problema/:id')
  @Roles(UserRole.OPERADOR, UserRole.SUPERVISOR)
  async reportarProblema(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) filaId: number,
    @Body('motivo') motivo: string,
  ) {
    return this.contagemService.reportarProblema(
      filaId,
      userId,
      motivo || 'Problema não especificado',
    );
  }

  // GET /api/contagem/reportados - Lista itens reportados (Supervisor)
  @Get('reportados')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async getReportados() {
    return this.contagemService.getItensReportados();
  }

  // GET /api/contagem/divergencias - Lista divergências (Supervisor)
  @Get('divergencias')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async getDivergencias() {
    return this.contagemService.getDivergencias();
  }

  // POST /api/contagem/divergencias/:id/tratar - Toma decisão sobre divergência
  @Post('divergencias/:id/tratar')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async tratarDivergencia(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      acao: 'APROVAR' | 'RECONTAR' | 'FINALIZAR_ANALISE';
      observacao?: string;
      operadorId?: number | null;
    },
  ) {
    return this.contagemService.tratarDivergencia(
      id,
      body.acao,
      body.observacao,
      body.operadorId,
    );
  }

  // POST /api/contagem/divergencias/:id/sincronizar-ressalva - Efetiva a segregação pendente no Sankhya
  @Post('divergencias/:id/sincronizar-ressalva')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async sincronizarRessalva(@Param('id', ParseIntPipe) id: number) {
    return this.contagemService.sincronizarRessalvaDivergencia(id);
  }

  // GET /api/contagem/operadores - Lista operadores para direcionar recontagem
  @Get('operadores')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async getOperadores() {
    return this.contagemService.getOperadores();
  }

  // GET /api/contagem/direcionada/copia-sankhya - Importa recorte da cópia de estoque Sankhya
  @Get('direcionada/copia-sankhya')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async buscarCopiaEstoqueSankhya(
    @Query('data') data?: string,
    @Query('codemp') codemp?: string,
    @Query('codlocal') codlocal?: string,
    @Query('sequencia') sequencia?: string,
    @Query('busca') busca?: string,
  ) {
    return this.contagemService.buscarCopiaEstoqueSankhya({
      data,
      codemp,
      codlocal,
      sequencia,
      busca,
    });
  }

  // POST /api/contagem/direcionada/direcionar - Direciona itens da cópia para um operador
  @Post('direcionada/direcionar')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async direcionarContagem(
    @CurrentUser('id') supervisorId: number,
    @Body()
    body: {
      operadorId: number;
      prioridade?: number;
      motivo?: string;
      itens: Array<{
        codprod: number;
        codemp?: number;
        codlocal?: number;
        descprod?: string;
        marca?: string | null;
        controle?: string | null;
        codigoBarrasCadastro?: string | null;
        codvol?: string | null;
        qtdCopiada?: number;
        dataCopia?: string | null;
      }>;
    },
  ) {
    return this.contagemService.direcionarContagem(body, supervisorId);
  }

  // GET /api/contagem/supervisor/stats - Estatísticas de gestão
  @Get('supervisor/stats')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async getSupervisorStats() {
    return this.contagemService.getSupervisorStats();
  }

  // GET /api/contagem/metas - Lista metas (Supervisor/Admin)
  @Get('metas')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async getMetas() {
    return this.contagemService.getMetas();
  }

  // POST /api/contagem/meta-global - Atualiza meta global
  @Post('meta-global')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async updateMetaGlobal(@Body('valor') valor: number) {
    return this.contagemService.updateMetaGlobal(valor);
  }

  // GET /api/contagem/fila - Lista a fila de contagem atual (Supervisor)
  @Get('fila')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async getFila() {
    return this.contagemService.getFila();
  }

  // ============================================
  // Exportação de Dados (Supervisor/Admin)
  // ============================================

  @Get('export/divergencias')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async exportDivergencias() {
    return this.contagemService.getDivergenciasExport();
  }

  @Get('export/produtividade')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  async exportProdutividade() {
    return this.contagemService.getProdutividadeExport();
  }
}
