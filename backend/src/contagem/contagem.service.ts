// Serviço de Contagem - Lógica de Fila, Registro e Inteligência de Divergência
import { Injectable, Logger, Inject, forwardRef, NotFoundException, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { SankhyaClient } from '../sankhya/sankhya.client';
import { RegistrarContagemDto } from './dto/registrar-contagem.dto';
import { FilaStatus, ContagemTipo, StatusAnalise, DivergenciaStatus, Decisao, UserRole, FilaContagem } from '@prisma/client';

// Threshold de divergência para disparo de recontagem automática
const RECOUNT_THRESHOLD_PERCENT = 5;

@Injectable()
export class ContagemService {
    private readonly logger = new Logger(ContagemService.name);

    constructor(
        private prisma: PrismaService,
        private sankhyaClient: SankhyaClient,
    ) { }

    // Busca o próximo item disponível na fila e aplica um lock (trava)
    async buscaProximo(userId: number) {
        // 1. Verificar se o usuário JÁ tem algo travado (se não finalizou o anterior)
        const lockedItem = await this.prisma.filaContagem.findFirst({
            where: {
                lockedBy: userId,
                status: FilaStatus.EM_CONTAGEM,
            },
        });

        if (lockedItem) return lockedItem;

        // 2. Mapear POSSE (Quem é dono de qual Agrupador no momento?)
        const timeframe = new Date();
        timeframe.setMinutes(timeframe.getMinutes() - 15);

        // A) Locks Ativos
        const locksAtivos = await this.prisma.filaContagem.findMany({
            where: {
                status: FilaStatus.EM_CONTAGEM,
                lockedBy: { not: null }
            },
            select: { marca: true, controle: true, lockedBy: true }
        });

        // B) Histórico Recente
        const historicoRecente = await this.prisma.contagem.findMany({
            where: {
                createdAt: { gte: timeframe }
            },
            select: {
                userId: true,
                fila: {
                    select: { marca: true, controle: true }
                }
            },
            orderBy: { createdAt: 'asc' }
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

        const processItem = (userId: number, marca: string | null, controle: string | null) => {
            const key = getAgrupador(marca, controle);
            if (key) posseAgrupador.set(key, userId);
        };

        historicoRecente.forEach(item => {
            processItem(item.userId, item.fila?.marca || null, item.fila?.controle || null);
        });

        locksAtivos.forEach(item => {
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
        const meuUltimo = meusAgrupadores.length > 0 ? meusAgrupadores[meusAgrupadores.length - 1] : null;

        logDebug(`Usuário ${userId}. Ocupados (Unified): ${JSON.stringify(agrupadoresOutros)}. Minha Pref: ${meuUltimo}`);

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
                        { marca: 'CONTROLE', controle: meuUltimo }
                    ],
                    contagens: { none: { userId: userId } }
                },
                orderBy: [
                    { prioridadeManual: 'desc' },
                    { prioridadeBase: 'desc' },
                    { updatedAt: 'asc' }
                ]
            });
            if (proximo) logDebug(`-> A: Continuidade (${proximo.marca} ${proximo.controle})`);
        }

        // TENTATIVA B: Buscar algo LIVRE (Nem Marca nem Controle ocupados por outros)
        if (!proximo) {
            proximo = await this.prisma.filaContagem.findFirst({
                where: {
                    status: FilaStatus.PENDENTE,
                    lockedBy: null,
                    contagens: { none: { userId: userId } },
                    AND: [
                        // Não pode ser marca que está ocupada
                        { marca: { notIn: agrupadoresOutros } },
                        // E se for CONTROLE, o controle não pode ser um dos ocupados
                        {
                            OR: [
                                { marca: { not: 'CONTROLE' } },
                                { marca: 'CONTROLE', controle: { notIn: agrupadoresOutros } }
                            ]
                        }
                    ]
                },
                orderBy: [
                    { prioridadeManual: 'desc' },
                    { prioridadeBase: 'desc' },
                    { updatedAt: 'asc' },
                    { marca: 'asc' }
                ]
            });
            if (proximo) logDebug(`-> B: Isolado (${proximo.marca} ${proximo.controle})`);
        }

        // TENTATIVA C: Fallback
        if (!proximo) {
            this.logger.warn(`-> Fallback: Pegando qualquer item.`);
            proximo = await this.prisma.filaContagem.findFirst({
                where: {
                    status: FilaStatus.PENDENTE,
                    lockedBy: null,
                    contagens: { none: { userId: userId } }
                },
                orderBy: [
                    { prioridadeManual: 'desc' },
                    { prioridadeBase: 'desc' },
                    { updatedAt: 'asc' }
                ]
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

    // Registra a contagem realizada pelo operador
    async registrar(userId: number, dto: RegistrarContagemDto) {
        const fila = await this.prisma.filaContagem.findUnique({
            where: { id: dto.filaId },
        });

        if (!fila || fila.lockedBy !== userId) {
            throw new BadRequestException('Item não está travado para você ou não existe');
        }

        const snapshot = await this.prisma.snapshotEstoque.findFirst({
            where: {
                codprod: fila.codprod,
                codlocal: fila.codlocal,
                codemp: fila.codemp,
            },
            orderBy: { dataRef: 'desc' },
        });

        const esperado = snapshot ? Number(snapshot.saldoEspelho) : 0;
        const contado = Number(dto.qtd_contada);
        const diferenca = contado - esperado;
        const diferencaAbs = Math.abs(diferenca);
        const percDivergencia = esperado > 0 ? (diferencaAbs / esperado) * 100 : 100;

        const statusAnalise = diferenca === 0 ? StatusAnalise.OK_AUTOMATICO : StatusAnalise.DIVERGENCIA_PENDENTE;

        // Verifica se já existe uma contagem para este item na fila para definir o tipo
        const contagemAnterior = await this.prisma.contagem.findFirst({
            where: { filaId: fila.id, tipo: ContagemTipo.CONTAGEM },
        });

        const tipoContagem = contagemAnterior ? ContagemTipo.RECONTAGEM : ContagemTipo.CONTAGEM;

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
                esperadoNoMomento: esperado,
                divergencia: diferenca,
                divergenciaPercent: percDivergencia,
                statusAnalise,
            },
        });

        // === LÓGICA DE INTELIGÊNCIA DE DIVERGÊNCIA ===
        if (statusAnalise === StatusAnalise.OK_AUTOMATICO) {
            // Contagem OK → finaliza item
            await this.prisma.filaContagem.update({
                where: { id: fila.id },
                data: {
                    status: FilaStatus.CONCLUIDO,
                    lockedBy: null,
                    lockedAt: null,
                    contagensOk: { increment: 1 },
                    ultimaContagemEm: new Date(),
                    prioridadeBase: 0,
                },
            });

            return {
                id: contagem.id,
                status: statusAnalise,
                esperado, contado,
                divergencia: diferenca,
                percDivergencia,
                acao: 'CONCLUIDO',
            };
        }

        // Divergência detectada — verificar se é 1ª contagem ou recontagem
        const ehRecontagem = tipoContagem === ContagemTipo.RECONTAGEM;

        if (!ehRecontagem && percDivergencia > RECOUNT_THRESHOLD_PERCENT) {
            // 1ª contagem com divergência > 5% → recontagem automática por outro operador
            this.logger.log(`Produto ${fila.codprod}: divergência ${percDivergencia.toFixed(1)}% > ${RECOUNT_THRESHOLD_PERCENT}% → recontagem automática`);

            await this.prisma.filaContagem.update({
                where: { id: fila.id },
                data: {
                    status: FilaStatus.PENDENTE,
                    lockedBy: null,
                    lockedAt: null,
                    prioridadeManual: 9999, // Prioridade máxima para ser contado rapidamente
                    recontagens: { increment: 1 },
                    ultimaContagemEm: new Date(),
                },
            });

            // Cria divergência pendente (será atualizada na recontagem)
            await this.prisma.divergencia.create({
                data: {
                    contagemId: contagem.id,
                    status: DivergenciaStatus.PENDENTE,
                    severidade: percDivergencia > 10 ? 'ALTA' : 'MEDIA',
                    observacoes: `Recontagem automática disparada (divergência ${percDivergencia.toFixed(1)}%)`,
                },
            });

            return {
                id: contagem.id,
                status: statusAnalise,
                esperado, contado,
                divergencia: diferenca,
                percDivergencia,
                acao: 'RECONTAGEM_AUTOMATICA',
            };
        }

        // Divergência < 5% na 1ª contagem OU recontagem que confirma divergência
        // → Buscar movimentações e enviar para supervisor
        const movInfo = await this.verificarMovimentacoes(
            fila.codprod, fila.codemp, fila.codlocal, snapshot?.dataRef
        );

        const obsMovimentacoes = movInfo.temMovimentacao
            ? `Movimentações detectadas no período: ${movInfo.totalEntradas} entrada(s), ${movInfo.totalSaidas} saída(s), ${movInfo.totalReservas} reserva(s). Saldo ajustado: ${movInfo.saldoAjustado}`
            : 'Nenhuma movimentação detectada no período.';

        const obsCompleta = ehRecontagem
            ? `Recontagem confirmou divergência. ${obsMovimentacoes}`
            : obsMovimentacoes;

        await this.prisma.divergencia.create({
            data: {
                contagemId: contagem.id,
                status: DivergenciaStatus.PENDENTE,
                severidade: percDivergencia > 10 ? 'ALTA' : 'MEDIA',
                observacoes: obsCompleta,
                movimentacoes: movInfo.movimentacoes as any,
                saldoAjustado: movInfo.saldoAjustado,
            },
        });

        await this.prisma.filaContagem.update({
            where: { id: fila.id },
            data: {
                status: FilaStatus.BLOQUEADO_AUDITORIA,
                lockedBy: null,
                lockedAt: null,
                ultimaContagemEm: new Date(),
            },
        });

        return {
            id: contagem.id,
            status: statusAnalise,
            esperado, contado,
            divergencia: diferenca,
            percDivergencia,
            acao: 'BLOQUEADO_AUDITORIA',
            movimentacoes: movInfo.temMovimentacao ? movInfo.movimentacoes : undefined,
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
            throw new BadRequestException('Você já marcou este item como "Não Achei" anteriormente. Outro operador precisa verificar.');
        }

        const novoNaoAchouCount = fila.naoAchouCount + 1;
        // Se 2 operadores diferentes não acharam → bloqueia para auditoria
        const devBloquear = novoNaoAchouCount >= 2;

        if (devBloquear) {
            this.logger.log(`Produto ${fila.codprod}: 2x "Não Achei" por operadores diferentes → auditoria`);

            // Criar contagem formal tipo NAO_ACHOU
            const snapshot = await this.prisma.snapshotEstoque.findFirst({
                where: { codprod: fila.codprod, codlocal: fila.codlocal, codemp: fila.codemp },
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
                fila.codprod, fila.codemp, fila.codlocal, snapshot?.dataRef
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
                status: devBloquear ? FilaStatus.BLOQUEADO_AUDITORIA : FilaStatus.PENDENTE,
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
            status: devBloquear ? FilaStatus.BLOQUEADO_AUDITORIA : FilaStatus.PENDENTE,
            naoAchouCount: novoNaoAchouCount,
            bloqueado: devBloquear,
        };
    }

    // Reportar Problema de Cadastro/Resale
    async reportarProblema(filaId: number, userId: number, motivo: string) {
        const filaItem = await this.prisma.filaContagem.findUnique({ where: { id: filaId } });
        if (!filaItem) throw new NotFoundException('Item da fila não encontrado');

        // Garantir que o item está travado para o usuário que está reportando
        if (filaItem.lockedBy !== userId && filaItem.status === FilaStatus.EM_CONTAGEM) {
            throw new BadRequestException('Item está travado para outro operador ou não está em contagem');
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
                statusAnalise: StatusAnalise.RESOLVIDO
            }
        });

        // 2. Marcar item na fila como REPORTADO
        return this.prisma.filaContagem.update({
            where: { id: filaId },
            data: {
                status: FilaStatus.REPORTADO,
                lockedBy: null,
                lockedAt: null
            }
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
        const acertos = contagensHoje.filter(c => c.statusAnalise === StatusAnalise.OK_AUTOMATICO).length;
        const metaDiaria = meta?.metaDiaria || 30;

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
        const resultado = await Promise.all(itensReportados.map(async (item) => {
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
        }));

        return resultado;
    }

    // LISTAR DIVERGÊNCIAS (Para Supervisor)
    async getDivergencias() {
        return this.prisma.divergencia.findMany({
            where: { status: DivergenciaStatus.PENDENTE },
            include: {
                contagem: {
                    include: {
                        user: { select: { nome: true } },
                        snapshot: true,
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    // TRATAR DIVERGÊNCIA (Aprovar, Recontar ou Finalizar Análise)
    async tratarDivergencia(id: number, acao: 'APROVAR' | 'RECONTAR' | 'FINALIZAR_ANALISE', observacao?: string) {
        const div = await this.prisma.divergencia.findUnique({
            where: { id },
            include: { contagem: true }
        });

        if (!div) throw new NotFoundException('Divergência não encontrada');

        if (acao === 'APROVAR') {
            await this.prisma.divergencia.update({
                where: { id },
                data: {
                    status: DivergenciaStatus.ACEITO,
                    decisao: Decisao.AJUSTAR,
                    observacoes: observacao
                }
            });
            return { message: 'Contagem aprovada pelo supervisor' };
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
                }
            });
            await this.prisma.divergencia.update({
                where: { id },
                data: {
                    status: DivergenciaStatus.CONCLUIDO,
                    decisao: Decisao.FINALIZAR_ANALISE,
                    observacoes: observacao || 'Análise finalizada. Aguardando próximo snapshot.'
                }
            });
            return { message: 'Análise finalizada. Item retorna ao final da fila.' };
        } else {
            // RECONTAR — supervisor solicita recontagem manual
            await this.prisma.filaContagem.update({
                where: { id: div.contagem.filaId },
                data: { prioridadeManual: 9999, status: FilaStatus.PENDENTE }
            });
            await this.prisma.divergencia.update({
                where: { id },
                data: {
                    status: DivergenciaStatus.CONCLUIDO,
                    decisao: Decisao.RECONTAR,
                    observacoes: observacao
                }
            });
            return { message: 'Item enviado para recontagem prioritária' };
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
                user: { select: { id: true, nome: true } }
            }
        });

        const pendentes = await this.prisma.divergencia.count({ where: { status: 'PENDENTE' } });

        let valorFalta = 0;
        let valorSobra = 0;
        const operadoresStats: Record<number, { nome: string, total: number, acertos: number }> = {};

        contagens.forEach(c => {
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
            where: { chave: 'META_GLOBAL_DIARIA' }
        });
        const metaGlobalDiaria = configMeta ? Number(configMeta.valor) : 100;

        // Divisão da meta entre operadores que TRABALHARAM hoje
        const numOperadoresAtivos = Object.keys(operadoresStats).length || 1;
        const metaPorOperador = Math.ceil(metaGlobalDiaria / numOperadoresAtivos);

        const rankingOperadores = Object.values(operadoresStats).map(stats => ({
            nome: stats.nome,
            assertividade: stats.total > 0 ? (stats.acertos / stats.total) * 100 : 0,
            total: stats.total,
            metaIndividual: metaPorOperador // Mostra a parcela dele
        })).sort((a, b) => b.assertividade - a.assertividade);

        return {
            resumo: {
                totalContado: contagens.length,
                divergenciasPendentes: pendentes,
                valorEmFalta: valorFalta,
                valorEmSobra: valorSobra,
                assertividadeGlobal: contagens.length > 0 ? (contagens.filter(c => c.statusAnalise === StatusAnalise.OK_AUTOMATICO).length / contagens.length) * 100 : 0,
                metaGlobalDiaria,
                progressoGlobal: (contagens.length / metaGlobalDiaria) * 100
            },
            rankingOperadores
        };
    }

    // Gerenciar Meta Global
    async updateMetaGlobal(valor: number) {
        return this.prisma.configuracao.upsert({
            where: { chave: 'META_GLOBAL_DIARIA' },
            update: { valor: valor.toString() },
            create: { chave: 'META_GLOBAL_DIARIA', valor: valor.toString(), descricao: 'Meta diária global da equipe' }
        });
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
                    take: 1
                }
            }
        });
    }

    // LISTAR TODOS OS OPERADORES
    async getOperadores() {
        return this.prisma.user.findMany({
            where: { role: UserRole.OPERADOR },
            select: { id: true, nome: true, login: true }
        });
    }

    // LISTAR A FILA DE CONTAGEM ATUAL
    async getFila(status?: FilaStatus) {
        return this.prisma.filaContagem.findMany({
            where: status ? { status } : {},
            orderBy: [
                { prioridadeManual: 'desc' },
                { prioridadeBase: 'desc' },
                { marca: 'asc' },
                { codprod: 'asc' }
            ],
            take: 5000 // Aumentado para mostrar todos os itens (ex: 4000 do Sankhya)
        });
    }

    // === MÉTODO AUXILIAR: Verificar movimentações no Sankhya ===
    // Busca entradas, saídas e reservas entre a data do snapshot e agora
    // Calcula o saldo ajustado para dar contexto ao supervisor
    private async verificarMovimentacoes(
        codprod: number,
        codemp: number,
        codlocal: number,
        dataSnapshot?: Date | null,
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
            saldoAjustado: 0,
            temMovimentacao: false,
            totalEntradas: 0,
            totalSaidas: 0,
            totalReservas: 0,
        };

        try {
            // Formatar datas para o Sankhya (DD/MM/YYYY)
            const formatDate = (d: Date) => {
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                return `${dd}/${mm}/${yyyy}`;
            };

            const dataInicio = dataSnapshot ? formatDate(new Date(dataSnapshot)) : formatDate(new Date());
            const dataFim = formatDate(new Date());

            const movs = await this.sankhyaClient.getMovimentacoes(
                codprod, codemp, codlocal, dataInicio, dataFim
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
                resultado.saldoAjustado = ajuste;
            }
        } catch (error: any) {
            this.logger.warn(`Falha ao buscar movimentações para produto ${codprod}: ${error.message}`);
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
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        return divs.map(d => ({
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
            SaldoAjustadoSankhya: d.saldoAjustado || 'N/A'
        }));
    }

    // EXPORTAR PRODUTIVIDADE (Dados pdr operador/hora)
    async getProdutividadeExport() {
        const contagens = await this.prisma.contagem.findMany({
            include: {
                user: { select: { nome: true } }
            },
            orderBy: { tsFim: 'desc' }
        });

        return contagens.map(c => ({
            ID: c.id,
            Data: c.tsFim.toISOString(),
            Operador: c.user.nome,
            CodProd: c.codprod,
            QtdContada: c.qtdContada,
            TempoSegundos: c.tsInicio ? Math.floor((c.tsFim.getTime() - c.tsInicio.getTime()) / 1000) : 0,
            Status: c.statusAnalise
        }));
    }
}
