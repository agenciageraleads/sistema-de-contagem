import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DivergenciaStatus, Decisao, UserRole, FilaStatus, ContagemTipo } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { SankhyaClient } from '../src/sankhya/sankhya.client';

describe('Simulação de Nota de Ajuste Real (MGECOM)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let authToken: string;
    let sankhyaClient: SankhyaClient;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        prisma = app.get<PrismaService>(PrismaService);
        sankhyaClient = app.get<SankhyaClient>(SankhyaClient);


        const login = 'admin_sync_' + Date.now();
        const senhaHash = await bcrypt.hash('123456', 10);
        await prisma.user.upsert({
            where: { login },
            update: {},
            create: {
                nome: 'Admin Sync Test',
                login,
                senhaHash,
                role: UserRole.ADMIN,
                ativo: true,
            },
        });

        const loginRes = await request(app.getHttpServer())
            .post('/auth/login')
            .send({ login, senha: '123456' });

        authToken = loginRes.body.token;
    });

    afterAll(async () => {
        await app.close();
    });

    it('Deve criar nota real de ENTRADA (MGECOM 221) e CONFIRMAR', async () => {
        const codprod = 2; // Produto X
        const codlocal = 10010000;
        const codemp = 1;

        // Limpar
        await prisma.divergencia.deleteMany({});
        await prisma.contagem.deleteMany({});
        await prisma.filaContagem.deleteMany({ where: { codprod, codlocal, codemp } });

        // 1. Snapshot: Tem 10
        await prisma.snapshotEstoque.upsert({
            where: { dataRef_codemp_codlocal_codprod: { dataRef: new Date(), codemp, codlocal, codprod } },
            update: { saldoEspelho: 10 },
            create: {
                dataRef: new Date(), codemp, codlocal, codprod,
                descprod: 'SIMULACAO', saldoEspelho: 10, custoEspelho: 1.0, valorEstoque: 10
            }
        });

        // 2. Contagem: Contou 12 (+2)
        const fila = await prisma.filaContagem.create({
            data: { codprod, codlocal, codemp, descprod: 'TEST', status: 'PENDENTE' }
        });

        const contagem = await prisma.contagem.create({
            data: {
                codprod, codlocal, codemp, filaId: fila.id, tipo: 'CONTAGEM',
                qtdContada: 12, divergencia: 2, statusAnalise: 'DIVERGENCIA_PENDENTE',
                tsInicio: new Date(), tsFim: new Date(),
                userId: (await prisma.user.findFirst({ where: { role: UserRole.ADMIN } }))!.id
            }
        });

        // 3. Aprovar Divergência
        await prisma.divergencia.create({
            data: {
                contagemId: contagem.id, status: 'ACEITO', decisao: 'AJUSTAR',
                observacoes: 'SIMULACAO ENTRADA 221'
            }
        });

        // 4. Sync
        await request(app.getHttpServer())
            .post('/sankhya/sync-adjustments')
            .set('Authorization', `Bearer ${authToken}`)
            .expect(201);

        const divFinal = await prisma.divergencia.findFirst({ where: { contagemId: contagem.id } });
        expect(divFinal?.adjustStatus).toBe('SYNCED');
        console.log(`✅ NUNOTA ENTRADA CONFIRMADA: ${divFinal?.adjustNoteId}`);
    });

    it('Deve criar nota real de SAÍDA (MGECOM 1121) e CONFIRMAR', async () => {
        const codprod = 2; // Produto X
        const codlocal = 10010000;
        const codemp = 1;

        // GARANTIR CUSTO DE REPOSIÇÃO (TGFCUS)
        // Como o ambiente de teste pode não ter custo, vamos inserir um dummy
        try {
            // Verificar se já tem custo
            const hasCost = await sankhyaClient.getReplacementCost(codprod, codemp, codlocal);
            if (!hasCost) {
                console.log('⚠️ Sem custo na TGFCUS. Inserindo custo dummy via CRUD...');
                const dtHoje = new Date().toISOString().split('T')[0].split('-').reverse().join('/'); // DD/MM/YYYY
                await sankhyaClient.saveRecord('Custo', {
                    CODPROD: codprod,
                    CODEMP: codemp,
                    CODLOCAL: codlocal,
                    DTATUAL: dtHoje,
                    CUSREP: 10.0,
                    CUSMED: 10.0,
                    CUSSEMICM: 10.0,
                    CUSGER: 10.0
                });
                console.log('✅ Custo dummy inserido na TGFCUS.');
            }

            // GARANTIR TABELA DE PREÇO (TGFEXC) - VALIDAÇÃO DO SANKHYA
            // Mesmo usando o custo, o TOP valida se existe preço de tabela.
            const precoTab = await sankhyaClient.executeQuery(`
                SELECT 1 FROM TGFEXC WHERE CODPROD = ${codprod} AND NUTAB IN (SELECT NUTAB FROM TGFTAB WHERE ATIVO = 'S')
            `);

            if (!precoTab || precoTab.length === 0) {
                console.log('⚠️ Sem preço de tabela (TGFEXC). Inserindo preço dummy via CRUD...');
                // Pegar primeira tabela ativa
                let nutab = 0;
                const tabAtiva = await sankhyaClient.executeQuery('SELECT MIN(NUTAB) as NUTAB FROM TGFTAB WHERE ATIVO = \'S\'');
                if (tabAtiva && tabAtiva.length > 0) {
                    nutab = tabAtiva[0].NUTAB;
                } else {
                    throw new Error('Nenhuma tabela de preço ativa encontrada.');
                }

                const dtVigor = new Date().toISOString().split('T')[0].split('-').reverse().join('/');

                // Usando saveRecord (CRUD) em vez de INSERT direto
                await sankhyaClient.saveRecord('Excecao', {
                    NUTAB: nutab,
                    CODPROD: codprod,
                    VLRVENDA: 10.0,
                    DTVIGOR: dtVigor,
                    TIPO: 'V',
                    MODBASEICMS: 'N',
                    ALIQUOTA: 0,
                    ADICIONAL: 0
                });
                console.log(`✅ Preço dummy inserido na TGFEXC (Tabela ${nutab}).`);
            }

        } catch (e) {
            console.warn('Falha ao garantir custo/preço (pode falhar se usuário não tiver permissão de INSERT direto):', e);
        }

        // Limpar
        await prisma.divergencia.deleteMany({});
        await prisma.contagem.deleteMany({});
        await prisma.filaContagem.deleteMany({ where: { codprod, codlocal, codemp } });

        // 1. Snapshot: Tem 10
        // 2. Contagem: Contou 8 (-2)
        const fila = await prisma.filaContagem.create({
            data: { codprod, codlocal, codemp, descprod: 'TEST SAIDA', status: 'PENDENTE' }
        });

        const contagem = await prisma.contagem.create({
            data: {
                codprod, codlocal, codemp, filaId: fila.id, tipo: 'CONTAGEM',
                qtdContada: 8, divergencia: -2, statusAnalise: 'DIVERGENCIA_PENDENTE',
                tsInicio: new Date(), tsFim: new Date(),
                userId: (await prisma.user.findFirst({ where: { role: UserRole.ADMIN } }))!.id
            }
        });

        await prisma.divergencia.create({
            data: {
                contagemId: contagem.id, status: 'ACEITO', decisao: 'AJUSTAR',
                observacoes: 'SIMULACAO SAIDA 1121'
            }
        });

        // 4. Sync
        await request(app.getHttpServer())
            .post('/sankhya/sync-adjustments')
            .set('Authorization', `Bearer ${authToken}`)
            .expect(201);

        const divFinal = await prisma.divergencia.findFirst({ where: { contagemId: contagem.id } });

        if (divFinal?.adjustStatus === 'ERROR') {
            console.error('❌ Erro SAÍDA:', divFinal.observacoes);
        }

        expect(divFinal?.adjustStatus).toBe('SYNCED');
        console.log(`✅ NUNOTA SAÍDA CONFIRMADA: ${divFinal?.adjustNoteId}`);
    });

    it('Deve tentar criar nota real usando o módulo MGECOM', async () => {


        const codprod = 2; // Produto X
        const codlocal = 10010000;
        const codemp = 1;

        const dataRef = new Date();
        dataRef.setHours(0, 0, 0, 0);
        await prisma.snapshotEstoque.upsert({
            where: { dataRef_codemp_codlocal_codprod: { dataRef, codemp, codlocal, codprod } },
            update: { saldoEspelho: 10, custoEspelho: 1.0 },
            create: {
                dataRef, codemp, codlocal, codprod,
                descprod: 'PRODUTO SIMULACAO NOTA',
                saldoEspelho: 10,
                custoEspelho: 1.0,
                valorEstoque: 10.0
            }
        });

        const fila = await prisma.filaContagem.upsert({
            where: { codprod_codlocal_codemp: { codprod, codlocal, codemp } },
            update: { status: FilaStatus.PENDENTE },
            create: {
                codprod, codlocal, codemp,
                descprod: 'PRODUTO SIMULACAO NOTA',
                status: FilaStatus.PENDENTE
            }
        });

        const contagem = await prisma.contagem.create({
            data: {
                codprod, codlocal, codemp,
                userId: (await prisma.user.findFirst({ where: { role: UserRole.ADMIN } }))!.id,
                filaId: fila.id,
                tipo: ContagemTipo.CONTAGEM,
                qtdContada: 12,
                tsInicio: new Date(),
                tsFim: new Date(),
                snapshotId: (await prisma.snapshotEstoque.findFirst({ where: { codprod } }))!.id,
                divergencia: 2,
                divergenciaPercent: 20,
                statusAnalise: 'DIVERGENCIA_PENDENTE'
            }
        });

        const div = await prisma.divergencia.create({
            data: {
                contagemId: contagem.id,
                status: DivergenciaStatus.ACEITO,
                decisao: Decisao.AJUSTAR,
                observacoes: 'SIMULACAO MGECOM ACRESCIMO 2'
            }
        });

        const syncRes = await request(app.getHttpServer())
            .post('/sankhya/sync-adjustments')
            .set('Authorization', `Bearer ${authToken}`)
            .expect(201);

        const divFinal = await prisma.divergencia.findUnique({
            where: { id: div.id }
        });

        if (divFinal?.adjustStatus === 'ERROR') {
            console.error('❌ Erro na Sincronização:', divFinal.observacoes);
        }

        expect(divFinal?.adjustStatus).toBe('SYNCED');
        expect(divFinal?.adjustNoteId).toBeDefined();
        console.log(`✅ NUNOTA GERAL: ${divFinal?.adjustNoteId}`);
    });
});
