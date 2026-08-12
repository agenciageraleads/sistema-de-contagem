// Serviço de Contagem - Lógica de Fila, Registro e Inteligência de Divergência
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SankhyaClient } from '../sankhya/sankhya.client';
import { SankhyaService } from '../sankhya/sankhya.service';
import { RegistrarContagemDto } from './dto/registrar-contagem.dto';
import {
  AjusteTipo,
  FilaStatus,
  ContagemTipo,
  StatusAnalise,
  DivergenciaStatus,
  Decisao,
  UserRole,
  FilaContagem,
} from '@prisma/client';
import {
  avaliarPrimeiraContagemInventario,
  avaliarSegundaContagemInventario,
  criarOperacaoFinalizacao,
  criarOperacoesFinalizacaoRessalva,
  finalizarTerceiraContagemInventario,
  INVENTARIO_LOCAIS,
  INVENTARIO_TOPS,
  OperacaoRessalvaInventario,
} from './inventario-flow';

const PRIORIDADE_AUDITORIA_RECONTAGEM = 9999;
const PRIORIDADE_CONTAGEM_DIRECIONADA = 9000;

type BuscarCopiaEstoqueParams = {
  data?: string;
  codemp?: string | number;
  codlocal?: string | number;
  sequencia?: string | number;
  busca?: string;
};

type CopiaEstoqueItem = {
  codprod: number;
  descprod: string;
  codemp: number;
  codlocal: number;
  descrlocal: string | null;
  controle: string | null;
  codvol: string | null;
  codigoBarrasCadastro?: string | null;
  qtdCopiada: number;
  dataCopia: string | null;
  statusFila?: FilaStatus | null;
  priorizadoPor?: number | null;
};

type DirecionarContagemBody = {
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
};

type BaseContagemOperacional = {
  origem: 'SNAPSHOT_LOCAL' | 'SANKHYA_LIVE';
  saldoBase: number;
  reservadoAtual: number;
  dataRef?: Date | null;
  snapshotDesatualizado: boolean;
};

@Injectable()
export class ContagemService {
  private readonly logger = new Logger(ContagemService.name);
  private static readonly RANDOM_POOL_SIZE = 30;
  private static readonly RECENT_HISTORY_WINDOW = 15;
  private static readonly OPERATOR_COOLDOWN_SIZE = 3;
  private static readonly STRATEGY_ENV = 'CONTAGEM_QUEUE_STRATEGY';

  constructor(
    private prisma: PrismaService,
    private sankhyaClient: SankhyaClient,
    private sankhyaService: SankhyaService,
  ) {}

  // Busca o próximo item disponível na fila e aplica um lock (trava)
  async buscaProximo(userId: number) {
    const strategy = (
      process.env[ContagemService.STRATEGY_ENV] || 'weighted'
    ).toLowerCase();

    if (strategy === 'legacy') {
      this.logger.warn(
        `[Fila] Estratégia LEGACY ativa (${ContagemService.STRATEGY_ENV}=legacy).`,
      );
      return this.enriquecerItemFilaComCodigoBarras(
        await this.buscaProximoLegacy(userId),
      );
    }

    try {
      return this.enriquecerItemFilaComCodigoBarras(
        await this.buscaProximoWeighted(userId),
      );
    } catch (error: any) {
      this.logger.error(
        `[Fila] Falha na estratégia weighted. Fallback automático para legacy: ${error.message}`,
      );
      return this.enriquecerItemFilaComCodigoBarras(
        await this.buscaProximoLegacy(userId),
      );
    }
  }

  async getMinhaFilaDirecionada(userId: number) {
    const itens = await this.prisma.filaContagem.findMany({
      where: {
        priorizadoPor: userId,
        status: { in: [FilaStatus.PENDENTE, FilaStatus.EM_CONTAGEM] },
        OR: [{ lockedBy: null }, { lockedBy: userId }],
      },
      orderBy: [
        { prioridadeManual: 'desc' },
        { updatedAt: 'asc' },
        { descprod: 'asc' },
      ],
      take: 100,
      include: {
        priorizador: { select: { id: true, nome: true, login: true } },
      },
    });

    return Promise.all(
      itens.map((item) => this.enriquecerItemFilaComCodigoBarras(item)),
    );
  }

  async selecionarItemDirecionado(userId: number, filaId: number) {
    const item = await this.prisma.filaContagem.findUnique({
      where: { id: filaId },
    });

    if (!item || item.priorizadoPor !== userId) {
      throw new BadRequestException(
        'Item não está direcionado para este operador.',
      );
    }

    if (
      item.status !== FilaStatus.PENDENTE &&
      !(item.status === FilaStatus.EM_CONTAGEM && item.lockedBy === userId)
    ) {
      throw new BadRequestException(
        'Item não está disponível para contagem neste momento.',
      );
    }

    const itemTravado = await this.prisma.filaContagem.findFirst({
      where: {
        lockedBy: userId,
        status: FilaStatus.EM_CONTAGEM,
      },
    });

    if (itemTravado && itemTravado.id !== item.id) {
      await this.prisma.filaContagem.update({
        where: { id: itemTravado.id },
        data: {
          status: FilaStatus.PENDENTE,
          lockedBy: null,
          lockedAt: null,
        },
      });
    }

    const selecionado = await this.prisma.filaContagem.update({
      where: { id: item.id },
      data: {
        status: FilaStatus.EM_CONTAGEM,
        lockedBy: userId,
        lockedAt: new Date(),
      },
    });

    return this.enriquecerItemFilaComCodigoBarras(selecionado);
  }

  private async buscaProximoLegacy(userId: number) {
    // 1. Verificar se o usuário JÁ tem algo travado (se não finalizou o anterior)
    const lockedItem = await this.prisma.filaContagem.findFirst({
      where: {
        lockedBy: userId,
        status: FilaStatus.EM_CONTAGEM,
      },
    });

    const itemPrioritario = await this.buscarItemPrioritarioManual(userId);
    if (
      itemPrioritario &&
      (!lockedItem ||
        Number(itemPrioritario.prioridadeManual || 0) >
          Number(lockedItem.prioridadeManual || 0))
    ) {
      return this.assumirItemPrioritario(userId, itemPrioritario, lockedItem);
    }

    if (lockedItem) return lockedItem;

    const itemIndicado = await this.prisma.filaContagem.findFirst({
      where: {
        status: FilaStatus.PENDENTE,
        lockedBy: null,
        priorizadoPor: userId,
      },
      orderBy: [{ prioridadeManual: 'desc' }, { updatedAt: 'asc' }],
    });

    if (itemIndicado) {
      return this.prisma.filaContagem.update({
        where: { id: itemIndicado.id },
        data: {
          status: FilaStatus.EM_CONTAGEM,
          lockedBy: userId,
          lockedAt: new Date(),
        },
      });
    }

    // 2. Mapear POSSE (Quem é dono de qual Agrupador no momento?)
    const timeframe = new Date();
    timeframe.setMinutes(timeframe.getMinutes() - 15);

    // A) Locks Ativos
    const locksAtivos = await this.prisma.filaContagem.findMany({
      where: {
        status: FilaStatus.EM_CONTAGEM,
        lockedBy: { not: null },
      },
      select: { marca: true, controle: true, lockedBy: true },
    });

    // B) Histórico Recente
    const historicoRecente = await this.prisma.contagem.findMany({
      where: {
        createdAt: { gte: timeframe },
      },
      select: {
        userId: true,
        fila: {
          select: { marca: true, controle: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Mapa: Agrupador -> UserId
    // Agrupador = Se marca=='CONTROLE' ? controle : marca
    const posseAgrupador = new Map<string, number>();

    const logDebug = (msg: string) => {
      console.log('DEBUG_CUSTOM:', msg);
    };

    const getAgrupador = (m: string | null, c: string | null) => {
      if (!m) return null;
      // Se a marca for 'CONTROLE', o valor real da marca está no controle (Ex: INPOL)
      // Agrupamos tudo sob 'INPOL' para juntar com itens que tenham marca 'INPOL' nativa
      if (m === 'CONTROLE' && c) return c;
      return m;
    };

    const processItem = (
      userId: number,
      marca: string | null,
      controle: string | null,
    ) => {
      const key = getAgrupador(marca, controle);
      if (key) posseAgrupador.set(key, userId);
    };

    historicoRecente.forEach((item) => {
      processItem(
        item.userId,
        item.fila?.marca || null,
        item.fila?.controle || null,
      );
    });

    locksAtivos.forEach((item) => {
      processItem(item.lockedBy!, item.marca, item.controle);
    });

    // Separar o que é meu do que é dos outros
    const meusAgrupadores: string[] = [];
    const agrupadoresOutros: string[] = [];

    posseAgrupador.forEach((donoId, key) => {
      if (donoId === userId) meusAgrupadores.push(key);
      else agrupadoresOutros.push(key);
    });

    // Último agrupador que eu trabalhei
    const meuUltimo =
      meusAgrupadores.length > 0
        ? meusAgrupadores[meusAgrupadores.length - 1]
        : null;

    logDebug(
      `Usuário ${userId}. Ocupados (Unified): ${JSON.stringify(agrupadoresOutros)}. Minha Pref: ${meuUltimo}`,
    );

    let proximo: FilaContagem | null = null;

    // TENTATIVA A: Continuar no MEU AGRUPADOR (Seja Marca ou Controle)
    if (meuUltimo) {
      proximo = await this.prisma.filaContagem.findFirst({
        where: {
          status: FilaStatus.PENDENTE,
          lockedBy: null,
          // Busca itens onde (Marca = Ultimo) OU (Marca = CONTROLE e Controle = Ultimo)
          OR: [
            { marca: meuUltimo },
            { marca: 'CONTROLE', controle: meuUltimo },
          ],
          AND: [{ OR: [{ priorizadoPor: null }, { priorizadoPor: userId }] }],
          contagens: { none: { userId: userId } },
        },
        orderBy: [
          { prioridadeManual: 'desc' },
          { prioridadeBase: 'desc' },
          { updatedAt: 'asc' },
        ],
      });
      if (proximo)
        logDebug(`-> A: Continuidade (${proximo.marca} ${proximo.controle})`);
    }

    // TENTATIVA B: Buscar algo LIVRE (Nem Marca nem Controle ocupados por outros)
    if (!proximo) {
      proximo = await this.prisma.filaContagem.findFirst({
        where: {
          status: FilaStatus.PENDENTE,
          lockedBy: null,
          contagens: { none: { userId: userId } },
          AND: [
            { OR: [{ priorizadoPor: null }, { priorizadoPor: userId }] },
            // Não pode ser marca que está ocupada
            { marca: { notIn: agrupadoresOutros } },
            // E se for CONTROLE, o controle não pode ser um dos ocupados
            {
              OR: [
                { marca: { not: 'CONTROLE' } },
                { marca: 'CONTROLE', controle: { notIn: agrupadoresOutros } },
              ],
            },
          ],
        },
        orderBy: [
          { prioridadeManual: 'desc' },
          { prioridadeBase: 'desc' },
          { updatedAt: 'asc' },
          { marca: 'asc' },
        ],
      });
      if (proximo)
        logDebug(`-> B: Isolado (${proximo.marca} ${proximo.controle})`);
    }

    // TENTATIVA C: Fallback
    if (!proximo) {
      this.logger.warn(`-> Fallback: Pegando qualquer item.`);
      proximo = await this.prisma.filaContagem.findFirst({
        where: {
          status: FilaStatus.PENDENTE,
          lockedBy: null,
          OR: [{ priorizadoPor: null }, { priorizadoPor: userId }],
          contagens: { none: { userId: userId } },
        },
        orderBy: [
          { prioridadeManual: 'desc' },
          { prioridadeBase: 'desc' },
          { updatedAt: 'asc' },
        ],
      });
      if (proximo) this.logger.debug(`-> C: Fallback (${proximo.marca})`);
    }

    if (!proximo) {
      return null;
    }

    // 4. Travar o item para o operador
    return this.prisma.filaContagem.update({
      where: { id: proximo.id },
      data: {
        status: FilaStatus.EM_CONTAGEM,
        lockedBy: userId,
        lockedAt: new Date(),
      },
    });
  }

  private async buscarItemPrioritarioManual(userId: number) {
    const itemIndicado = await this.prisma.filaContagem.findFirst({
      where: {
        status: FilaStatus.PENDENTE,
        lockedBy: null,
        prioridadeManual: { gt: 0 },
        priorizadoPor: userId,
        contagens: { none: { userId } },
      },
      orderBy: [{ prioridadeManual: 'desc' }, { updatedAt: 'asc' }],
    });

    if (itemIndicado) return itemIndicado;

    return this.prisma.filaContagem.findFirst({
      where: {
        status: FilaStatus.PENDENTE,
        lockedBy: null,
        prioridadeManual: { gt: 0 },
        priorizadoPor: null,
        contagens: { none: { userId } },
      },
      orderBy: [{ prioridadeManual: 'desc' }, { updatedAt: 'asc' }],
    });
  }

  private async assumirItemPrioritario(
    userId: number,
    itemPrioritario: FilaContagem,
    lockedItem?: FilaContagem | null,
  ) {
    if (lockedItem && lockedItem.id !== itemPrioritario.id) {
      await this.prisma.filaContagem.update({
        where: { id: lockedItem.id },
        data: {
          status: FilaStatus.PENDENTE,
          lockedBy: null,
          lockedAt: null,
        },
      });
    }

    return this.prisma.filaContagem.update({
      where: { id: itemPrioritario.id },
      data: {
        status: FilaStatus.EM_CONTAGEM,
        lockedBy: userId,
        lockedAt: new Date(),
      },
    });
  }

  private async buscaProximoWeighted(userId: number) {
    const lockedItem = await this.prisma.filaContagem.findFirst({
      where: {
        lockedBy: userId,
        status: FilaStatus.EM_CONTAGEM,
      },
    });

    const itemPrioritario = await this.buscarItemPrioritarioManual(userId);
    if (
      itemPrioritario &&
      (!lockedItem ||
        Number(itemPrioritario.prioridadeManual || 0) >
          Number(lockedItem.prioridadeManual || 0))
    ) {
      return this.assumirItemPrioritario(userId, itemPrioritario, lockedItem);
    }

    if (lockedItem) return lockedItem;

    const itemIndicado = await this.prisma.filaContagem.findFirst({
      where: {
        status: FilaStatus.PENDENTE,
        lockedBy: null,
        priorizadoPor: userId,
      },
      orderBy: [{ prioridadeManual: 'desc' }, { updatedAt: 'asc' }],
    });

    if (itemIndicado) {
      return this.prisma.filaContagem.update({
        where: { id: itemIndicado.id },
        data: {
          status: FilaStatus.EM_CONTAGEM,
          lockedBy: userId,
          lockedAt: new Date(),
        },
      });
    }

    const timeframe = new Date();
    timeframe.setMinutes(
      timeframe.getMinutes() - ContagemService.RECENT_HISTORY_WINDOW,
    );

    const [locksAtivos, historicoRecente, historicoOperador] =
      await Promise.all([
        this.prisma.filaContagem.findMany({
          where: {
            status: FilaStatus.EM_CONTAGEM,
            lockedBy: { not: null },
          },
          select: { marca: true, controle: true, lockedBy: true },
        }),
        this.prisma.contagem.findMany({
          where: {
            createdAt: { gte: timeframe },
          },
          select: {
            userId: true,
            fila: {
              select: { marca: true, controle: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.contagem.findMany({
          where: { userId },
          select: {
            fila: { select: { marca: true, controle: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: ContagemService.OPERATOR_COOLDOWN_SIZE,
        }),
      ]);

    const getAgrupador = (m: string | null, c: string | null) => {
      if (!m) return null;
      if (m === 'CONTROLE' && c) return c;
      return m;
    };

    const posseAgrupador = new Map<string, number>();
    const processItem = (
      uid: number,
      marca: string | null,
      controle: string | null,
    ) => {
      const key = getAgrupador(marca, controle);
      if (key) posseAgrupador.set(key, uid);
    };

    historicoRecente.forEach((item) => {
      processItem(
        item.userId,
        item.fila?.marca || null,
        item.fila?.controle || null,
      );
    });
    locksAtivos.forEach((item) => {
      processItem(item.lockedBy!, item.marca, item.controle);
    });

    const meusAgrupadores: string[] = [];
    const agrupadoresOutros: string[] = [];
    posseAgrupador.forEach((donoId, key) => {
      if (donoId === userId) meusAgrupadores.push(key);
      else agrupadoresOutros.push(key);
    });

    const meuUltimo =
      meusAgrupadores.length > 0
        ? meusAgrupadores[meusAgrupadores.length - 1]
        : null;

    const agrupadoresRecentesOperador = historicoOperador
      .map((item) =>
        getAgrupador(item.fila?.marca || null, item.fila?.controle || null),
      )
      .filter((x): x is string => !!x);

    let candidatos: FilaContagem[] = [];

    if (meuUltimo) {
      candidatos = await this.prisma.filaContagem.findMany({
        where: {
          status: FilaStatus.PENDENTE,
          lockedBy: null,
          OR: [
            { marca: meuUltimo },
            { marca: 'CONTROLE', controle: meuUltimo },
          ],
          AND: [{ OR: [{ priorizadoPor: null }, { priorizadoPor: userId }] }],
          contagens: { none: { userId: userId } },
        },
        orderBy: [
          { prioridadeManual: 'desc' },
          { prioridadeBase: 'desc' },
          { updatedAt: 'asc' },
        ],
        take: ContagemService.RANDOM_POOL_SIZE,
      });
    }

    if (candidatos.length === 0) {
      candidatos = await this.prisma.filaContagem.findMany({
        where: {
          status: FilaStatus.PENDENTE,
          lockedBy: null,
          contagens: { none: { userId: userId } },
          AND: [
            { OR: [{ priorizadoPor: null }, { priorizadoPor: userId }] },
            { marca: { notIn: agrupadoresOutros } },
            {
              OR: [
                { marca: { not: 'CONTROLE' } },
                { marca: 'CONTROLE', controle: { notIn: agrupadoresOutros } },
              ],
            },
          ],
        },
        orderBy: [
          { prioridadeManual: 'desc' },
          { prioridadeBase: 'desc' },
          { updatedAt: 'asc' },
          { marca: 'asc' },
        ],
        take: ContagemService.RANDOM_POOL_SIZE,
      });
    }

    if (candidatos.length === 0) {
      candidatos = await this.prisma.filaContagem.findMany({
        where: {
          status: FilaStatus.PENDENTE,
          lockedBy: null,
          OR: [{ priorizadoPor: null }, { priorizadoPor: userId }],
          contagens: { none: { userId: userId } },
        },
        orderBy: [
          { prioridadeManual: 'desc' },
          { prioridadeBase: 'desc' },
          { updatedAt: 'asc' },
        ],
        take: ContagemService.RANDOM_POOL_SIZE,
      });
    }

    if (candidatos.length === 0) return null;

    const agrupadoresCooldown = new Set(agrupadoresRecentesOperador);
    let pool = candidatos.filter((item) => {
      const key = getAgrupador(item.marca, item.controle);
      return key ? !agrupadoresCooldown.has(key) : true;
    });
    if (pool.length === 0) pool = candidatos;

    const escolhido = this.escolherPonderado(pool, getAgrupador, userId);

    if (!escolhido) return null;

    return this.prisma.filaContagem.update({
      where: { id: escolhido.id },
      data: {
        status: FilaStatus.EM_CONTAGEM,
        lockedBy: userId,
        lockedAt: new Date(),
      },
    });
  }

  private escolherPonderado(
    candidatos: FilaContagem[],
    getAgrupador: (m: string | null, c: string | null) => string | null,
    userId: number,
  ) {
    let totalPeso = 0;
    const pesos = candidatos.map((item, idx) => {
      const prioridadeManual = Math.max(0, Number(item.prioridadeManual || 0));
      const prioridadeBase = Math.max(0, Number(item.prioridadeBase || 0));

      // Mantém influência forte da prioridade manual sem zerar opções de exploração.
      let peso = prioridadeManual * 100 + prioridadeBase + 1;

      const diasSemAtualizar = Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(item.updatedAt).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      const bonusExploracao = Math.min(20, diasSemAtualizar);
      peso += bonusExploracao;

      // Pequeno ruído para desempate determinístico entre pesos iguais.
      peso += Math.random() * 0.5 + idx * 0.0001;

      totalPeso += peso;
      return { item, peso };
    });

    if (totalPeso <= 0) {
      this.logger.warn(
        `[Fila] Soma de pesos inválida para usuário ${userId}. Retornando primeiro candidato.`,
      );
      return candidatos[0];
    }

    let alvo = Math.random() * totalPeso;
    for (const entry of pesos) {
      alvo -= entry.peso;
      if (alvo <= 0) {
        const agrupador = getAgrupador(entry.item.marca, entry.item.controle);
        this.logger.debug(
          `[Fila] Weighted pick user=${userId} codprod=${entry.item.codprod} agrupador=${agrupador || 'N/A'} peso=${entry.peso.toFixed(2)} pool=${candidatos.length}`,
        );
        return entry.item;
      }
    }

    return pesos[pesos.length - 1].item;
  }

  private normalizarCodigoBarras(value: unknown): string {
    return String(value || '')
      .replace(/\D/g, '')
      .trim();
  }

  private isGtinValido(codigo: string): boolean {
    if (!/^\d+$/.test(codigo) || ![8, 12, 13, 14].includes(codigo.length)) {
      return false;
    }

    const digitos = codigo.split('').map(Number);
    const verificador = digitos.pop();
    if (verificador === undefined) return false;

    let soma = 0;
    for (let i = digitos.length - 1, posicao = 0; i >= 0; i--, posicao++) {
      soma += digitos[i] * (posicao % 2 === 0 ? 3 : 1);
    }

    return (10 - (soma % 10)) % 10 === verificador;
  }

  private extrairCodigosBarras(value: unknown): string[] {
    const codigo = this.normalizarCodigoBarras(value);
    if (!codigo) return [];
    if (this.isGtinValido(codigo)) return [codigo];

    const tamanhosPadrao = [13, 14, 12, 8];
    for (const tamanho of tamanhosPadrao) {
      if (codigo.length > tamanho && codigo.length % tamanho === 0) {
        const partes = codigo.match(new RegExp(`.{1,${tamanho}}`, 'g')) || [];
        if (
          partes.length > 1 &&
          partes.every((parte) => parte.length === tamanho)
        ) {
          return Array.from(new Set(partes));
        }
      }
    }

    if (codigo.length > 14 && codigo.length % 2 === 0) {
      const metade = codigo.length / 2;
      const primeiraParte = codigo.slice(0, metade);
      const segundaParte = codigo.slice(metade);
      if (primeiraParte === segundaParte) {
        return [primeiraParte];
      }
    }

    if (codigo.length <= 14) return [codigo];

    const codigosEncontrados: string[] = [];
    for (const tamanho of [14, 13, 12, 8]) {
      for (let i = 0; i <= codigo.length - tamanho; i++) {
        const candidato = codigo.slice(i, i + tamanho);
        if (this.isGtinValido(candidato)) {
          codigosEncontrados.push(candidato);
        }
      }
    }

    if (codigosEncontrados.length > 0) {
      return Array.from(new Set(codigosEncontrados));
    }

    return [codigo];
  }

  private obterCodigoBarrasCadastro(value: unknown): string {
    const codigos = this.extrairCodigosBarras(value);
    return (
      codigos.find((codigo) => [8, 12, 13, 14].includes(codigo.length)) ||
      codigos[0] ||
      ''
    );
  }

  private async buscarCodigosBarrasSankhya(codprod: number): Promise<string[]> {
    if (!codprod) return [];

    const sql = `
      SELECT CODBARRA FROM (
        SELECT NULLIF(TRIM(PRO.AD_CODBARRAESTOQUE), '') AS CODBARRA
        FROM TGFPRO PRO
        WHERE PRO.CODPROD = ${codprod}
        UNION
        SELECT NULLIF(TRIM(BAR.CODBARRA), '') AS CODBARRA
        FROM TGFBAR BAR
        WHERE BAR.CODPROD = ${codprod}
      )
      WHERE CODBARRA IS NOT NULL
    `;

    try {
      const rows = await this.sankhyaClient.executeQuery(sql);
      return rows
        .flatMap((row: any) =>
          this.extrairCodigosBarras(
            row.CODBARRA ?? row.codbarras ?? row.COD_BARRA,
          ),
        )
        .filter(Boolean);
    } catch (error: any) {
      this.logger.warn(
        `[Código de barras] Falha ao consultar Sankhya para produto ${codprod}: ${error.message}`,
      );
      return [];
    }
  }

  private async obterCodigosBarrasValidos(
    fila: FilaContagem,
    snapshot?: { codigoBarrasCadastro?: string | null } | null,
  ): Promise<string[]> {
    const codigos = [
      ...this.extrairCodigosBarras((fila as any).codigoBarrasCadastro),
      ...this.extrairCodigosBarras(snapshot?.codigoBarrasCadastro),
      ...(await this.buscarCodigosBarrasSankhya(fila.codprod)),
    ].filter(Boolean);

    return Array.from(new Set(codigos));
  }

  private async enriquecerItemFilaComCodigoBarras(item: FilaContagem | null) {
    if (!item) return null;

    const snapshot = await this.prisma.snapshotEstoque.findFirst({
      where: {
        codprod: item.codprod,
        codlocal: item.codlocal,
        codemp: item.codemp,
      },
      orderBy: { dataRef: 'desc' },
    });

    const codigosBarrasValidos = await this.obterCodigosBarrasValidos(
      item,
      snapshot,
    );
    const codigoBarrasCadastro =
      codigosBarrasValidos.find((codigo) =>
        [8, 12, 13, 14].includes(codigo.length),
      ) ||
      codigosBarrasValidos[0] ||
      '';

    if (
      codigoBarrasCadastro &&
      this.normalizarCodigoBarras((item as any).codigoBarrasCadastro) !==
        codigoBarrasCadastro
    ) {
      await this.prisma.filaContagem.update({
        where: { id: item.id },
        data: { codigoBarrasCadastro },
      });
    }

    return {
      ...item,
      codigoBarrasCadastro,
      codigosBarrasValidos,
    };
  }

  private async validarCodigoBarrasContagem(
    fila: FilaContagem,
    snapshot: { codigoBarrasCadastro?: string | null } | null,
    codigoBarrasLido: string,
  ): Promise<string> {
    const codigoLido = this.normalizarCodigoBarras(codigoBarrasLido);
    if (!codigoLido) {
      throw new BadRequestException(
        'Leia o código de barras do produto antes de confirmar.',
      );
    }

    const codigosValidos = await this.obterCodigosBarrasValidos(fila, snapshot);
    if (codigosValidos.length === 0) {
      throw new BadRequestException(
        'Produto sem EAN cadastrado. Reporte o cadastro antes de confirmar a contagem.',
      );
    }

    if (!codigosValidos.includes(codigoLido)) {
      throw new BadRequestException(
        'Código de barras lido não confere com o produto selecionado.',
      );
    }

    return codigoLido;
  }

  private calcularPercentualDivergencia(diferenca: number, esperado: number) {
    if (diferenca === 0) return 0;
    return esperado > 0 ? (Math.abs(diferenca) / esperado) * 100 : 100;
  }

  private historicoInventario(
    movimentacoesAtual: any,
    fluxoInventario: Record<string, any>,
  ) {
    const base: Record<string, any> =
      movimentacoesAtual &&
      typeof movimentacoesAtual === 'object' &&
      !Array.isArray(movimentacoesAtual)
        ? { ...(movimentacoesAtual as Record<string, any>) }
        : {
            consultaSankhya: Array.isArray(movimentacoesAtual)
              ? movimentacoesAtual
              : [],
          };

    return {
      ...base,
      fluxoInventario: {
        ...((base.fluxoInventario as Record<string, any>) || {}),
        ...fluxoInventario,
      },
    };
  }

  private descricaoOperacaoRessalva(operacao: OperacaoRessalvaInventario) {
    if (operacao.tipo === 'TRANSFERENCIA_INTERNA') {
      return `TOP ${operacao.top} transfere ${operacao.quantidade} do CODLOCAL ${operacao.codlocalOrigem} para ${operacao.codlocalDestino}`;
    }

    if (operacao.tipo === 'ENTRADA_TEMPORARIA') {
      return `TOP ${operacao.top} cria entrada temporária de ${operacao.quantidade} no CODLOCAL ${operacao.codlocalDestino}`;
    }

    if (operacao.tipo === 'RETIRADA_RESSALVA') {
      return `TOP ${operacao.top} retira ${operacao.quantidade} do CODLOCAL ${operacao.codlocal}`;
    }

    if (operacao.tipo === 'ESTORNO_RESSALVA') {
      return `estorna ${operacao.quantidade} do CODLOCAL ${operacao.codlocalOrigem} para ${operacao.codlocalDestino}`;
    }

    if (operacao.tipo === 'LIBERACAO_RESSALVA') {
      return `libera ${operacao.quantidade} do CODLOCAL ${operacao.codlocalOrigem} para ${operacao.codlocalDestino}`;
    }

    return 'sem ajuste em ressalva';
  }

  private sankhyaRessalvaEnabled() {
    return process.env.INVENTARIO_SANKHYA_RESSALVA_ENABLED === 'true';
  }

  private copiaDirecionadaSankhyaEnabled() {
    return process.env.INVENTARIO_DIRECIONADA_SANKHYA_ENABLED === 'true';
  }

  private hojePtBr() {
    return new Date().toLocaleDateString('pt-BR');
  }

  private async resolverValorUnitarioSankhya(
    codprod: number,
    codemp: number,
    codlocal: number,
    snapshot?: { custoEspelho?: any } | null,
  ) {
    const custoSnapshot = Number(snapshot?.custoEspelho || 0);
    if (custoSnapshot > 0) return custoSnapshot;

    const custoSankhya = await this.sankhyaClient.getReplacementCost(
      codprod,
      codemp,
      codlocal,
    );
    if (custoSankhya && custoSankhya > 0) return custoSankhya;

    const precoSankhya = await this.sankhyaClient.getLatestSalePrice(codprod);
    if (precoSankhya && precoSankhya > 0) return precoSankhya;

    return 0;
  }

  private async executarSegregacaoRessalvaSankhya(params: {
    operacao: OperacaoRessalvaInventario;
    fila: Pick<
      FilaContagem,
      'codprod' | 'codemp' | 'codlocal' | 'descprod' | 'controle' | 'unidade'
    >;
    snapshot?: {
      custoEspelho?: any;
      unidade?: string | null;
      controle?: string | null;
    } | null;
    origem: 'PRIMEIRA_CONTAGEM' | 'SINCRONIZACAO_PENDENTE';
  }) {
    const { operacao, fila, snapshot } = params;

    if (operacao.quantidade <= 0 || operacao.tipo === 'SEM_AJUSTE') {
      return { status: 'IGNORADO', motivo: 'Sem quantidade para segregar' };
    }

    if (!this.sankhyaRessalvaEnabled()) {
      return {
        status: 'SIMULADO',
        motivo: 'INVENTARIO_SANKHYA_RESSALVA_ENABLED não habilitado',
        operacao,
      };
    }

    try {
      const codvol =
        String(snapshot?.unidade || fila.unidade || 'UN').trim() || 'UN';
      const controle =
        String(snapshot?.controle || fila.controle || ' ').trim() || ' ';
      const vlrunit = await this.resolverValorUnitarioSankhya(
        fila.codprod,
        fila.codemp,
        fila.codlocal,
        snapshot,
      );
      const observacao = `Ressalva Inventario Hub - Produto ${fila.codprod} - ${operacao.motivo} - Qtd ${operacao.quantidade}`;
      let nunota: number | null = null;

      if (operacao.tipo === 'TRANSFERENCIA_INTERNA') {
        nunota = await this.sankhyaClient.createInternalTransferNote(
          fila.codemp,
          this.hojePtBr(),
          operacao.top || INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
          {
            codprod: fila.codprod,
            qtdneg: operacao.quantidade,
            codlocalOrigem:
              operacao.codlocalOrigem || INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
            codlocalDestino:
              operacao.codlocalDestino || INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
            vlrunit,
            codvol,
            controle,
          },
          observacao,
        );
      } else if (operacao.tipo === 'ENTRADA_TEMPORARIA') {
        nunota = await this.sankhyaClient.createAdjustmentNote(
          fila.codemp,
          this.hojePtBr(),
          operacao.top || INVENTARIO_TOPS.ENTRADA_TEMPORARIA,
          [
            {
              codprod: fila.codprod,
              qtdneg: operacao.quantidade,
              codlocal:
                operacao.codlocalDestino ||
                INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
              vlrunit,
              codvol,
              controle,
            },
          ],
          observacao,
        );
      } else {
        return {
          status: 'IGNORADO',
          motivo: `Tipo de operação não sincronizado: ${operacao.tipo}`,
          operacao,
        };
      }

      if (nunota) {
        await this.sankhyaClient.confirmNote(nunota);
      }

      return {
        status: 'SYNCED',
        nunota,
        origem: params.origem,
        operacao,
        vlrunit,
        codvol,
        controle,
      };
    } catch (error: any) {
      this.logger.error(
        `[Ressalva Sankhya] Falha produto ${fila.codprod}: ${error.message}`,
      );
      return {
        status: 'ERROR',
        error: error.message,
        origem: params.origem,
        operacao,
      };
    }
  }

  private resolverOperacoesFinalizacaoRessalva(
    divergencia: any,
    operacaoFinal: OperacaoRessalvaInventario,
  ): OperacaoRessalvaInventario[] {
    const segregacao =
      divergencia?.movimentacoes?.fluxoInventario?.segregacaoRessalva;
    const operacoes = criarOperacoesFinalizacaoRessalva({
      diferencaFinal:
        operacaoFinal.motivo === 'SEM_DIVERGENCIA'
          ? 0
          : operacaoFinal.motivo === 'SOBRA'
            ? operacaoFinal.quantidade
            : -operacaoFinal.quantidade,
      segregacaoRessalva: segregacao,
    });

    if (operacoes.length > 0) return operacoes;
    return operacaoFinal.tipo === 'SEM_AJUSTE' ? [] : [operacaoFinal];
  }

  private async executarFinalizacaoRessalvaSankhya(params: {
    operacao: OperacaoRessalvaInventario;
    fila: Pick<
      FilaContagem,
      'codprod' | 'codemp' | 'codlocal' | 'descprod' | 'controle' | 'unidade'
    >;
    snapshot?: {
      custoEspelho?: any;
      unidade?: string | null;
      controle?: string | null;
    } | null;
    origem: 'SEGUNDA_CONTAGEM' | 'TERCEIRA_CONTAGEM';
  }) {
    const { operacao, fila, snapshot } = params;

    if (operacao.quantidade <= 0 || operacao.tipo === 'SEM_AJUSTE') {
      return { status: 'IGNORADO', motivo: 'Sem quantidade para finalizar' };
    }

    if (!this.sankhyaRessalvaEnabled()) {
      return {
        status: 'SIMULADO',
        motivo: 'INVENTARIO_SANKHYA_RESSALVA_ENABLED não habilitado',
        operacao,
      };
    }

    try {
      const codvol =
        String(snapshot?.unidade || fila.unidade || 'UN').trim() || 'UN';
      const controle =
        String(snapshot?.controle || fila.controle || ' ').trim() || ' ';
      const vlrunit = await this.resolverValorUnitarioSankhya(
        fila.codprod,
        fila.codemp,
        fila.codlocal,
        snapshot,
      );
      const observacao = `Finalizacao Ressalva Inventario Hub - Produto ${fila.codprod} - ${operacao.motivo} - Qtd ${operacao.quantidade}`;
      let nunota: number | null = null;

      if (
        operacao.tipo === 'ESTORNO_RESSALVA' ||
        operacao.tipo === 'LIBERACAO_RESSALVA' ||
        operacao.tipo === 'TRANSFERENCIA_INTERNA'
      ) {
        nunota = await this.sankhyaClient.createInternalTransferNote(
          fila.codemp,
          this.hojePtBr(),
          operacao.top || INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
          {
            codprod: fila.codprod,
            qtdneg: operacao.quantidade,
            codlocalOrigem:
              operacao.codlocalOrigem || INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
            codlocalDestino:
              operacao.codlocalDestino || INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
            vlrunit,
            codvol,
            controle,
          },
          observacao,
        );
      } else if (operacao.tipo === 'ENTRADA_TEMPORARIA') {
        nunota = await this.sankhyaClient.createAdjustmentNote(
          fila.codemp,
          this.hojePtBr(),
          operacao.top || INVENTARIO_TOPS.ENTRADA_TEMPORARIA,
          [
            {
              codprod: fila.codprod,
              qtdneg: operacao.quantidade,
              codlocal:
                operacao.codlocalDestino ||
                INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
              vlrunit,
              codvol,
              controle,
            },
          ],
          observacao,
        );
      } else if (operacao.tipo === 'RETIRADA_RESSALVA') {
        nunota = await this.sankhyaClient.createAdjustmentNote(
          fila.codemp,
          this.hojePtBr(),
          operacao.top || INVENTARIO_TOPS.SAIDA_RESSALVA,
          [
            {
              codprod: fila.codprod,
              qtdneg: operacao.quantidade,
              codlocal:
                operacao.codlocal || INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
              vlrunit,
              codvol,
              controle,
            },
          ],
          observacao,
        );
      } else {
        return {
          status: 'IGNORADO',
          motivo: `Tipo de operação não sincronizado: ${operacao.tipo}`,
          operacao,
        };
      }

      if (nunota) {
        await this.sankhyaClient.confirmNote(nunota);
      }

      return {
        status: 'SYNCED',
        nunota,
        origem: params.origem,
        operacao,
        vlrunit,
        codvol,
        controle,
      };
    } catch (error: any) {
      this.logger.error(
        `[Finalização Ressalva Sankhya] Falha produto ${fila.codprod}: ${error.message}`,
      );
      return {
        status: 'ERROR',
        error: error.message,
        origem: params.origem,
        operacao,
      };
    }
  }

  private async executarOperacoesFinalizacaoRessalvaSankhya(params: {
    operacoes: OperacaoRessalvaInventario[];
    fila: Pick<
      FilaContagem,
      'codprod' | 'codemp' | 'codlocal' | 'descprod' | 'controle' | 'unidade'
    >;
    snapshot?: {
      custoEspelho?: any;
      unidade?: string | null;
      controle?: string | null;
    } | null;
    origem: 'SEGUNDA_CONTAGEM' | 'TERCEIRA_CONTAGEM';
  }) {
    const resultados: any[] = [];

    for (const operacao of params.operacoes) {
      const resultado = await this.executarFinalizacaoRessalvaSankhya({
        operacao,
        fila: params.fila,
        snapshot: params.snapshot,
        origem: params.origem,
      });
      resultados.push(resultado);

      if (resultado.status === 'ERROR') break;
    }

    return resultados;
  }

  private filtrarOperacoesFinalizacaoPendentes(
    operacoes: OperacaoRessalvaInventario[],
    resultadosAnteriores?: any[] | null,
  ) {
    if (
      !Array.isArray(resultadosAnteriores) ||
      resultadosAnteriores.length === 0
    ) {
      return operacoes;
    }

    return operacoes.filter((operacao, index) => {
      const resultadoAnterior = resultadosAnteriores[index];
      return resultadoAnterior?.status !== 'SYNCED';
    });
  }

  private normalizarOperacaoFinalizacaoRessalva(
    operacao: OperacaoRessalvaInventario,
  ): OperacaoRessalvaInventario {
    if (operacao.tipo !== 'RETIRADA_RESSALVA') return operacao;

    return {
      ...operacao,
      top: INVENTARIO_TOPS.SAIDA_RESSALVA,
      codlocal: operacao.codlocal || INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
    };
  }

  private async buscarDivergenciaPendentePorFila(filaId: number) {
    return this.prisma.divergencia.findFirst({
      where: {
        status: DivergenciaStatus.PENDENTE,
        contagem: { filaId },
      },
      include: { contagem: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async finalizarCicloInventario(params: {
    divergencia: any;
    filaId: number;
    fila: FilaContagem;
    snapshot?: {
      custoEspelho?: any;
      unidade?: string | null;
      controle?: string | null;
    } | null;
    origem: 'SEGUNDA_CONTAGEM' | 'TERCEIRA_CONTAGEM';
    contagemVencedora: number;
    diferencaFinal: number;
    operacaoFinal?: OperacaoRessalvaInventario;
    observacao?: string;
  }) {
    const operacaoFinalBase =
      params.operacaoFinal || criarOperacaoFinalizacao(params.diferencaFinal);
    const operacoesFinal = this.resolverOperacoesFinalizacaoRessalva(
      params.divergencia,
      operacaoFinalBase,
    );
    const operacaoFinal =
      operacoesFinal.length > 0
        ? operacoesFinal[operacoesFinal.length - 1]
        : operacaoFinalBase;
    const ajusteQtd = Math.abs(params.diferencaFinal);
    const deveAjustar = ajusteQtd > 0;
    const sankhyaFinalizacoes =
      await this.executarOperacoesFinalizacaoRessalvaSankhya({
        operacoes: operacoesFinal,
        fila: params.fila,
        snapshot: params.snapshot,
        origem: params.origem,
      });
    const sankhyaFinalizacao = sankhyaFinalizacoes[
      sankhyaFinalizacoes.length - 1
    ] || {
      status: 'IGNORADO',
      motivo: 'Sem operações de finalização em ressalva',
    };
    const ultimaNota = [...sankhyaFinalizacoes]
      .reverse()
      .find((resultado) => resultado.status === 'SYNCED' && resultado.nunota);
    const descricaoFinalizacao =
      operacoesFinal.length > 0
        ? operacoesFinal
            .map((operacao) => this.descricaoOperacaoRessalva(operacao))
            .join('; ')
        : this.descricaoOperacaoRessalva(operacaoFinal);
    const houveErro = sankhyaFinalizacoes.some(
      (resultado) => resultado.status === 'ERROR',
    );
    const houveSync = sankhyaFinalizacoes.some(
      (resultado) => resultado.status === 'SYNCED',
    );
    const adjustStatus =
      houveSync && !houveErro
        ? 'FINALIZACAO_SYNCED'
        : houveErro
          ? 'FINALIZACAO_ERROR'
          : 'LOCAL_FINALIZADO';
    const statusDivergencia = houveErro
      ? DivergenciaStatus.PENDENTE
      : deveAjustar
        ? DivergenciaStatus.ACEITO
        : DivergenciaStatus.CONCLUIDO;
    const decisaoDivergencia = houveErro
      ? Decisao.RECONTAR
      : deveAjustar
        ? Decisao.AJUSTAR
        : Decisao.FINALIZAR_ANALISE;
    const observacaoFinalizacao =
      params.observacao ||
      `Ciclo finalizado por ${params.origem}. Contagem vencedora: ${params.contagemVencedora}. Operação em ressalva: ${descricaoFinalizacao}.`;

    await this.prisma.divergencia.update({
      where: { id: params.divergencia.id },
      data: {
        status: statusDivergencia,
        decisao: decisaoDivergencia,
        ajusteTipo:
          params.diferencaFinal > 0
            ? AjusteTipo.ENTRADA
            : params.diferencaFinal < 0
              ? AjusteTipo.SAIDA
              : null,
        ajusteQtd,
        adjustStatus,
        adjustDate: new Date(),
        adjustNoteId: ultimaNota
          ? Number(ultimaNota.nunota)
          : params.divergencia.adjustNoteId,
        observacoes: houveErro
          ? `${observacaoFinalizacao} Falha na finalização Sankhya; pendente de reprocessamento pelo supervisor.`
          : observacaoFinalizacao,
        movimentacoes: this.historicoInventario(
          params.divergencia.movimentacoes,
          {
            etapa: houveErro ? 'FINALIZACAO_RESSALVA_ERRO' : 'FINALIZADO',
            origemFinalizacao: params.origem,
            contagemVencedora: params.contagemVencedora,
            diferencaFinal: params.diferencaFinal,
            finalizacaoRessalva: operacaoFinal,
            operacoesFinalizacaoRessalva: operacoesFinal,
            sankhyaFinalizacaoRessalva: sankhyaFinalizacao,
            sankhyaFinalizacoesRessalva: sankhyaFinalizacoes,
            codlocalRessalva: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
          },
        ) as any,
      },
    });

    await this.prisma.filaContagem.update({
      where: { id: params.filaId },
      data: houveErro
        ? {
            status: FilaStatus.BLOQUEADO_AUDITORIA,
            lockedBy: null,
            lockedAt: null,
            ultimaContagemEm: new Date(),
            prioridadeBase: 0,
            prioridadeManual: PRIORIDADE_AUDITORIA_RECONTAGEM,
            motivoPriorizacao: 'FINALIZACAO_RESSALVA_ERRO',
            priorizadoPor: null,
          }
        : {
            status: FilaStatus.CONCLUIDO,
            lockedBy: null,
            lockedAt: null,
            contagensOk: { increment: 1 },
            ultimaContagemEm: new Date(),
            prioridadeBase: 0,
            prioridadeManual: 0,
            motivoPriorizacao: null,
            priorizadoPor: null,
            recontagens: 0,
          },
    });

    return {
      acao: params.origem,
      status: houveErro
        ? 'FINALIZACAO_RESSALVA_ERRO'
        : deveAjustar
          ? 'AJUSTAR'
          : 'CONCLUIDO',
      contagemVencedora: params.contagemVencedora,
      divergencia: params.diferencaFinal,
      operacaoFinal,
      operacoesFinal,
      sankhyaFinalizacao,
      sankhyaFinalizacoes,
    };
  }

  private isMesmoDia(data?: Date | null) {
    if (!data) return false;
    const hoje = new Date();
    const dataRef = new Date(data);
    return (
      dataRef.getFullYear() === hoje.getFullYear() &&
      dataRef.getMonth() === hoje.getMonth() &&
      dataRef.getDate() === hoje.getDate()
    );
  }

  private async resolverBaseContagem(
    fila: FilaContagem,
    snapshot?: {
      dataRef?: Date | null;
      saldoEspelho?: any;
    } | null,
  ): Promise<BaseContagemOperacional> {
    const saldoSnapshot = Number(snapshot?.saldoEspelho || 0);

    if (process.env.INVENTARIO_LOCAL_VALIDATION === 'true') {
      return {
        origem: 'SNAPSHOT_LOCAL',
        saldoBase: saldoSnapshot,
        reservadoAtual: 0,
        dataRef: snapshot?.dataRef || null,
        snapshotDesatualizado: false,
      };
    }

    try {
      const saldoVivo = await this.sankhyaService.fetchLiveStockFromSankhya(
        fila.codprod,
        fila.codlocal,
      );

      return {
        origem: 'SANKHYA_LIVE',
        saldoBase: Number(saldoVivo.saldo || 0),
        reservadoAtual: Number(saldoVivo.reservado || 0),
        dataRef: new Date(),
        snapshotDesatualizado: !this.isMesmoDia(snapshot?.dataRef),
      };
    } catch (error: any) {
      this.logger.warn(
        `Contagem bloqueada: falha ao buscar saldo vivo do produto ${fila.codprod} no Sankhya (${error.message}).`,
      );
      throw new BadRequestException(
        'Não foi possível consultar o saldo atual do produto no Sankhya. Tente sincronizar novamente antes de registrar a contagem.',
      );
    }
  }

  private montarMovimentacoesSaldoVivo(base: BaseContagemOperacional): {
    movimentacoes: any[];
    saldoAjustado: number;
    temMovimentacao: boolean;
    totalEntradas: number;
    totalSaidas: number;
    totalReservas: number;
  } {
    const movimentacoes =
      base.reservadoAtual > 0
        ? [
            {
              NUNOTA: null,
              DTMOV: new Date().toISOString(),
              CODTIPOPER: 1000,
              QTDNEG: base.reservadoAtual,
              TIPMOV: 'P',
              ORIGEM: 'RESERVA',
              DESCRICAO: 'Reserva atual considerada a partir do saldo vivo',
            },
          ]
        : [];

    return {
      movimentacoes,
      saldoAjustado: base.saldoBase - base.reservadoAtual,
      temMovimentacao: movimentacoes.length > 0,
      totalEntradas: 0,
      totalSaidas: 0,
      totalReservas: base.reservadoAtual,
    };
  }

  // Registra a contagem realizada pelo operador
  async registrar(userId: number, dto: RegistrarContagemDto) {
    const fila = await this.prisma.filaContagem.findUnique({
      where: { id: dto.filaId },
    });

    if (!fila || fila.lockedBy !== userId) {
      throw new BadRequestException(
        'Item não está travado para você ou não existe',
      );
    }

    const snapshot = await this.prisma.snapshotEstoque.findFirst({
      where: {
        codprod: fila.codprod,
        codlocal: fila.codlocal,
        codemp: fila.codemp,
      },
      orderBy: { dataRef: 'desc' },
    });

    const esperadoSnapshot = snapshot ? Number(snapshot.saldoEspelho) : 0;
    const contado = Number(dto.qtd_contada);
    const codigoBarrasLido = await this.validarCodigoBarrasContagem(
      fila,
      snapshot,
      dto.codigo_barras_lido,
    );

    const contagensAnteriores = await this.prisma.contagem.findMany({
      where: {
        filaId: fila.id,
        tipo: { in: [ContagemTipo.CONTAGEM, ContagemTipo.RECONTAGEM] },
      },
      orderBy: { createdAt: 'asc' },
    });

    const tipoContagem =
      contagensAnteriores.length > 0
        ? ContagemTipo.RECONTAGEM
        : ContagemTipo.CONTAGEM;

    if (tipoContagem === ContagemTipo.CONTAGEM) {
      const baseContagem = await this.resolverBaseContagem(fila, snapshot);
      const esperado = baseContagem.saldoBase;
      const divergenciaSnapshot = contado - esperado;
      let movInfo: {
        movimentacoes: any[];
        saldoAjustado: number;
        temMovimentacao: boolean;
        totalEntradas: number;
        totalSaidas: number;
        totalReservas: number;
      };

      if (divergenciaSnapshot === 0) {
        movInfo = {
          movimentacoes: [],
          saldoAjustado: esperado,
          temMovimentacao: false,
          totalEntradas: 0,
          totalSaidas: 0,
          totalReservas: 0,
        };
      } else if (baseContagem.origem === 'SANKHYA_LIVE') {
        movInfo = this.montarMovimentacoesSaldoVivo(baseContagem);
      } else {
        movInfo = await this.verificarMovimentacoes(
          fila.codprod,
          fila.codemp,
          fila.codlocal,
          baseContagem.dataRef || snapshot?.dataRef,
          esperado,
        );
      }

      const decisao = avaliarPrimeiraContagemInventario({
        saldoSnapshot: esperado,
        quantidadeContada: contado,
        movimentacoes: movInfo.movimentacoes,
      });
      const percDivergencia = this.calcularPercentualDivergencia(
        decisao.diferencaFinal,
        decisao.saldoEsperadoAtual,
      );
      const statusAnalise =
        decisao.acao === 'CONCLUIDO'
          ? StatusAnalise.OK_AUTOMATICO
          : StatusAnalise.DIVERGENCIA_PENDENTE;

      const contagem = await this.prisma.contagem.create({
        data: {
          codprod: fila.codprod,
          codlocal: fila.codlocal,
          codemp: fila.codemp,
          userId,
          filaId: fila.id,
          tipo: tipoContagem,
          qtdContada: contado,
          tsInicio: fila.lockedAt || new Date(),
          tsFim: new Date(),
          snapshotId: snapshot?.id,
          esperadoNoMomento: decisao.saldoEsperadoAtual,
          divergencia: decisao.diferencaFinal,
          divergenciaPercent: percDivergencia,
          codigoBarrasLido,
          statusAnalise,
          notas:
            decisao.motivo === 'MOVIMENTACAO_EXPLICA_DIVERGENCIA'
              ? `Divergência contra snapshot explicada por movimentações Sankhya. Snapshot: ${esperado}. Esperado atual: ${decisao.saldoEsperadoAtual}.`
              : undefined,
        },
      });

      if (decisao.acao === 'CONCLUIDO') {
        // Contagem OK → finaliza item. Pode ser OK direto ou OK após conciliação Sankhya.
        await this.prisma.filaContagem.update({
          where: { id: fila.id },
          data: {
            status: FilaStatus.CONCLUIDO,
            lockedBy: null,
            lockedAt: null,
            contagensOk: { increment: 1 },
            ultimaContagemEm: new Date(),
            prioridadeBase: 0,
            prioridadeManual: 0,
            motivoPriorizacao: null,
            priorizadoPor: null,
          },
        });

        return {
          id: contagem.id,
          status: statusAnalise,
          esperado: decisao.saldoEsperadoAtual,
          contado,
          divergencia: decisao.diferencaFinal,
          percDivergencia,
          acao:
            decisao.motivo === 'MOVIMENTACAO_EXPLICA_DIVERGENCIA'
              ? 'CONCLUIDO_MOVIMENTACAO_SANKHYA'
              : 'CONCLUIDO',
          movimentacoes:
            decisao.motivo === 'MOVIMENTACAO_EXPLICA_DIVERGENCIA'
              ? movInfo.movimentacoes
              : undefined,
        };
      }

      const obsMovimentacoes = decisao.resumoMovimentacoes.temMovimentacao
        ? `Movimentações consultadas no Sankhya: ${decisao.resumoMovimentacoes.entradas} entrada(s), ${decisao.resumoMovimentacoes.saidas} saída(s), ${decisao.resumoMovimentacoes.reservas} reserva(s). Saldo esperado atual: ${decisao.saldoEsperadoAtual}.`
        : `Nenhuma movimentação detectada no período. Saldo esperado atual: ${decisao.saldoEsperadoAtual}.`;
      const sankhyaRessalva = await this.executarSegregacaoRessalvaSankhya({
        operacao: decisao.operacaoRessalva,
        fila,
        snapshot,
        origem: 'PRIMEIRA_CONTAGEM',
      });
      const obsRessalva =
        sankhyaRessalva.status === 'SYNCED'
          ? `Segregação registrada no Sankhya. NUNOTA: ${sankhyaRessalva.nunota}.`
          : sankhyaRessalva.status === 'ERROR'
            ? `Falha ao registrar segregação no Sankhya: ${sankhyaRessalva.error}.`
            : `Segregação ainda não efetivada no Sankhya (${sankhyaRessalva.status}).`;

      await this.prisma.divergencia.create({
        data: {
          contagemId: contagem.id,
          status: DivergenciaStatus.PENDENTE,
          severidade: percDivergencia > 10 ? 'ALTA' : 'MEDIA',
          observacoes: `${obsMovimentacoes} Divergência não explicada; item enviado para AUDITORIA. ${obsRessalva} Operação: ${this.descricaoOperacaoRessalva(decisao.operacaoRessalva)}.`,
          movimentacoes: {
            consultaSankhya: movInfo.movimentacoes,
            formula: {
              origemBase: baseContagem.origem,
              snapshotId: snapshot?.id || null,
              snapshotDataRef: snapshot?.dataRef || null,
              snapshotDesatualizado: baseContagem.snapshotDesatualizado,
              saldoSnapshot: esperado,
              reservadoAtual: baseContagem.reservadoAtual,
              entradas: decisao.resumoMovimentacoes.entradas,
              saidas: decisao.resumoMovimentacoes.saidas,
              reservas: decisao.resumoMovimentacoes.reservas,
              saldoEsperadoAtual: decisao.saldoEsperadoAtual,
            },
            fluxoInventario: {
              etapa: 'AUDITORIA',
              primeiraContagem: contado,
              diferencaPrimeiraContagem: decisao.diferencaFinal,
              tipoDivergencia: decisao.tipoDivergencia,
              codlocalPortal: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
              codlocalRessalva: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
              topMovimentacaoInterna: INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
              topEntradaTemporaria: INVENTARIO_TOPS.ENTRADA_TEMPORARIA,
              segregacaoRessalva: decisao.operacaoRessalva,
              sankhyaRessalva,
            },
          } as any,
          saldoAjustado: decisao.saldoEsperadoAtual,
          adjustStatus:
            sankhyaRessalva.status === 'SYNCED'
              ? 'RESSALVA_SYNCED'
              : sankhyaRessalva.status === 'ERROR'
                ? 'RESSALVA_ERROR'
                : null,
          adjustDate: sankhyaRessalva.status === 'SYNCED' ? new Date() : null,
          adjustNoteId:
            sankhyaRessalva.status === 'SYNCED'
              ? Number(sankhyaRessalva.nunota)
              : null,
        },
      });

      await this.prisma.filaContagem.update({
        where: { id: fila.id },
        data: {
          status: FilaStatus.BLOQUEADO_AUDITORIA,
          lockedBy: null,
          lockedAt: null,
          ultimaContagemEm: new Date(),
          motivoPriorizacao: 'AUDITORIA_RESSALVA_INVENTARIO',
        },
      });

      return {
        id: contagem.id,
        status: statusAnalise,
        esperado: decisao.saldoEsperadoAtual,
        contado,
        divergencia: decisao.diferencaFinal,
        percDivergencia,
        acao: 'AUDITORIA',
        operacaoRessalva: decisao.operacaoRessalva,
        movimentacoes: movInfo.movimentacoes,
      };
    }

    const divergenciaAberta = await this.buscarDivergenciaPendentePorFila(
      fila.id,
    );

    if (!divergenciaAberta) {
      throw new BadRequestException(
        'Recontagem sem auditoria pendente para este item',
      );
    }

    const primeiraContagem = Number(
      contagensAnteriores[0]?.qtdContada ??
        divergenciaAberta.contagem.qtdContada,
    );
    const saldoEsperadoAtual =
      divergenciaAberta.saldoAjustado != null
        ? Number(divergenciaAberta.saldoAjustado)
        : Number(contagensAnteriores[0]?.esperadoNoMomento ?? esperadoSnapshot);

    if (contagensAnteriores.length >= 2) {
      const usuario = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (
        !usuario ||
        (usuario.role !== UserRole.SUPERVISOR &&
          usuario.role !== UserRole.ADMIN)
      ) {
        throw new BadRequestException(
          'A terceira contagem deve ser executada pelo supervisor do estoque',
        );
      }
    }

    const diferencaRecontagem = contado - saldoEsperadoAtual;
    const percDivergenciaRecontagem = this.calcularPercentualDivergencia(
      diferencaRecontagem,
      saldoEsperadoAtual,
    );

    if (contagensAnteriores.length === 1) {
      const decisao = avaliarSegundaContagemInventario({
        primeiraContagem,
        segundaContagem: contado,
        saldoEsperadoAtual,
      });
      const contagem = await this.prisma.contagem.create({
        data: {
          codprod: fila.codprod,
          codlocal: fila.codlocal,
          codemp: fila.codemp,
          userId,
          filaId: fila.id,
          tipo: ContagemTipo.RECONTAGEM,
          qtdContada: contado,
          tsInicio: fila.lockedAt || new Date(),
          tsFim: new Date(),
          snapshotId: snapshot?.id,
          esperadoNoMomento: saldoEsperadoAtual,
          divergencia: diferencaRecontagem,
          divergenciaPercent: percDivergenciaRecontagem,
          codigoBarrasLido,
          statusAnalise:
            decisao.acao === 'FINALIZAR_SEGUNDA_CONTAGEM'
              ? StatusAnalise.RESOLVIDO
              : StatusAnalise.DIVERGENCIA_PENDENTE,
          notas:
            decisao.acao === 'FINALIZAR_SEGUNDA_CONTAGEM'
              ? contado === primeiraContagem
                ? 'Segunda contagem confirmou a primeira.'
                : 'Segunda contagem confirmou o saldo esperado. Ressalva deve ser estornada.'
              : 'Segunda contagem divergiu da primeira. Terceira contagem do supervisor requerida.',
        },
      });

      if (decisao.acao === 'FINALIZAR_SEGUNDA_CONTAGEM') {
        const finalizacao = await this.finalizarCicloInventario({
          divergencia: divergenciaAberta,
          filaId: fila.id,
          fila,
          snapshot,
          origem: 'SEGUNDA_CONTAGEM',
          contagemVencedora: decisao.contagemVencedora,
          diferencaFinal: decisao.diferencaFinal,
          operacaoFinal: decisao.operacaoFinal,
        });

        return {
          id: contagem.id,
          status: StatusAnalise.RESOLVIDO,
          esperado: saldoEsperadoAtual,
          contado,
          divergencia: decisao.diferencaFinal,
          percDivergencia: this.calcularPercentualDivergencia(
            decisao.diferencaFinal,
            saldoEsperadoAtual,
          ),
          acao: 'FINALIZADO_SEGUNDA_CONTAGEM',
          finalizacao,
        };
      }

      await this.prisma.filaContagem.update({
        where: { id: fila.id },
        data: {
          status: FilaStatus.PENDENTE,
          lockedBy: null,
          lockedAt: null,
          prioridadeManual: PRIORIDADE_AUDITORIA_RECONTAGEM,
          recontagens: { increment: 1 },
          ultimaContagemEm: new Date(),
          motivoPriorizacao: 'TERCEIRA_CONTAGEM_SUPERVISOR',
          priorizadoPor: null,
        },
      });

      await this.prisma.divergencia.update({
        where: { id: divergenciaAberta.id },
        data: {
          observacoes:
            'Segunda contagem divergiu da primeira. Terceira contagem obrigatória para SUPERVISOR.',
          movimentacoes: this.historicoInventario(
            divergenciaAberta.movimentacoes,
            {
              etapa: 'TERCEIRA_CONTAGEM_SUPERVISOR',
              primeiraContagem,
              segundaContagem: contado,
              segundaDiferenteDaPrimeira: true,
            },
          ) as any,
        },
      });

      return {
        id: contagem.id,
        status: StatusAnalise.DIVERGENCIA_PENDENTE,
        esperado: saldoEsperadoAtual,
        contado,
        divergencia: diferencaRecontagem,
        percDivergencia: percDivergenciaRecontagem,
        acao: 'TERCEIRA_CONTAGEM_SUPERVISOR',
      };
    }

    const decisaoTerceira = finalizarTerceiraContagemInventario({
      terceiraContagem: contado,
      saldoEsperadoAtual,
    });
    const contagem = await this.prisma.contagem.create({
      data: {
        codprod: fila.codprod,
        codlocal: fila.codlocal,
        codemp: fila.codemp,
        userId,
        filaId: fila.id,
        tipo: ContagemTipo.RECONTAGEM,
        qtdContada: contado,
        tsInicio: fila.lockedAt || new Date(),
        tsFim: new Date(),
        snapshotId: snapshot?.id,
        esperadoNoMomento: saldoEsperadoAtual,
        divergencia: decisaoTerceira.diferencaFinal,
        divergenciaPercent: this.calcularPercentualDivergencia(
          decisaoTerceira.diferencaFinal,
          saldoEsperadoAtual,
        ),
        codigoBarrasLido,
        statusAnalise: StatusAnalise.RESOLVIDO,
        notas: 'Terceira contagem do supervisor venceu o ciclo.',
      },
    });

    const finalizacao = await this.finalizarCicloInventario({
      divergencia: divergenciaAberta,
      filaId: fila.id,
      fila,
      snapshot,
      origem: 'TERCEIRA_CONTAGEM',
      contagemVencedora: decisaoTerceira.contagemVencedora,
      diferencaFinal: decisaoTerceira.diferencaFinal,
      operacaoFinal: decisaoTerceira.operacaoFinal,
    });

    return {
      id: contagem.id,
      status: StatusAnalise.RESOLVIDO,
      esperado: saldoEsperadoAtual,
      contado,
      divergencia: decisaoTerceira.diferencaFinal,
      percDivergencia: this.calcularPercentualDivergencia(
        decisaoTerceira.diferencaFinal,
        saldoEsperadoAtual,
      ),
      acao: 'FINALIZADO_TERCEIRA_CONTAGEM',
      finalizacao,
    };
  }

  // Marca item como "Não Achei" - libera o item sem inflar prioridade
  // Guarda: mesmo operador não pode marcar 2x no mesmo produto
  async naoAchei(userId: number, filaId: number) {
    const fila = await this.prisma.filaContagem.findUnique({
      where: { id: filaId },
    });

    if (!fila || fila.lockedBy !== userId) {
      throw new BadRequestException('Item não está travado para você');
    }

    // Guarda: mesmo operador não pode registrar "Não Achei" 2x no mesmo item
    if (fila.ultimoNaoAchouPor === userId) {
      throw new BadRequestException(
        'Você já marcou este item como "Não Achei" anteriormente. Outro operador precisa verificar.',
      );
    }

    const novoNaoAchouCount = fila.naoAchouCount + 1;
    // Se 2 operadores diferentes não acharam → bloqueia para auditoria
    const devBloquear = novoNaoAchouCount >= 2;

    if (devBloquear) {
      this.logger.log(
        `Produto ${fila.codprod}: 2x "Não Achei" por operadores diferentes → auditoria`,
      );

      // Criar contagem formal tipo NAO_ACHOU
      const snapshot = await this.prisma.snapshotEstoque.findFirst({
        where: {
          codprod: fila.codprod,
          codlocal: fila.codlocal,
          codemp: fila.codemp,
        },
        orderBy: { dataRef: 'desc' },
      });

      const contagem = await this.prisma.contagem.create({
        data: {
          codprod: fila.codprod,
          codlocal: fila.codlocal,
          codemp: fila.codemp,
          userId,
          filaId: fila.id,
          tipo: ContagemTipo.NAO_ACHOU,
          qtdContada: 0,
          tsInicio: fila.lockedAt || new Date(),
          tsFim: new Date(),
          snapshotId: snapshot?.id,
          esperadoNoMomento: snapshot ? Number(snapshot.saldoEspelho) : 0,
          divergencia: -(snapshot ? Number(snapshot.saldoEspelho) : 0),
          divergenciaPercent: 100,
          statusAnalise: StatusAnalise.DIVERGENCIA_PENDENTE,
        },
      });

      // Buscar movimentações para contexto
      const movInfo = await this.verificarMovimentacoes(
        fila.codprod,
        fila.codemp,
        fila.codlocal,
        snapshot?.dataRef,
        snapshot ? Number(snapshot.saldoEspelho) : 0,
      );

      // Criar divergência formal para o supervisor
      await this.prisma.divergencia.create({
        data: {
          contagemId: contagem.id,
          status: DivergenciaStatus.PENDENTE,
          severidade: 'ALTA',
          observacoes: `Produto não encontrado por 2 operadores diferentes. ${movInfo.temMovimentacao ? `Movimentações: ${movInfo.totalEntradas} entrada(s), ${movInfo.totalSaidas} saída(s), ${movInfo.totalReservas} reserva(s).` : 'Sem movimentações no período.'}`,
          movimentacoes: movInfo.movimentacoes as any,
          saldoAjustado: movInfo.saldoAjustado,
        },
      });
    }

    await this.prisma.filaContagem.update({
      where: { id: filaId },
      data: {
        status: devBloquear
          ? FilaStatus.BLOQUEADO_AUDITORIA
          : FilaStatus.PENDENTE,
        naoAchouCount: novoNaoAchouCount,
        ultimoNaoAchouPor: userId,
        lockedBy: null,
        lockedAt: null,
        // Zera prioridades para o item ir ao final da fila
        prioridadeManual: 0,
        prioridadeBase: 0,
      },
    });

    return {
      status: devBloquear
        ? FilaStatus.BLOQUEADO_AUDITORIA
        : FilaStatus.PENDENTE,
      naoAchouCount: novoNaoAchouCount,
      bloqueado: devBloquear,
    };
  }

  // Reportar Problema de Cadastro/Resale
  async reportarProblema(filaId: number, userId: number, motivo: string) {
    const filaItem = await this.prisma.filaContagem.findUnique({
      where: { id: filaId },
    });
    if (!filaItem) throw new NotFoundException('Item da fila não encontrado');

    // Garantir que o item está travado para o usuário que está reportando
    if (
      filaItem.lockedBy !== userId &&
      filaItem.status === FilaStatus.EM_CONTAGEM
    ) {
      throw new BadRequestException(
        'Item está travado para outro operador ou não está em contagem',
      );
    }

    // 1. Criar registro de contagem do tipo PROBLEMA
    await this.prisma.contagem.create({
      data: {
        filaId,
        userId,
        codprod: filaItem.codprod,
        codlocal: filaItem.codlocal,
        codemp: filaItem.codemp,
        tipo: ContagemTipo.PROBLEMA,
        tsInicio: new Date(),
        tsFim: new Date(),
        notas: motivo,
        statusAnalise: StatusAnalise.RESOLVIDO,
      },
    });

    // 2. Marcar item na fila como REPORTADO
    return this.prisma.filaContagem.update({
      where: { id: filaId },
      data: {
        status: FilaStatus.REPORTADO,
        lockedBy: null,
        lockedAt: null,
      },
    });
  }

  // Estatísticas diárias do operador (apenas contagens reais, não recontagens)
  async getStats(userId: number) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const contagensHoje = await this.prisma.contagem.findMany({
      where: {
        userId,
        tsFim: { gte: hoje },
        // Apenas contagens originais contam para a meta
        tipo: ContagemTipo.CONTAGEM,
      },
    });

    const meta = await this.prisma.metaUser.findFirst({
      where: { userId },
    });

    const total = contagensHoje.length;
    const acertos = contagensHoje.filter(
      (c) => c.statusAnalise === StatusAnalise.OK_AUTOMATICO,
    ).length;
    const metaDiaria = meta?.metaDiaria || 10;

    return {
      total,
      acertos,
      assertividade: total > 0 ? (acertos / total) * 100 : 0,
      metaDiaria,
      progresso: (total / metaDiaria) * 100,
      concluido: total >= metaDiaria,
    };
  }

  // Itens reportados com problema (visão do supervisor)
  async getItensReportados() {
    const itensReportados = await this.prisma.filaContagem.findMany({
      where: { status: FilaStatus.REPORTADO },
      orderBy: { updatedAt: 'desc' },
    });

    // Buscar os motivos registrados nas contagens do tipo PROBLEMA
    const resultado = await Promise.all(
      itensReportados.map(async (item) => {
        const contagemProblema = await this.prisma.contagem.findFirst({
          where: {
            filaId: item.id,
            tipo: ContagemTipo.PROBLEMA,
          },
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { nome: true } } },
        });
        return {
          id: item.id,
          codprod: item.codprod,
          descprod: item.descprod,
          marca: item.marca,
          motivo: contagemProblema?.notas || 'Sem motivo informado',
          reportadoPor: contagemProblema?.user?.nome || 'Desconhecido',
          reportadoEm: contagemProblema?.createdAt || item.updatedAt,
        };
      }),
    );

    return resultado;
  }

  // LISTAR DIVERGÊNCIAS (Para Supervisor)
  async getDivergencias() {
    return this.prisma.divergencia.findMany({
      where: {
        OR: [
          { status: DivergenciaStatus.PENDENTE },
          { adjustStatus: 'FINALIZACAO_ERROR' },
        ],
      },
      include: {
        contagem: {
          include: {
            user: { select: { nome: true } },
            snapshot: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async sincronizarRessalvaDivergencia(id: number) {
    const div = await this.prisma.divergencia.findUnique({
      where: { id },
      include: {
        contagem: {
          include: {
            fila: true,
            snapshot: true,
          },
        },
      },
    });

    if (!div) throw new NotFoundException('Divergência não encontrada');

    const fluxoInventario = (div.movimentacoes as any)?.fluxoInventario || {};
    const segregacaoRessalva = fluxoInventario.segregacaoRessalva as
      | OperacaoRessalvaInventario
      | undefined;
    const sankhyaAtual = fluxoInventario.sankhyaRessalva;

    if (!segregacaoRessalva) {
      throw new BadRequestException(
        'Divergência sem operação de ressalva calculada',
      );
    }

    if (sankhyaAtual?.status === 'SYNCED' && sankhyaAtual?.nunota) {
      return {
        status: 'JA_SINCRONIZADO',
        nunota: sankhyaAtual.nunota,
      };
    }

    const filaBase =
      div.contagem.fila ||
      ({
        codprod: div.contagem.codprod,
        codemp: div.contagem.codemp,
        codlocal: div.contagem.codlocal,
        descprod: `Produto ${div.contagem.codprod}`,
        controle: div.contagem.snapshot?.controle || ' ',
        unidade: div.contagem.snapshot?.unidade || 'UN',
      } as any);

    const resultado = await this.executarSegregacaoRessalvaSankhya({
      operacao: segregacaoRessalva,
      fila: filaBase,
      snapshot: div.contagem.snapshot,
      origem: 'SINCRONIZACAO_PENDENTE',
    });

    await this.prisma.divergencia.update({
      where: { id },
      data: {
        movimentacoes: this.historicoInventario(div.movimentacoes, {
          sankhyaRessalva: resultado,
        }) as any,
        observacoes:
          resultado.status === 'SYNCED'
            ? `${div.observacoes || ''} Ressalva sincronizada no Sankhya. NUNOTA: ${resultado.nunota}.`.trim()
            : `${div.observacoes || ''} Tentativa de sincronizar ressalva no Sankhya: ${resultado.status}${resultado.error ? ` - ${resultado.error}` : ''}.`.trim(),
        adjustStatus:
          resultado.status === 'SYNCED'
            ? 'RESSALVA_SYNCED'
            : resultado.status === 'ERROR'
              ? 'RESSALVA_ERROR'
              : div.adjustStatus,
        adjustDate: resultado.status === 'SYNCED' ? new Date() : div.adjustDate,
        adjustNoteId:
          resultado.status === 'SYNCED'
            ? Number(resultado.nunota)
            : div.adjustNoteId,
      },
    });

    return resultado;
  }

  async reprocessarFinalizacaoRessalvaDivergencia(id: number) {
    const div = await this.prisma.divergencia.findUnique({
      where: { id },
      include: {
        contagem: {
          include: {
            fila: true,
            snapshot: true,
          },
        },
      },
    });

    if (!div) throw new NotFoundException('Divergência não encontrada');

    const fluxoInventario = (div.movimentacoes as any)?.fluxoInventario || {};
    const operacoesOriginaisRaw = Array.isArray(
      fluxoInventario.operacoesFinalizacaoRessalva,
    )
      ? (fluxoInventario.operacoesFinalizacaoRessalva as OperacaoRessalvaInventario[])
      : fluxoInventario.finalizacaoRessalva
        ? [fluxoInventario.finalizacaoRessalva as OperacaoRessalvaInventario]
        : [];
    const operacoesOriginais = operacoesOriginaisRaw.map((operacao) =>
      this.normalizarOperacaoFinalizacaoRessalva(operacao),
    );

    if (operacoesOriginais.length === 0) {
      throw new BadRequestException(
        'Divergência sem operação de finalização em ressalva',
      );
    }

    const resultadosAnteriores = Array.isArray(
      fluxoInventario.sankhyaFinalizacoesRessalva,
    )
      ? fluxoInventario.sankhyaFinalizacoesRessalva
      : fluxoInventario.sankhyaFinalizacaoRessalva
        ? [fluxoInventario.sankhyaFinalizacaoRessalva]
        : [];
    const operacoesPendentes = this.filtrarOperacoesFinalizacaoPendentes(
      operacoesOriginais,
      resultadosAnteriores,
    );

    if (operacoesPendentes.length === 0) {
      return {
        status: 'JA_SINCRONIZADO',
        motivo: 'Todas as operações de finalização já foram sincronizadas',
      };
    }

    const filaBase =
      div.contagem.fila ||
      ({
        codprod: div.contagem.codprod,
        codemp: div.contagem.codemp,
        codlocal: div.contagem.codlocal,
        descprod: `Produto ${div.contagem.codprod}`,
        controle: div.contagem.snapshot?.controle || ' ',
        unidade: div.contagem.snapshot?.unidade || 'UN',
      } as any);
    const origem =
      fluxoInventario.origemFinalizacao === 'TERCEIRA_CONTAGEM'
        ? 'TERCEIRA_CONTAGEM'
        : 'SEGUNDA_CONTAGEM';
    const novosResultados =
      await this.executarOperacoesFinalizacaoRessalvaSankhya({
        operacoes: operacoesPendentes,
        fila: filaBase,
        snapshot: div.contagem.snapshot,
        origem,
      });
    const resultadosAtualizados = [...resultadosAnteriores];
    let indicePendente = 0;
    operacoesOriginais.forEach((_, index) => {
      if (resultadosAnteriores[index]?.status === 'SYNCED') return;
      resultadosAtualizados[index] = novosResultados[indicePendente++];
    });
    const houveErro = resultadosAtualizados.some(
      (resultado) => resultado?.status === 'ERROR',
    );
    const houveSync = resultadosAtualizados.some(
      (resultado) => resultado?.status === 'SYNCED',
    );
    const ultimaNota = [...resultadosAtualizados]
      .reverse()
      .find((resultado) => resultado?.status === 'SYNCED' && resultado.nunota);
    const diferencaFinal = Number(fluxoInventario.diferencaFinal || 0);
    const deveAjustar = Math.abs(diferencaFinal) > 0;
    const adjustStatus =
      houveSync && !houveErro
        ? 'FINALIZACAO_SYNCED'
        : houveErro
          ? 'FINALIZACAO_ERROR'
          : 'LOCAL_FINALIZADO';

    await this.prisma.divergencia.update({
      where: { id },
      data: {
        status: houveErro
          ? DivergenciaStatus.PENDENTE
          : deveAjustar
            ? DivergenciaStatus.ACEITO
            : DivergenciaStatus.CONCLUIDO,
        decisao: houveErro
          ? Decisao.RECONTAR
          : deveAjustar
            ? Decisao.AJUSTAR
            : Decisao.FINALIZAR_ANALISE,
        adjustStatus,
        adjustDate: new Date(),
        adjustNoteId: ultimaNota ? Number(ultimaNota.nunota) : div.adjustNoteId,
        observacoes: houveErro
          ? `${div.observacoes || ''} Reprocessamento da finalização Sankhya falhou; permanece pendente.`.trim()
          : `${div.observacoes || ''} Finalização em ressalva reprocessada no Sankhya.`.trim(),
        movimentacoes: this.historicoInventario(div.movimentacoes, {
          etapa: houveErro ? 'FINALIZACAO_RESSALVA_ERRO' : 'FINALIZADO',
          sankhyaFinalizacaoRessalva:
            resultadosAtualizados[resultadosAtualizados.length - 1],
          sankhyaFinalizacoesRessalva: resultadosAtualizados,
          reprocessamentoFinalizacaoRessalvaEm: new Date().toISOString(),
        }) as any,
      },
    });

    await this.prisma.filaContagem.update({
      where: { id: div.contagem.filaId },
      data: houveErro
        ? {
            status: FilaStatus.BLOQUEADO_AUDITORIA,
            lockedBy: null,
            lockedAt: null,
            prioridadeManual: PRIORIDADE_AUDITORIA_RECONTAGEM,
            motivoPriorizacao: 'FINALIZACAO_RESSALVA_ERRO',
            priorizadoPor: null,
          }
        : {
            status: FilaStatus.CONCLUIDO,
            lockedBy: null,
            lockedAt: null,
            prioridadeBase: 0,
            prioridadeManual: 0,
            motivoPriorizacao: null,
            priorizadoPor: null,
            recontagens: 0,
          },
    });

    return {
      status: houveErro ? 'FINALIZACAO_ERROR' : 'FINALIZACAO_SYNCED',
      operacoesReprocessadas: operacoesPendentes.length,
      resultados: novosResultados,
    };
  }

  // TRATAR DIVERGÊNCIA (Aprovar, Recontar ou Finalizar Análise)
  async tratarDivergencia(
    id: number,
    acao: 'APROVAR' | 'RECONTAR' | 'FINALIZAR_ANALISE',
    observacao?: string,
    operadorId?: number | null,
  ) {
    const div = await this.prisma.divergencia.findUnique({
      where: { id },
      include: { contagem: true },
    });

    if (!div) throw new NotFoundException('Divergência não encontrada');

    if (acao === 'APROVAR') {
      throw new BadRequestException(
        'Nova regra de inventário: divergência em AUDITORIA só pode ser finalizada após 2ª contagem confirmada ou 3ª contagem do supervisor.',
      );
    } else if (acao === 'FINALIZAR_ANALISE') {
      // Item vai para o final da fila e aguarda próximo snapshot
      await this.prisma.filaContagem.update({
        where: { id: div.contagem.filaId },
        data: {
          status: FilaStatus.PENDENTE,
          prioridadeManual: 0,
          prioridadeBase: 0,
          naoAchouCount: 0,
          ultimoNaoAchouPor: null,
          recontagens: 0,
        },
      });
      await this.prisma.divergencia.update({
        where: { id },
        data: {
          status: DivergenciaStatus.CONCLUIDO,
          decisao: Decisao.FINALIZAR_ANALISE,
          observacoes:
            observacao || 'Análise finalizada. Aguardando próximo snapshot.',
        },
      });
      return { message: 'Análise finalizada. Item retorna ao final da fila.' };
    } else {
      // RECONTAR — supervisor solicita recontagem manual
      await this.prisma.filaContagem.update({
        where: { id: div.contagem.filaId },
        data: {
          prioridadeManual: PRIORIDADE_AUDITORIA_RECONTAGEM,
          status: FilaStatus.PENDENTE,
          lockedBy: null,
          lockedAt: null,
          priorizadoPor: operadorId || null,
          motivoPriorizacao: operadorId
            ? 'SEGUNDA_CONTAGEM_OPERADOR_INDICADO'
            : 'SEGUNDA_CONTAGEM_ALEATORIA',
        },
      });
      await this.prisma.divergencia.update({
        where: { id },
        data: {
          status: DivergenciaStatus.PENDENTE,
          decisao: Decisao.RECONTAR,
          observacoes:
            observacao ||
            (operadorId
              ? `Supervisor direcionou segunda contagem para operador ${operadorId}.`
              : 'Supervisor liberou segunda contagem para qualquer operador.'),
          movimentacoes: this.historicoInventario(div.movimentacoes, {
            etapa: 'SEGUNDA_CONTAGEM',
            operadorIndicado: operadorId || null,
          }) as any,
        },
      });
      return {
        message: operadorId
          ? 'Item enviado para segunda contagem com operador indicado'
          : 'Item enviado para segunda contagem aleatória',
        operadorId: operadorId || null,
      };
    }
  }

  // ESTATÍSTICAS PARA O SUPERVISOR (Visão de Gestão)
  async getSupervisorStats() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const contagens = await this.prisma.contagem.findMany({
      where: { tsFim: { gte: hoje } },
      include: {
        snapshot: true,
        user: { select: { id: true, nome: true } },
      },
    });

    const pendentes = await this.prisma.divergencia.count({
      where: { status: 'PENDENTE' },
    });

    let valorFalta = 0;
    let valorSobra = 0;
    const operadoresStats: Record<
      number,
      { nome: string; total: number; acertos: number }
    > = {};

    contagens.forEach((c) => {
      const custo = c.snapshot ? Number(c.snapshot.custoEspelho) : 0;
      const diff = Number(c.divergencia || 0);

      if (diff > 0) valorSobra += diff * custo;
      if (diff < 0) valorFalta += Math.abs(diff * custo);

      if (!operadoresStats[c.userId]) {
        operadoresStats[c.userId] = { nome: c.user.nome, total: 0, acertos: 0 };
      }
      operadoresStats[c.userId].total++;
      if (c.statusAnalise === StatusAnalise.OK_AUTOMATICO) {
        operadoresStats[c.userId].acertos++;
      }
    });

    // Meta Global configurada no sistema
    const configMeta = await this.prisma.configuracao.findFirst({
      where: { chave: 'META_GLOBAL_DIARIA' },
    });
    const metaGlobalDiaria = configMeta ? Number(configMeta.valor) : 100;

    // Divisão da meta entre operadores que TRABALHARAM hoje
    const numOperadoresAtivos = Object.keys(operadoresStats).length || 1;
    const metaPorOperador = Math.ceil(metaGlobalDiaria / numOperadoresAtivos);

    const rankingOperadores = Object.values(operadoresStats)
      .map((stats) => ({
        nome: stats.nome,
        assertividade:
          stats.total > 0 ? (stats.acertos / stats.total) * 100 : 0,
        total: stats.total,
        metaIndividual: metaPorOperador, // Mostra a parcela dele
      }))
      .sort((a, b) => b.assertividade - a.assertividade);

    return {
      resumo: {
        totalContado: contagens.length,
        divergenciasPendentes: pendentes,
        valorEmFalta: valorFalta,
        valorEmSobra: valorSobra,
        assertividadeGlobal:
          contagens.length > 0
            ? (contagens.filter(
                (c) => c.statusAnalise === StatusAnalise.OK_AUTOMATICO,
              ).length /
                contagens.length) *
              100
            : 0,
        metaGlobalDiaria,
        progressoGlobal: (contagens.length / metaGlobalDiaria) * 100,
      },
      rankingOperadores,
    };
  }

  // Gerenciar Meta Global
  async updateMetaGlobal(valor: number) {
    return this.prisma.configuracao.upsert({
      where: { chave: 'META_GLOBAL_DIARIA' },
      update: { valor: valor.toString() },
      create: {
        chave: 'META_GLOBAL_DIARIA',
        valor: valor.toString(),
        descricao: 'Meta diária global da equipe',
      },
    });
  }

  async buscarCopiaEstoqueSankhya(
    params: BuscarCopiaEstoqueParams,
  ): Promise<CopiaEstoqueItem[]> {
    const codemp = this.parsePositiveInt(params.codemp, 1);
    const codlocal = this.parsePositiveInt(
      params.codlocal,
      INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
    );
    const sequencia = this.parsePositiveInt(params.sequencia, 1);
    const busca = String(params.busca || '').trim();

    if (
      process.env.INVENTARIO_LOCAL_VALIDATION === 'true' &&
      !this.copiaDirecionadaSankhyaEnabled()
    ) {
      return this.buscarCopiaEstoqueLocal({ ...params, codemp, codlocal });
    }

    const dataFiltro = this.buildOracleDateFilter(params.data);
    const filtrosBusca = this.buildOracleSearchFilter(busca);
    const sql = `
      SELECT
        CTE.CODEMP,
        CTE.CODPROD,
        PRO.DESCRPROD,
        CTE.CODLOCAL,
        LOC.DESCRLOCAL,
        CTE.CONTROLE,
        CTE.CODVOL,
        COALESCE(
          NULLIF(TRIM(PRO.AD_CODBARRAESTOQUE), ''),
          (
            SELECT MAX(BAR.CODBARRA)
            FROM TGFBAR BAR
            WHERE BAR.CODPROD = CTE.CODPROD
          ),
          ''
        ) AS CODBARRA,
        CTE.QTDEST AS QTD_COPIADA,
        TO_CHAR(CTE.DTCONTAGEM, 'YYYY-MM-DD') AS DATA_COPIA
      FROM TGFCTE CTE
      INNER JOIN TGFPRO PRO
        ON PRO.CODPROD = CTE.CODPROD
      LEFT JOIN TGFLOC LOC
        ON LOC.CODLOCAL = CTE.CODLOCAL
      WHERE CTE.CODEMP = ${codemp}
        AND CTE.CODLOCAL = ${codlocal}
        AND CTE.SEQUENCIA = ${sequencia}
        AND TRUNC(CTE.DTCONTAGEM) = ${dataFiltro}
        ${filtrosBusca}
      ORDER BY PRO.DESCRPROD
    `;

    const rows = await this.sankhyaClient.executeQuery(sql);
    return rows.map((row) =>
      this.normalizarItemCopiaEstoque(row, codemp, codlocal),
    );
  }

  async direcionarContagem(body: DirecionarContagemBody, supervisorId: number) {
    const operadorId = this.parsePositiveInt(body.operadorId, 0);
    if (!operadorId) {
      throw new BadRequestException(
        'Informe o operador da contagem direcionada',
      );
    }

    const operador = await this.prisma.user.findUnique({
      where: { id: operadorId },
      select: { id: true, nome: true, login: true, role: true, ativo: true },
    });

    if (!operador || !operador.ativo || operador.role !== UserRole.OPERADOR) {
      throw new BadRequestException('Operador inválido ou inativo');
    }

    const itens = this.deduplicarItensDirecionados(body.itens || []);
    if (itens.length === 0) {
      throw new BadRequestException('Selecione ao menos um produto');
    }

    const prioridade = Math.max(
      1,
      this.parsePositiveInt(body.prioridade, PRIORIDADE_CONTAGEM_DIRECIONADA),
    );
    const motivoTexto = String(body.motivo || '').trim();
    const motivoPriorizacao = motivoTexto
      ? `CONTAGEM_DIRECIONADA: ${motivoTexto.slice(0, 160)}`
      : 'CONTAGEM_DIRECIONADA';
    const direcionados: Array<{ codprod: number; filaId: number }> = [];
    const conflitos: Array<{ codprod: number; motivo: string }> = [];

    for (const item of itens) {
      const codprod = this.parsePositiveInt(item.codprod, 0);
      const codemp = this.parsePositiveInt(item.codemp, 1);
      const codlocal = this.parsePositiveInt(
        item.codlocal,
        INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
      );

      if (!codprod) {
        conflitos.push({
          codprod: Number(item.codprod) || 0,
          motivo: 'Produto inválido',
        });
        continue;
      }

      const fila = await this.prisma.filaContagem.findUnique({
        where: {
          codprod_codlocal_codemp: {
            codprod,
            codlocal,
            codemp,
          },
        },
      });

      if (fila?.status === FilaStatus.EM_CONTAGEM) {
        conflitos.push({
          codprod,
          motivo: 'Item já está em contagem no momento',
        });
        continue;
      }

      if (
        fila?.status === FilaStatus.BLOQUEADO_AUDITORIA ||
        fila?.status === FilaStatus.REPORTADO
      ) {
        conflitos.push({
          codprod,
          motivo: 'Item está em auditoria ou reportado',
        });
        continue;
      }

      if (fila) {
        const atualizado = await this.prisma.filaContagem.update({
          where: { id: fila.id },
          data: {
            status: FilaStatus.PENDENTE,
            prioridadeManual: prioridade,
            motivoPriorizacao,
            priorizadoPor: operadorId,
            codigoBarrasCadastro:
              this.obterCodigoBarrasCadastro(item.codigoBarrasCadastro) ||
              this.obterCodigoBarrasCadastro(
                (fila as any).codigoBarrasCadastro,
              ),
            lockedBy: null,
            lockedAt: null,
            ultimoEvento: new Date(),
          },
        });
        direcionados.push({ codprod, filaId: atualizado.id });
        continue;
      }

      const snapshot = await this.prisma.snapshotEstoque.findFirst({
        where: { codprod, codlocal, codemp },
        orderBy: { dataRef: 'desc' },
      });

      const criado = await this.prisma.filaContagem.create({
        data: {
          codprod,
          codlocal,
          codemp,
          descprod:
            String(item.descprod || snapshot?.descprod || '').trim() ||
            `Produto ${codprod}`,
          marca: String(item.marca || snapshot?.marca || '').trim(),
          controle:
            String(item.controle || snapshot?.controle || ' ').trim() || ' ',
          codigoBarrasCadastro:
            this.obterCodigoBarrasCadastro(item.codigoBarrasCadastro) ||
            this.obterCodigoBarrasCadastro(snapshot?.codigoBarrasCadastro),
          unidade:
            String(item.codvol || snapshot?.unidade || 'UN').trim() || 'UN',
          prioridadeBase: 0,
          prioridadeManual: prioridade,
          motivoPriorizacao,
          priorizadoPor: operadorId,
          status: FilaStatus.PENDENTE,
          ultimoEvento: new Date(),
        },
      });
      direcionados.push({ codprod, filaId: criado.id });
    }

    this.logger.log(
      `[Contagem Direcionada] Supervisor ${supervisorId} direcionou ${direcionados.length}/${itens.length} item(ns) para ${operador.nome}.`,
    );

    return {
      operador: {
        id: operador.id,
        nome: operador.nome,
        login: operador.login,
      },
      totalSolicitado: itens.length,
      direcionados,
      conflitos,
      prioridadeManual: prioridade,
      motivoPriorizacao,
    };
  }

  private async buscarCopiaEstoqueLocal(
    params: BuscarCopiaEstoqueParams,
  ): Promise<CopiaEstoqueItem[]> {
    const codemp = this.parsePositiveInt(params.codemp, 1);
    const codlocal = this.parsePositiveInt(
      params.codlocal,
      INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
    );
    const busca = String(params.busca || '').trim();
    const whereBusca = this.buildPrismaSearchFilter(busca);
    const filaWhere: any = {
      codemp,
      codlocal,
      ...whereBusca,
    };

    const filaItems = await this.prisma.filaContagem.findMany({
      where: filaWhere,
      orderBy: [{ descprod: 'asc' }, { codprod: 'asc' }],
      take: 500,
    });

    if (filaItems.length > 0) {
      const snapshots = await this.prisma.snapshotEstoque.findMany({
        where: {
          codemp,
          codlocal,
          codprod: { in: filaItems.map((item) => item.codprod) },
        },
        orderBy: [{ dataRef: 'desc' }],
      });
      const snapshotsPorProduto = new Map<number, any>();
      for (const snapshot of snapshots) {
        if (!snapshotsPorProduto.has(snapshot.codprod)) {
          snapshotsPorProduto.set(snapshot.codprod, snapshot);
        }
      }

      return filaItems.map((item) => {
        const snapshot = snapshotsPorProduto.get(item.codprod);
        return {
          codprod: item.codprod,
          descprod: item.descprod,
          codemp: item.codemp,
          codlocal: item.codlocal,
          descrlocal:
            item.codlocal === INVENTARIO_LOCAIS.ESTOQUE_PORTAL
              ? 'PORTAL'
              : null,
          controle: item.controle,
          codvol: item.unidade,
          codigoBarrasCadastro:
            this.obterCodigoBarrasCadastro(
              (item as any).codigoBarrasCadastro,
            ) || this.obterCodigoBarrasCadastro(snapshot?.codigoBarrasCadastro),
          qtdCopiada: Number(snapshot?.saldoEspelho || 0),
          dataCopia: snapshot?.dataRef
            ? new Date(snapshot.dataRef).toISOString().slice(0, 10)
            : params.data || null,
          statusFila: item.status,
          priorizadoPor: item.priorizadoPor,
        };
      });
    }

    const snapshotWhere: any = {
      codemp,
      codlocal,
      ...whereBusca,
    };
    const dataRef = this.parseLocalDate(params.data);
    if (dataRef) snapshotWhere.dataRef = dataRef;

    const snapshots = await this.prisma.snapshotEstoque.findMany({
      where: snapshotWhere,
      orderBy: [{ dataRef: 'desc' }, { descprod: 'asc' }],
      take: 500,
    });
    const vistos = new Set<string>();

    return snapshots
      .filter((snapshot) => {
        const key = `${snapshot.codemp}-${snapshot.codlocal}-${snapshot.codprod}`;
        if (vistos.has(key)) return false;
        vistos.add(key);
        return true;
      })
      .map((snapshot) => ({
        codprod: snapshot.codprod,
        descprod: snapshot.descprod,
        codemp: snapshot.codemp,
        codlocal: snapshot.codlocal,
        descrlocal:
          snapshot.codlocal === INVENTARIO_LOCAIS.ESTOQUE_PORTAL
            ? 'PORTAL'
            : null,
        controle: snapshot.controle,
        codvol: snapshot.unidade,
        codigoBarrasCadastro: this.obterCodigoBarrasCadastro(
          snapshot.codigoBarrasCadastro,
        ),
        qtdCopiada: Number(snapshot.saldoEspelho || 0),
        dataCopia: snapshot.dataRef
          ? new Date(snapshot.dataRef).toISOString().slice(0, 10)
          : params.data || null,
      }));
  }

  private normalizarItemCopiaEstoque(
    row: any,
    codempPadrao: number,
    codlocalPadrao: number,
  ): CopiaEstoqueItem {
    return {
      codprod: this.toNumber(row.CODPROD ?? row.codprod),
      descprod: String(row.DESCRPROD ?? row.descprod ?? '').trim(),
      codemp: this.toNumber(row.CODEMP ?? row.codemp, codempPadrao),
      codlocal: this.toNumber(row.CODLOCAL ?? row.codlocal, codlocalPadrao),
      descrlocal: row.DESCRLOCAL ?? row.descrlocal ?? null,
      controle: row.CONTROLE ?? row.controle ?? null,
      codvol: row.CODVOL ?? row.codvol ?? null,
      codigoBarrasCadastro: this.obterCodigoBarrasCadastro(
        row.CODBARRA ?? row.codigoBarrasCadastro,
      ),
      qtdCopiada: this.toNumber(row.QTD_COPIADA ?? row.qtdCopiada),
      dataCopia: row.DATA_COPIA ?? row.dataCopia ?? null,
    };
  }

  private deduplicarItensDirecionados(
    itens: DirecionarContagemBody['itens'],
  ): DirecionarContagemBody['itens'] {
    const mapa = new Map<string, DirecionarContagemBody['itens'][number]>();
    for (const item of itens) {
      const codprod = this.parsePositiveInt(item.codprod, 0);
      const codemp = this.parsePositiveInt(item.codemp, 1);
      const codlocal = this.parsePositiveInt(
        item.codlocal,
        INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
      );
      if (!codprod) continue;
      mapa.set(`${codemp}-${codlocal}-${codprod}`, {
        ...item,
        codprod,
        codemp,
        codlocal,
      });
    }
    return Array.from(mapa.values());
  }

  private parsePositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  private toNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number')
      return Number.isFinite(value) ? value : fallback;
    if (typeof value === 'string') {
      const normalized = value.trim().replace(/\./g, '').replace(',', '.');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
  }

  private buildOracleDateFilter(data?: string): string {
    const match = String(data || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return 'TRUNC(SYSDATE)';

    const [, ano, mes, dia] = match;
    return `TO_DATE('${dia}/${mes}/${ano}', 'DD/MM/YYYY')`;
  }

  private buildOracleSearchFilter(busca: string): string {
    if (!busca) return '';

    const termo = busca.toUpperCase().replace(/'/g, "''");
    const codprod = Number(busca);
    const filtroCodigo =
      Number.isInteger(codprod) && codprod > 0
        ? ` OR CTE.CODPROD = ${codprod}`
        : '';

    return `AND (UPPER(PRO.DESCRPROD) LIKE '%${termo}%'${filtroCodigo})`;
  }

  private buildPrismaSearchFilter(busca: string): Record<string, any> {
    if (!busca) return {};

    const codprod = Number(busca);
    const or: any[] = [
      {
        descprod: {
          contains: busca,
          mode: 'insensitive',
        },
      },
    ];

    if (Number.isInteger(codprod) && codprod > 0) {
      or.push({ codprod });
    }

    return { OR: or };
  }

  private parseLocalDate(data?: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) return null;
    return new Date(`${data}T00:00:00`);
  }

  // LISTAR TODOS OS OPERADORES E SUAS METAS
  async getMetas() {
    return this.prisma.user.findMany({
      where: { role: UserRole.OPERADOR },
      select: {
        id: true,
        nome: true,
        metas: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  // LISTAR TODOS OS OPERADORES
  async getOperadores() {
    return this.prisma.user.findMany({
      where: { role: UserRole.OPERADOR },
      select: { id: true, nome: true, login: true },
    });
  }

  // LISTAR A FILA DE CONTAGEM ATUAL
  async getFila(status?: FilaStatus) {
    return this.prisma.filaContagem.findMany({
      where: status ? { status } : {},
      include: {
        priorizador: { select: { id: true, nome: true, login: true } },
      },
      orderBy: [
        { prioridadeManual: 'desc' },
        { prioridadeBase: 'desc' },
        { marca: 'asc' },
        { codprod: 'asc' },
      ],
      take: 5000, // Aumentado para mostrar todos os itens (ex: 4000 do Sankhya)
    });
  }

  private verificarMovimentacoesLocais(codprod: number, saldoSnapshot: number) {
    const movimentacoesPorProduto: Record<number, any[]> = {
      900002: [
        {
          TIPMOV: 'S',
          QTDNEG: 10,
          DESCROPER: 'Saída local simulada para validação',
          DTMOV: new Date().toISOString(),
        },
        {
          ORIGEM: 'RESERVA',
          QTDNEG: 2,
          DESCROPER: 'Reserva local simulada para validação',
          DTMOV: new Date().toISOString(),
        },
      ],
    };

    const movimentacoes = movimentacoesPorProduto[codprod] || [];
    let ajuste = 0;
    let totalEntradas = 0;
    let totalSaidas = 0;
    let totalReservas = 0;

    for (const mov of movimentacoes) {
      const qtd = Number(mov.QTDNEG || 0);
      if (mov.ORIGEM === 'RESERVA') {
        totalReservas++;
        ajuste -= qtd;
      } else if (mov.TIPMOV === 'E') {
        totalEntradas++;
        ajuste += qtd;
      } else if (mov.TIPMOV === 'S') {
        totalSaidas++;
        ajuste -= qtd;
      }
    }

    return {
      movimentacoes,
      saldoAjustado: saldoSnapshot + ajuste,
      temMovimentacao: movimentacoes.length > 0,
      totalEntradas,
      totalSaidas,
      totalReservas,
    };
  }

  // === MÉTODO AUXILIAR: Verificar movimentações no Sankhya ===
  // Busca entradas, saídas e reservas entre a data do snapshot e agora
  // Calcula o saldo ajustado para dar contexto ao supervisor
  private async verificarMovimentacoes(
    codprod: number,
    codemp: number,
    codlocal: number,
    dataSnapshot?: Date | null,
    saldoSnapshot = 0,
  ): Promise<{
    movimentacoes: any[];
    saldoAjustado: number;
    temMovimentacao: boolean;
    totalEntradas: number;
    totalSaidas: number;
    totalReservas: number;
  }> {
    const resultado = {
      movimentacoes: [] as any[],
      saldoAjustado: saldoSnapshot,
      temMovimentacao: false,
      totalEntradas: 0,
      totalSaidas: 0,
      totalReservas: 0,
    };

    if (process.env.INVENTARIO_LOCAL_VALIDATION === 'true') {
      return this.verificarMovimentacoesLocais(codprod, saldoSnapshot);
    }

    try {
      // Formatar datas para o Sankhya (DD/MM/YYYY)
      const formatDate = (d: Date) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      };

      const dataInicio = dataSnapshot
        ? formatDate(new Date(dataSnapshot))
        : formatDate(new Date());
      const dataFim = formatDate(new Date());

      const movs = await this.sankhyaClient.getMovimentacoes(
        codprod,
        codemp,
        codlocal,
        dataInicio,
        dataFim,
      );

      if (movs && movs.length > 0) {
        resultado.movimentacoes = movs;
        resultado.temMovimentacao = true;

        // Calcular saldo ajustado pelas movimentações
        let ajuste = 0;
        for (const mov of movs) {
          if (mov.ORIGEM === 'RESERVA') {
            resultado.totalReservas++;
            // Reserva = estoque reservado, subtrai do disponível fisicamente
            ajuste -= Number(mov.QTDNEG);
          } else if (mov.TIPMOV === 'E') {
            resultado.totalEntradas++;
            ajuste += Number(mov.QTDNEG);
          } else if (mov.TIPMOV === 'S') {
            resultado.totalSaidas++;
            ajuste -= Number(mov.QTDNEG);
          }
        }
        resultado.saldoAjustado = saldoSnapshot + ajuste;
      }
    } catch (error: any) {
      this.logger.warn(
        `Falha ao buscar movimentações para produto ${codprod}: ${error.message}`,
      );
    }

    return resultado;
  }

  // EXPORTAR DIVERGÊNCIAS (Dados brutos para CSV)
  async getDivergenciasExport() {
    const divs = await this.prisma.divergencia.findMany({
      include: {
        contagem: {
          include: {
            user: { select: { nome: true } },
            snapshot: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return divs.map((d) => ({
      ID: d.id,
      Data: d.createdAt.toISOString(),
      CodProd: d.contagem.codprod,
      Produto: d.contagem.snapshot?.descprod || 'N/A',
      Marca: d.contagem.snapshot?.marca || 'N/A',
      Operador: d.contagem.user.nome,
      QtdContada: d.contagem.qtdContada,
      Esperado: d.contagem.esperadoNoMomento,
      Divergencia: d.contagem.divergencia,
      Percent: d.contagem.divergenciaPercent,
      Status: d.status,
      Severidade: d.severidade,
      SaldoAjustadoSankhya: d.saldoAjustado || 'N/A',
    }));
  }

  // EXPORTAR PRODUTIVIDADE (Dados pdr operador/hora)
  async getProdutividadeExport() {
    const contagens = await this.prisma.contagem.findMany({
      where: { tsFim: { not: null } }, // Apenas contagens finalizadas
      include: {
        user: { select: { nome: true } },
      },
      orderBy: { tsFim: 'desc' },
    });

    return contagens.map((c) => ({
      ID: c.id,
      Data: c.tsFim!.toISOString(),
      Operador: c.user.nome,
      CodProd: c.codprod,
      QtdContada: c.qtdContada,
      TempoSegundos: c.tsInicio
        ? Math.floor((c.tsFim!.getTime() - c.tsInicio.getTime()) / 1000)
        : 0,
      Status: c.statusAnalise,
    }));
  }
}
