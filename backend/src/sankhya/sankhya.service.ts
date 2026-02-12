import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SankhyaClient } from './sankhya.client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SankhyaService {
    private readonly logger = new Logger(SankhyaService.name);

    constructor(
        private prisma: PrismaService,
        private sankhyaClient: SankhyaClient,
        private configService: ConfigService
    ) { }

    /**
     * Busca dados reais do Sankhya via SQL.
     * Implementa a lógica de popularidade + estoque + custo (TGFCUS / CUSREP)
     */
    async fetchLiveStockFromSankhya(codprod: number, codlocal: number) {
        this.logger.debug(`Buscando dados reais no Sankhya para Produto ${codprod} no local ${codlocal}`);

        const codemp = this.configService.get<number>('CODEMP') || 1;

        const sql = `
            WITH 
            UltimasTabelasVigentes AS (
                SELECT CODTAB, NUTAB FROM (
                    SELECT T.CODTAB, T.NUTAB, ROW_NUMBER() OVER (PARTITION BY T.CODTAB ORDER BY T.DTVIGOR DESC) AS RN
                    FROM TGFTAB T WHERE T.DTVIGOR <= SYSDATE
                ) WHERE RN = 1
            ),
            CustosVigentes AS (
                SELECT C.CODPROD, C.CUSREP FROM TGFCUS C
                WHERE C.CODEMP = ${codemp}
                  AND C.DHALTER = (SELECT MAX(X.DHALTER) FROM TGFCUS X WHERE X.CODPROD = C.CODPROD AND X.CODEMP = C.CODEMP)
            ),
            EstoqueEspecifico AS (
                SELECT EST.CODPROD, SUM(EST.ESTOQUE) AS ESTOQUE_LOCAL, MAX(NVL(NULLIF(EST.CONTROLE, ' '), '')) AS CONTROLE_LOTE
                FROM TGFEST EST
                WHERE EST.CODLOCAL = '${codlocal}' AND EST.CODEMP = ${codemp}
                GROUP BY EST.CODPROD
            )
            SELECT 
                P.CODPROD, P.DESCRPROD, P.MARCA, P.CODVOL, 
                NVL(E.ESTOQUE_LOCAL, 0) AS ESTOQUE,
                NVL(CS.CUSREP, 0) AS CUSTO,
                NVL(E.CONTROLE_LOTE, P.MARCA) AS MARCA_CONTROLE
            FROM TGFPRO P
            LEFT JOIN EstoqueEspecifico E ON P.CODPROD = E.CODPROD
            LEFT JOIN CustosVigentes CS ON P.CODPROD = CS.CODPROD
            WHERE P.CODPROD = ${codprod}
        `;

        try {
            const results = await this.sankhyaClient.executeQuery(sql);
            if (results && results.length > 0) {
                const data = results[0];
                return {
                    saldo: Number(data.ESTOQUE),
                    custo: Number(data.CUSTO),
                    descprod: String(data.DESCRPROD),
                    marca: String(data.MARCA),
                    controle: String(data.MARCA_CONTROLE),
                    valorEstoque: Number(data.ESTOQUE) * Number(data.CUSTO)
                };
            }
            throw new Error(`Produto ${codprod} não encontrado no Sankhya`);
        } catch (error: any) {
            this.logger.error(`Erro ao buscar dados no Sankhya: ${error.message}`);
            throw error;
        }
    }

    /**
     * Sincroniza o SnapshotEstoque de todos os itens ativos na fila
     * Rodado pelo Job Noturno ou manualmente pelo Supervisor
     */
    async syncAllSnapshots() {
        this.logger.log('🚀 Iniciando Sincronização de Snapshots em Lote...');
        const inicio = Date.now();

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        try {
            // 1. Busca todos os dados reais via Super Query (Snapshot do Momento)
            const liveData = await this.getProductsByEfficiency();
            this.logger.log(`Dados obtidos do Sankhya: ${liveData.length} itens.`);

            const codemp = Number(this.configService.get('CODEMP') || 1);
            const codlocal = Number(this.configService.get('CODLOCAL') || 10010000);

            // 2. Limpar snapshots existentes para HOJE (caso seja um retry) para evitar duplicidade
            // ou usar o createMany se o banco suportar.
            await this.prisma.snapshotEstoque.deleteMany({
                where: {
                    dataRef: hoje,
                    codemp: codemp,
                    codlocal: codlocal
                }
            });

            // 3. Preparar dados para inserção em lote
            const snapshots = liveData.map(p => ({
                dataRef: hoje,
                codemp: codemp,
                codlocal: codlocal,
                codprod: Number(p.CODPROD),
                descprod: String(p.DESCRPROD || 'SEM DESCRICAO'),
                marca: String(p.MARCA || ''),
                unidade: String(p.UNIDADE || 'UN'),
                controle: String(p.MARCA_CONTROLE || p.MARCA || ' '),
                saldoEspelho: Number(p.ESTOQUE || 0),
                custoEspelho: Number(p.CUSTO || 0),
                valorEstoque: Number(p.ESTOQUE || 0) * Number(p.CUSTO || 0)
            }));

            // 4. Inserir em lotes de 1000 para não estourar o Postgres
            const batchSize = 1000;
            for (let i = 0; i < snapshots.length; i += batchSize) {
                const batch = snapshots.slice(i, i + batchSize);
                await this.prisma.snapshotEstoque.createMany({
                    data: batch,
                    skipDuplicates: true
                });
            }

            const duracao = ((Date.now() - inicio) / 1000).toFixed(2);
            this.logger.log(`✅ Sincronização em lote concluída: ${snapshots.length} itens em ${duracao}s.`);

            // Automaticamente atualiza a fila com a nova prioridade baseada em valor
            await this.repopulateFila();

            return { syncCount: snapshots.length, duracaoSegundos: duracao };
        } catch (error: any) {
            this.logger.error(`Falha na sincronização em lote: ${error.message}`);
            throw error;
        }
    }

    /**
     * Busca todos os produtos ativos usando a query de Popularidade
     * Útil para popular a fila de contagem inicialmente
     */
    async getProductsByEfficiency() {
        const codemp = this.configService.get<number>('CODEMP') || 1;
        const codlocal = this.configService.get<number>('CODLOCAL') || 10010000;

        const sql = `
            WITH 
            CustosVigentes AS (
                SELECT C.CODPROD, C.CUSREP FROM TGFCUS C
                WHERE C.CODEMP = ${codemp}
                  AND C.DHALTER = (SELECT MAX(X.DHALTER) FROM TGFCUS X WHERE X.CODPROD = C.CODPROD AND X.CODEMP = C.CODEMP)
            ),
            EstoqueAgregado AS (
                SELECT EST.CODPROD, SUM(EST.ESTOQUE) AS ESTOQUE_TOTAL, MAX(NVL(NULLIF(EST.CONTROLE, ' '), ' ')) AS CONTROLE_LOTE,
                       MAX(EST.DTENTRADA) AS DTULTENT
                FROM TGFEST EST
                WHERE EST.CODLOCAL = ${codlocal} AND EST.CODEMP = ${codemp}
                GROUP BY EST.CODPROD
            ),
            DadosBase AS (
                SELECT 
                    P.CODPROD, P.DESCRPROD, TRIM(NVL(P.MARCA, 'SEM MARCA')) AS MARCA, P.CODVOL AS UNIDADE, 
                    NVL(E.ESTOQUE_TOTAL, 0) AS ESTOQUE,
                    NVL(CS.CUSREP, 0) AS CUSTO,
                    (NVL(E.ESTOQUE_TOTAL, 0) * NVL(CS.CUSREP, 0)) AS VALOR_ESTOQUE,
                    NVL(E.CONTROLE_LOTE, ' ') AS MARCA_CONTROLE,
                    NVL(E.DTULTENT, TO_DATE('2000-01-01', 'YYYY-MM-DD')) AS DTULTENT
                FROM TGFPRO P
                LEFT JOIN EstoqueAgregado E ON P.CODPROD = E.CODPROD
                LEFT JOIN CustosVigentes CS ON P.CODPROD = CS.CODPROD
                WHERE P.ATIVO = 'S' AND P.USOPROD = 'R'
            ),
            ValorPorMarca AS (
                SELECT MARCA, SUM(VALOR_ESTOQUE) AS VALOR_TOTAL_MARCA
                FROM DadosBase
                GROUP BY MARCA
            )
            SELECT 
                B.*,
                V.VALOR_TOTAL_MARCA,
                /* Indice: Reflete a importancia da Marca e depois do Produto */
                /* Produtos sem marca vão para o final da fila (peso negativo ou zero na marca) */
                CASE 
                    WHEN B.MARCA = 'SEM MARCA' THEN (B.VALOR_ESTOQUE / 10000)
                    ELSE ((V.VALOR_TOTAL_MARCA / 1000) + (B.VALOR_ESTOQUE / 1000))
                END AS INDICE_PRIORIDADE
            FROM DadosBase B
            JOIN ValorPorMarca V ON B.MARCA = V.MARCA
            ORDER BY 
                CASE WHEN B.MARCA = 'SEM MARCA' THEN 1 ELSE 0 END ASC,
                V.VALOR_TOTAL_MARCA DESC, 
                VALOR_ESTOQUE DESC
        `;

        return this.sankhyaClient.executeQuery(sql);
    }

    /**
     * Realiza a carga inicial da fila de contagem com base na inteligência do Sankhya
     */
    async repopulateFila() {
        this.logger.log('🚀 Iniciando Carga Inicial / Repopulação da Fila de Contagem...');

        try {
            const products = await this.getProductsByEfficiency();
            this.logger.log(`${products.length} produtos retornados pelo Sankhya para a fila.`);

            const codemp = Number(this.configService.get('CODEMP') || 1);
            const codlocal = Number(this.configService.get('CODLOCAL') || 10010000);
            const hoje = new Date();

            // Buscar últimas contagens do nosso DB para calcular bônus de atraso
            const ultimasContagens = await this.prisma.filaContagem.findMany({
                select: { codprod: true, ultimaContagemEm: true }
            });
            const mapUltimas = new Map(ultimasContagens.map(u => [u.codprod, u.ultimaContagemEm]));

            for (const p of products) {
                const codprod = Number(p.CODPROD);

                // LÓGICA DE PRIORIDADE DINÂMICA
                let score = Number(p.INDICE_PRIORIDADE || 0);

                // 1. Fator Frescor (Entradas Recentes no Sankhya)
                const dtEntrada = new Date(p.DTULTENT);
                const diasEntrada = Math.floor((hoje.getTime() - dtEntrada.getTime()) / (1000 * 60 * 60 * 24));

                if (diasEntrada < 7) score *= 0.1; // Se entrou essa semana, prioridade cai 90%
                else if (diasEntrada < 30) score *= 0.5; // Se entrou esse mês, cai 50%

                // 2. Fator Abandono (Tempo sem contar no nosso sistema)
                const ultimaContagem = mapUltimas.get(codprod);
                const diasSemContar = ultimaContagem
                    ? Math.floor((hoje.getTime() - new Date(ultimaContagem).getTime()) / (1000 * 60 * 60 * 24))
                    : 365;

                const bonusAtraso = Math.min(diasSemContar / 30, 2.0); // Até 2x de bônus se 2 meses sem contar

                // 3. Penalidade para Cabos (Metro) - Solicitado pelo usuário para ficar no final
                // 3. Penalidade para Cabos (Metro) 
                // Solicitado pelo usuário: Cabos em ROLO (RL) ou UNIDADE (UN) são fáceis de contar.
                // Apenas cabos vendidos por METRO (M, MET) devem ir para o final.

                const unidade = String(p.UNIDADE || 'UN').toUpperCase();
                const descricao = String(p.DESCRPROD || '').toUpperCase();

                const isLinearUnit = unidade === 'M' || unidade === 'MET' || unidade.startsWith('MT');
                const isCaboOuSimilar =
                    descricao.includes('CABO') ||
                    descricao.includes('FIO ') ||
                    descricao.includes('CORDA') ||
                    descricao.includes('MANGUEIRA');

                // Só penaliza se for unidade linear OU (é cabo E NÃO É unidade fechada 'RL'/'UN'/'PC')
                if (isLinearUnit || (isCaboOuSimilar && !['RL', 'UN', 'PC', 'CX'].includes(unidade))) {
                    score = 0.1; // Força prioridade baixíssima apenas para o que é difícil (metro)
                }

                const prioridadeFinal = Math.floor(score * (1 + bonusAtraso));

                await this.prisma.filaContagem.upsert({
                    where: {
                        codprod_codlocal_codemp: {
                            codprod: codprod,
                            codlocal: codlocal,
                            codemp: codemp
                        }
                    },
                    update: {
                        descprod: String(p.DESCRPROD || 'SEM DESCRICAO'),
                        marca: String(p.MARCA || ''),
                        unidade: String(p.UNIDADE || 'UN'),
                        controle: String(p.MARCA_CONTROLE || p.MARCA || ' '),
                        prioridadeBase: prioridadeFinal,
                        updatedAt: new Date()
                        // NOTA: Não alteramos o status aqui para não resetar itens CONCLUIDOS/REPORTADOS
                    },
                    create: {
                        codprod: codprod,
                        codlocal: codlocal,
                        codemp: codemp,
                        descprod: String(p.DESCRPROD || 'SEM DESCRICAO'),
                        marca: String(p.MARCA || ''),
                        unidade: String(p.UNIDADE || 'UN'),
                        controle: String(p.MARCA_CONTROLE || p.MARCA || ' '),
                        prioridadeBase: prioridadeFinal,
                        status: 'PENDENTE'
                    }
                });
            }

            // Registrar log de sincronização bem sucedida
            await this.prisma.jobLog.create({
                data: {
                    tipo: 'SYNC',
                    status: 'SUCESSO',
                    produtosProcessados: products.length,
                    detalhe: `Fila atualizada com ${products.length} itens.`
                }
            });

            this.logger.log('✅ Fila de contagem repopulada com sucesso.');
            return { total: products.length };
        } catch (error: any) {
            this.logger.error(`Falha ao repopular fila: ${error.message}`);
            await this.prisma.jobLog.create({
                data: {
                    tipo: 'SYNC',
                    status: 'ERRO',
                    erro: error.message
                }
            });
            throw error;
        }
    }

    /**
     * Reseta o ciclo atual: Limpa itens finalizados e re-sincroniza
     */
    async resetCycle() {
        this.logger.warn('🧹 Reset de Ciclo solicitado! Limpando fila...');

        // 1. Remove itens que já foram processados nesta rodada
        await this.prisma.filaContagem.deleteMany({
            where: {
                status: { in: ['CONCLUIDO', 'REPORTADO', 'BLOQUEADO_AUDITORIA'] }
            }
        });

        // 2. Reseta locks de itens que ficaram presos
        await this.prisma.filaContagem.updateMany({
            where: { status: 'EM_CONTAGEM' },
            data: {
                status: 'PENDENTE',
                lockedBy: null,
                lockedAt: null
            }
        });

        // 3. Força uma nova sincronização com o Sankhya
        return this.syncAllSnapshots();
    }

    /**
     * Testa a conexão e autenticação com o Sankhya
     */
    async testConnection() {
        return this.sankhyaClient.testConnection();
    }

    async inspectTable(tableName: string) {
        const sql = `SELECT * FROM ${tableName} WHERE ROWNUM = 1`;
        const result = await this.sankhyaClient.executeQuery(sql);
        return {
            tableName,
            columns: result.length > 0 ? Object.keys(result[0]) : 'Vazio',
            sample: result[0]
        };
    }

    /**
     * Retorna o log da última sincronização bem sucedida
     */
    async getLastSyncLog() {
        return this.prisma.jobLog.findFirst({
            where: {
                tipo: 'SYNC',
                status: 'SUCESSO'
            },
            orderBy: {
                dataExecucao: 'desc'
            }
        });
    }

    /**
     * Processa Divergências aprovadas pelo Supervisor e gera notas no Sankhya
     * Agrupa por TOP (221 = Entrada, 1221 = Saída)
     */
    async syncPendingAdjustments() {
        this.logger.log('🔄 Verificando ajustes pendentes de sincronização...');

        // 1. Busca divergências Aprovadas mas ainda não sincronizadas
        const pendentes = await this.prisma.divergencia.findMany({
            where: {
                decisao: 'AJUSTAR', // Decisao.AJUSTAR
                OR: [
                    { adjustStatus: null },
                    { adjustStatus: 'PENDING' }
                ]
            },
            include: {
                contagem: {
                    include: {
                        snapshot: true,
                        user: { select: { id: true, nome: true } }
                    }
                }
            }
        });

        if (pendentes.length === 0) {
            this.logger.debug('✅ Nenhum ajuste pendente.');
            return { processed: 0 };
        }

        this.logger.log(`Found ${pendentes.length} pending adjustments. Grouping by operator...`);

        const codemp = Number(this.configService.get('CODEMP') || 1);
        const hoje = new Date().toLocaleDateString('pt-BR'); // dd/mm/yyyy
        let notasGeradas = 0;

        // 2. Agrupar por Operador (User ID)
        const divergenciasPorOperador = new Map<number, typeof pendentes>();

        for (const div of pendentes) {
            const userId = div.contagem.userId;
            if (!divergenciasPorOperador.has(userId)) {
                divergenciasPorOperador.set(userId, []);
            }
            divergenciasPorOperador.get(userId)?.push(div);
        }

        // 3. Processar cada Operador separadamente
        for (const [userId, userDivergencias] of divergenciasPorOperador.entries()) {
            const userName = userDivergencias[0].contagem.user.nome.split(' ')[0]; // Primeiro nome
            this.logger.log(`>> Processando ajustes do Operador: ${userName} (ID: ${userId})...`);

            const itemsEntrada: any[] = [];
            const itemsSaida: any[] = [];
            const idsEntrada: number[] = [];
            const idsSaida: number[] = [];

            for (const div of userDivergencias) {
                const diff = Number(div.contagem.divergencia);
                if (diff === 0) continue;

                // Usa dados do snapshot para consistência de Custo e Unidade
                const snapshot = div.contagem.snapshot;
                const vlrunit = snapshot ? Number(snapshot.custoEspelho) : 0;
                const codvol = snapshot ? snapshot.unidade || 'UN' : 'UN';

                const itemSankhya = {
                    codprod: div.contagem.codprod,
                    qtdneg: Math.abs(diff),
                    codlocal: div.contagem.codlocal,
                    vlrunit: vlrunit,
                    codvol: codvol
                };

                if (diff > 0) {
                    // Sobra = Entrada (TOP 221)
                    itemsEntrada.push(itemSankhya);
                    idsEntrada.push(div.id);
                } else {
                    // Falta = Saída (TOP 1221)
                    itemsSaida.push(itemSankhya);
                    idsSaida.push(div.id);
                }
            }

            // A) Processar Entradas (TOP 221) para este Operador
            if (itemsEntrada.length > 0) {
                try {
                    const obsPattern = `%App Contagem - ${userName}%`;
                    const obsExact = `Ajuste de Estoque - App Contagem - ${userName} (Entrada)`;

                    let nunota: number | null = await this.sankhyaClient.findDailyAdjustmentNote(codemp, hoje, 221, obsPattern);

                    if (nunota) {
                        this.logger.log(`Nota diária encontrada (TOP 221, User: ${userName}): ${nunota}. Adicionando itens...`);
                        await this.sankhyaClient.addItemsToNote(nunota, itemsEntrada);
                    } else {
                        this.logger.log(`Criando nova nota (TOP 221, User: ${userName})...`);
                        nunota = await this.sankhyaClient.createAdjustmentNote(
                            codemp,
                            hoje,
                            221,
                            itemsEntrada,
                            obsExact
                        );
                    }

                    if (nunota) {
                        try { await this.sankhyaClient.confirmNote(nunota); }
                        catch (e: any) { this.logger.warn(`Erro confirmação nota ${nunota}: ${e.message}`); }

                        await this.prisma.divergencia.updateMany({
                            where: { id: { in: idsEntrada } },
                            data: { adjustStatus: 'SYNCED', adjustDate: new Date(), adjustNoteId: nunota }
                        });
                        notasGeradas++;
                    }
                } catch (error: any) {
                    this.logger.error(`❌ Falha entrada User ${userName}: ${error.message}`);
                    await this.prisma.divergencia.updateMany({
                        where: { id: { in: idsEntrada } },
                        data: { adjustStatus: 'ERROR', observacoes: `Erro Sync: ${error.message}` }
                    });
                }
            }

            // B) Processar Saídas (TOP 1121) para este Operador
            if (itemsSaida.length > 0) {
                // Enriquecer com Custo de Reposição
                for (const item of itemsSaida) {
                    try {
                        const custo = await this.sankhyaClient.getReplacementCost(item.codprod, codemp, item.codlocal);
                        if (custo) item.vlrunit = custo;
                    } catch (e) { }
                }

                try {
                    const obsPattern = `%App Contagem - ${userName}%`;
                    const obsExact = `Ajuste de Estoque - App Contagem - ${userName} (Saída/Perda)`;

                    let nunota: number | null = await this.sankhyaClient.findDailyAdjustmentNote(codemp, hoje, 1121, obsPattern);

                    if (nunota) {
                        this.logger.log(`Nota diária encontrada (TOP 1121, User: ${userName}): ${nunota}. Adicionando itens...`);
                        await this.sankhyaClient.addItemsToNote(nunota, itemsSaida);
                    } else {
                        this.logger.log(`Criando nova nota (TOP 1121, User: ${userName})...`);
                        nunota = await this.sankhyaClient.createAdjustmentNote(
                            codemp,
                            hoje,
                            1121,
                            itemsSaida,
                            obsExact
                        );
                    }

                    if (nunota) {
                        try { await this.sankhyaClient.confirmNote(nunota); }
                        catch (e: any) { this.logger.warn(`Erro confirmação nota ${nunota}: ${e.message}`); }

                        await this.prisma.divergencia.updateMany({
                            where: { id: { in: idsSaida } },
                            data: { adjustStatus: 'SYNCED', adjustDate: new Date(), adjustNoteId: nunota }
                        });
                        notasGeradas++;
                    }
                } catch (error: any) {
                    this.logger.error(`❌ Falha saída User ${userName}: ${error.message}`);
                    await this.prisma.divergencia.updateMany({
                        where: { id: { in: idsSaida } },
                        data: { adjustStatus: 'ERROR', observacoes: `Erro Sync: ${error.message}` }
                    });
                }
            }
        }

        return { processed: pendentes.length, notasCreated: notasGeradas };
    }

    async diagnose() {
        try {
            const data = await this.getProductsByEfficiency();
            return {
                status: 'OK',
                count: data.length,
                codlocal: this.configService.get('CODLOCAL') || 10010000,
                codemp: this.configService.get('CODEMP') || 1,
                sample: data.slice(0, 5)
            };
        } catch (e: any) {
            return {
                status: 'ERROR',
                error: e.message
            };
        }
    }
}
