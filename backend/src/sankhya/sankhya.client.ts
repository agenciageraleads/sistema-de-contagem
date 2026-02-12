import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class SankhyaClient {
    private readonly logger = new Logger(SankhyaClient.name);
    private readonly httpClient: AxiosInstance;
    private bearerToken: string | null = null;
    private tokenExpiresAt: number = 0;

    constructor(private configService: ConfigService) {
        this.httpClient = axios.create({
            baseURL: 'https://api.sankhya.com.br',
            timeout: 120000,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    /**
     * Autentica usando OAuth 2.0 Client Credentials + X-Token
     * Padrão utilizado no Portal dos Eletricistas
     */
    async authenticate(): Promise<void> {
        if (this.bearerToken && Date.now() < this.tokenExpiresAt) {
            return;
        }

        try {
            this.logger.log('Sankhya: Autenticando via OAuth 2.0 + X-Token...');

            const clientId = this.configService.get<string>('SANKHYA_CLIENT_ID');
            const clientSecret = this.configService.get<string>('SANKHYA_CLIENT_SECRET');
            const xToken = this.configService.get<string>('SANKHYA_X_TOKEN') || this.configService.get<string>('SANKHYA_TOKEN');

            const params = new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId!,
                client_secret: clientSecret!,
            });

            const response = await this.httpClient.post('/authenticate', params.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Token': xToken!,
                },
            });

            if (response.data.access_token) {
                this.bearerToken = response.data.access_token;
                this.tokenExpiresAt = Date.now() + (response.data.expires_in || 3600) * 1000;
                this.logger.log('✅ Sankhya: Autenticado com sucesso!');
            } else if (response.data.bearerToken) {
                this.bearerToken = response.data.bearerToken;
                this.tokenExpiresAt = Date.now() + 3600000;
                this.logger.log('✅ Sankhya: Autenticado com sucesso!');
            } else {
                throw new Error('Token não retornado pela API');
            }
        } catch (error: any) {
            this.logger.error('❌ Sankhya: Erro ao autenticar', error.response?.data || error.message);
            throw new Error('Falha na autenticação OAuth 2.0 com Sankhya');
        }
    }

    /**
     * Executa uma query SQL no banco de dados do Sankhya via Gateway
     */
    async executeQuery<T = any>(sql: string): Promise<T[]> {
        await this.authenticate();

        try {
            const response = await this.httpClient.post(
                '/gateway/v1/mge/service.sbr',
                {
                    serviceName: 'DbExplorerSP.executeQuery',
                    requestBody: {
                        sql: sql.trim(),
                    },
                },
                {
                    params: {
                        serviceName: 'DbExplorerSP.executeQuery',
                        outputType: 'json',
                    },
                    headers: {
                        'Authorization': `Bearer ${this.bearerToken}`,
                    },
                },
            );

            if (response.data.status === '1') {
                const fields = response.data.responseBody.fieldsMetadata;
                const rows = response.data.responseBody.rows;

                if (!rows) return [];

                // Mapear linhas para objetos usando os metadados dos campos
                return rows.map((row: any[]) => {
                    const obj: any = {};
                    fields.forEach((field: any, index: number) => {
                        obj[field.name] = row[index];
                    });
                    return obj;
                });
            } else {
                const errorMsg = response.data.statusMessage || 'Erro na execução da query';
                throw new Error(`Erro SQL Sankhya Gateway: ${errorMsg}`);
            }
        } catch (error: any) {
            this.logger.error(`Sankhya SQL Error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Teste de conexão via Gateway
     */
    async testConnection() {
        try {
            const sql = 'SELECT 1 FROM DUAL';
            const result = await this.executeQuery(sql);
            return {
                success: true,
                message: 'Conexão via Gateway OAuth 2.0 estabelecida com sucesso!',
                result: result[0]
            };
        } catch (error: any) {
            return {
                success: false,
                message: 'Falha na conexão via Gateway',
                error: error.message
            };
        }
    }

    /**
     * Cria uma Nota de Ajuste (Entrada ou Saída)
     * Utiliza o serviço CACSP.incluirNota
     */
    async createAdjustmentNote(
        codemp: number,
        dtneg: string, // dd/mm/yyyy
        top: number,   // 221 ou 1221
        items: { codprod: number; qtdneg: number; codlocal: number; vlrunit: number; codvol: string }[],
        observacao: string = 'Nota gerada automaticamente pelo App de Contagem'
    ): Promise<number> {
        await this.authenticate();

        try {
            this.logger.log(`Criando Nota de Ajuste (TOP: ${top}, Itens: ${items.length})...`);

            const requestBody = {
                nota: {
                    cabecalho: {
                        NUNOTA: {},
                        CODPARC: { "$": 1 }, // Parceiro 1 solicitado
                        DTNEG: { "$": dtneg },
                        CODTIPOPER: { "$": top },
                        CODTIPVENDA: { "$": 0 }, // Padrão 0
                        CODVEND: { "$": 0 },     // Padrão 0
                        CODEMP: { "$": codemp },
                        TIPMOV: { "$": top === 221 ? 'C' : 'V' },
                        CODTAB: { "$": 0 }, // Sem tabela de preço (ajuste manual)
                        OBSERVACAO: { "$": observacao }
                    },
                    itens: {
                        INFORMARPRECO: "True",
                        item: items.map(item => ({
                            NUNOTA: {},
                            CODPROD: { "$": item.codprod },
                            QTDNEG: { "$": item.qtdneg },
                            CODLOCALORIG: { "$": item.codlocal },
                            VLRUNIT: { "$": item.vlrunit },
                            CODVOL: { "$": item.codvol },
                            PERCDESC: { "$": 0 },
                            CONTROLE: { "$": " " }
                        }))
                    }
                }
            };

            const response = await this.httpClient.post(
                '/gateway/v1/mgecom/service.sbr',
                {
                    serviceName: 'CACSP.incluirNota',
                    requestBody: requestBody,
                },
                {
                    params: {
                        serviceName: 'CACSP.incluirNota',
                        outputType: 'json',
                    },
                    headers: {
                        'Authorization': `Bearer ${this.bearerToken}`,
                    },
                },
            );

            if (response.data.status === '1') {
                const nunotaRaw = response.data.responseBody.pk.NUNOTA;
                const nunota = nunotaRaw["$"] ? nunotaRaw["$"] : nunotaRaw;
                this.logger.log(`✅ Nota criada com sucesso! NUNOTA: ${nunota}`);
                return Number(nunota);
            } else {
                const errorMsg = response.data.statusMessage || 'Erro na criação da nota';
                throw new Error(`Erro Sankhya CACSP.incluirNota: ${errorMsg}`);
            }

        } catch (error: any) {
            this.logger.error(`Sankhya Adjustment Error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Busca uma nota de ajuste existente para o dia atual com a flag do App e padrão de observação
     */
    async findDailyAdjustmentNote(codemp: number, dtneg: string, top: number, observacaoPattern: string = '%App de Contagem%'): Promise<number | null> {
        await this.authenticate();
        try {
            // Busca nota confirmada ou pendente do dia, com o TOP específico e a observação que bate com o padrão
            const sql = `
                SELECT NUNOTA 
                FROM TGFCAB 
                WHERE CODEMP = ${codemp} 
                  AND DTNEG = TO_DATE('${dtneg}', 'DD/MM/YYYY') 
                  AND CODTIPOPER = ${top}
                  AND OBSERVACAO LIKE '${observacaoPattern}'
                  AND ROWNUM = 1
            `;
            const result = await this.executeQuery<{ NUNOTA: number }>(sql);
            if (result && result.length > 0) {
                return result[0].NUNOTA;
            }
            return null;
        } catch (error: any) {
            this.logger.warn(`Erro ao buscar nota diária: ${error.message}`);
            return null;
        }
    }

    /**
     * Adiciona itens a uma nota existente
     */
    async addItemsToNote(
        nunota: number,
        items: { codprod: number; qtdneg: number; codlocal: number; vlrunit: number; codvol: string }[]
    ): Promise<void> {
        await this.authenticate();

        try {
            this.logger.log(`Adicionando ${items.length} itens à Nota ${nunota}...`);

            const requestBody = {
                nota: {
                    cabecalho: {
                        NUNOTA: { "$": nunota }
                    },
                    itens: {
                        INFORMARPRECO: "True",
                        item: items.map(item => ({
                            NUNOTA: { "$": nunota },
                            CODPROD: { "$": item.codprod },
                            QTDNEG: { "$": item.qtdneg },
                            CODLOCALORIG: { "$": item.codlocal },
                            VLRUNIT: { "$": item.vlrunit },
                            CODVOL: { "$": item.codvol },
                            PERCDESC: { "$": 0 },
                            CONTROLE: { "$": " " }
                        }))
                    }
                }
            };

            const response = await this.httpClient.post(
                '/gateway/v1/mgecom/service.sbr',
                {
                    serviceName: 'CACSP.incluirNota',
                    requestBody: requestBody,
                },
                {
                    params: { serviceName: 'CACSP.incluirNota', outputType: 'json' },
                    headers: { 'Authorization': `Bearer ${this.bearerToken}` }
                }
            );

            if (response.data.status === '1') {
                this.logger.log(`✅ Itens adicionados à Nota ${nunota} com sucesso!`);
            } else {
                throw new Error(`Erro Sankhya Add Items: ${response.data.statusMessage}`);
            }

        } catch (error: any) {
            this.logger.error(`Add Items Error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Confirma uma nota no Sankhya
     */
    async confirmNote(nunota: number): Promise<void> {
        await this.authenticate();
        try {
            this.logger.log(`Confirmando Nota ${nunota}...`);
            const response = await this.httpClient.post(
                '/gateway/v1/mgecom/service.sbr',
                {
                    serviceName: 'CACSP.confirmarNota',
                    requestBody: {
                        nota: {
                            NUNOTA: { "$": nunota }
                        }
                    }
                },
                {
                    params: { serviceName: 'CACSP.confirmarNota', outputType: 'json' },
                    headers: { 'Authorization': `Bearer ${this.bearerToken}` }
                }
            );

            if (response.data.status === '1') {
                this.logger.log(`✅ Nota ${nunota} confirmada com sucesso!`);
            } else {
                // Ignora erro se já estiver confirmada (StatusMessage check seria ideal, mas genérico aqui)
                if (String(response.data.statusMessage).includes('confirmada')) {
                    this.logger.warn(`Nota ${nunota} já estava confirmada.`);
                    return;
                }
                throw new Error(`Erro Sankhya CACSP.confirmarNota: ${response.data.statusMessage}`);
            }
        } catch (error: any) {
            this.logger.error(`Sankhya Confirmation Error: ${error.message}`);
            throw error;
        }
    }
    /**
     * Busca o Custo de Reposição (CUSREP) de um produto na TGFCUS
     */
    async getReplacementCost(codprod: number, codemp: number, codlocal: number): Promise<number | null> {
        await this.authenticate();
        try {
            // Busca o registro mais recente de custo para o produto/empresa/local
            // Usa query bruta para evitar problemas com Prisma/TypeORM
            const sql = `
                SELECT CUSREP 
                FROM TGFCUS 
                WHERE CODPROD = ${codprod} 
                  AND CODEMP = ${codemp} 
                  AND CODLOCAL = ${codlocal} 
                  AND DTATUAL = (
                      SELECT MAX(DTATUAL) 
                      FROM TGFCUS 
                      WHERE CODPROD = ${codprod} 
                        AND CODEMP = ${codemp} 
                        AND CODLOCAL = ${codlocal}
                  )
            `;
            const result = await this.executeQuery<{ CUSREP: number }>(sql);

            if (result && result.length > 0) {
                return result[0].CUSREP;
            }
            return null;
        } catch (error: any) {
            this.logger.warn(`Erro ao buscar custo de reposição: ${error.message}`);
            return null;
        }
    }

    /**
     * Busca movimentações de um produto no Sankhya (entradas, saídas e reservas TOP 1000)
     * entre duas datas. Útil para validar divergências de contagem.
     */
    async getMovimentacoes(
        codprod: number,
        codemp: number,
        codlocal: number,
        dataInicio: string, // Formato DD/MM/YYYY
        dataFim: string     // Formato DD/MM/YYYY
    ): Promise<Array<{ NUNOTA: number; DTMOV: string; CODTIPOPER: number; QTDNEG: number; TIPMOV: string; ORIGEM: string }>> {
        await this.authenticate();
        try {
            const sql = `
                SELECT C.NUNOTA, C.DTMOV, C.CODTIPOPER, I.QTDNEG, C.TIPMOV, 'MOV' AS ORIGEM
                FROM TGFCAB C
                INNER JOIN TGFITE I ON C.NUNOTA = I.NUNOTA
                WHERE I.CODPROD = ${codprod}
                  AND C.CODEMP = ${codemp}
                  AND I.CODLOCALORIG = ${codlocal}
                  AND C.DTMOV BETWEEN TO_DATE('${dataInicio}', 'DD/MM/YYYY') AND TO_DATE('${dataFim}', 'DD/MM/YYYY')
                  AND (C.STATUSNOTA = 'L' OR C.CODTIPOPER = 1150)
                UNION ALL
                SELECT C.NUNOTA, C.DTMOV, C.CODTIPOPER, I.QTDNEG, C.TIPMOV, 'RESERVA' AS ORIGEM
                FROM TGFCAB C
                INNER JOIN TGFITE I ON C.NUNOTA = I.NUNOTA
                WHERE I.CODPROD = ${codprod}
                  AND C.CODEMP = ${codemp}
                  AND I.CODLOCALORIG = ${codlocal}
                  AND C.CODTIPOPER = 1000
                  AND C.DTMOV BETWEEN TO_DATE('${dataInicio}', 'DD/MM/YYYY') AND TO_DATE('${dataFim}', 'DD/MM/YYYY')
                  AND C.STATUSNOTA <> 'C'
                ORDER BY DTMOV DESC
            `;
            const result = await this.executeQuery(sql);
            return result || [];
        } catch (error: any) {
            this.logger.warn(`Erro ao buscar movimentações: ${error.message}`);
            return [];
        }
    }

    /**
     * Salva um registro em uma entidade Sankhya usando CRUDServiceProvider.saveRecord
     */
    async saveRecord(entityName: string, fields: Record<string, any>): Promise<void> {
        await this.authenticate();
        try {
            const requestBody = {
                dataSet: {
                    rootEntity: entityName,
                    includePresentationFields: "N",
                    dataRow: {
                        localFields: Object.entries(fields).reduce((acc, [key, value]) => {
                            acc[key] = { "$": value };
                            return acc;
                        }, {} as Record<string, any>)
                    },
                    entity: {
                        fieldset: {
                            list: Object.keys(fields).join(',')
                        }
                    }
                }
            };

            const response = await this.httpClient.post(
                '/gateway/v1/mge/service.sbr',
                {
                    serviceName: 'CRUDServiceProvider.saveRecord',
                    requestBody: requestBody,
                },
                {
                    params: { serviceName: 'CRUDServiceProvider.saveRecord', outputType: 'json' },
                    headers: { 'Authorization': `Bearer ${this.bearerToken}` }
                }
            );

            if (response.data.status === '1') {
                this.logger.log(`✅ Registro salvo em ${entityName} com sucesso!`);
            } else {
                throw new Error(`Erro Sankhya Save Record (${entityName}): ${response.data.statusMessage}`);
            }
        } catch (error: any) {
            this.logger.error(`Save Record Error: ${error.message}`);
            throw error;
        }
    }
}
