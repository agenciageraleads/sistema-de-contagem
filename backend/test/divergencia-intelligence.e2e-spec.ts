import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FilaStatus, UserRole, StatusAnalise, DivergenciaStatus, ContagemTipo, Decisao } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Testes E2E para Inteligência de Divergência
 * 
 * Cobre os 3 fluxos implementados:
 * 1. Recontagem Automática (divergência > 5%)
 * 2. Regra "Não Achei" (guarda anti-duplicação + divergência formal)
 * 3. Ação FINALIZAR_ANALISE do supervisor
 * 
 * Pré-requisitos: Banco PostgreSQL rodando, app configurado.
 */
describe('Inteligência de Divergência (E2E)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    // Tokens e IDs de dois operadores + supervisor
    let operador1Token: string;
    let operador1Id: number;
    let operador2Token: string;
    let operador2Id: number;
    let supervisorToken: string;

    // Códigos de produto para cada cenário de teste
    const CODPROD_RECONTAGEM = 8880001;
    const CODPROD_NAO_ACHEI = 8880002;
    const CODPROD_FINALIZAR = 8880003;
    const CODLOCAL = 1;
    const CODEMP = 1;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe());
        await app.init();

        prisma = app.get<PrismaService>(PrismaService);

        const senhaHash = await bcrypt.hash('123456', 10);

        // Criar Operador 1
        const op1Login = 'test_op1_div_' + Date.now();
        const op1 = await prisma.user.create({
            data: { nome: 'Operador 1 Teste Div', login: op1Login, senhaHash, role: UserRole.OPERADOR, ativo: true },
        });
        operador1Id = op1.id;
        const login1Res = await request(app.getHttpServer()).post('/auth/login').send({ login: op1Login, senha: '123456' });
        operador1Token = login1Res.body.token;

        // Criar Operador 2
        const op2Login = 'test_op2_div_' + Date.now();
        const op2 = await prisma.user.create({
            data: { nome: 'Operador 2 Teste Div', login: op2Login, senhaHash, role: UserRole.OPERADOR, ativo: true },
        });
        operador2Id = op2.id;
        const login2Res = await request(app.getHttpServer()).post('/auth/login').send({ login: op2Login, senha: '123456' });
        operador2Token = login2Res.body.token;

        // Criar Supervisor
        const supLogin = 'test_sup_div_' + Date.now();
        await prisma.user.create({
            data: { nome: 'Supervisor Teste Div', login: supLogin, senhaHash, role: UserRole.SUPERVISOR, ativo: true },
        });
        const loginSupRes = await request(app.getHttpServer()).post('/auth/login').send({ login: supLogin, senha: '123456' });
        supervisorToken = loginSupRes.body.token;

        // Preparar dados base para todos os testes
        const dataRef = new Date();
        dataRef.setHours(0, 0, 0, 0);

        for (const codprod of [CODPROD_RECONTAGEM, CODPROD_NAO_ACHEI, CODPROD_FINALIZAR]) {
            // Limpar dados anteriores
            await prisma.divergencia.deleteMany({ where: { contagem: { codprod } } });
            await prisma.contagem.deleteMany({ where: { codprod } });
            await prisma.filaContagem.deleteMany({ where: { codprod } });
            await prisma.snapshotEstoque.deleteMany({ where: { codprod } });

            // Criar item na fila
            await prisma.filaContagem.create({
                data: {
                    codprod,
                    codlocal: CODLOCAL,
                    codemp: CODEMP,
                    descprod: `PRODUTO TESTE DIV ${codprod}`,
                    status: FilaStatus.PENDENTE,
                    prioridadeBase: 999, // Alta prioridade pra ser pego primeiro
                },
            });

            // Criar snapshot (esperado = 100 unidades)
            await prisma.snapshotEstoque.create({
                data: {
                    dataRef,
                    codemp: CODEMP,
                    codlocal: CODLOCAL,
                    codprod,
                    descprod: `PRODUTO TESTE DIV ${codprod}`,
                    saldoEspelho: 100,
                    custoEspelho: 10.00,
                    valorEstoque: 1000.00,
                },
            });
        }
    }, 60000);

    afterAll(async () => {
        // Limpeza dos dados de teste
        for (const codprod of [CODPROD_RECONTAGEM, CODPROD_NAO_ACHEI, CODPROD_FINALIZAR]) {
            await prisma.divergencia.deleteMany({ where: { contagem: { codprod } } });
            await prisma.contagem.deleteMany({ where: { codprod } });
            await prisma.filaContagem.deleteMany({ where: { codprod } });
            await prisma.snapshotEstoque.deleteMany({ where: { codprod } });
        }
        await app.close();
    });

    // ============================================================
    // CENÁRIO 1: Recontagem Automática (divergência > 5%)
    // ============================================================
    describe('Recontagem Automática', () => {
        it('1ª contagem com divergência > 5% → dispara recontagem automática', async () => {
            // Operador 1 busca o item
            // Precisamos garantir que pega o item certo, setando prioridade máxima
            await prisma.filaContagem.updateMany({
                where: { codprod: CODPROD_RECONTAGEM },
                data: { prioridadeBase: 99999, prioridadeManual: 99999 },
            });

            const proximoRes = await request(app.getHttpServer())
                .get('/contagem/proximo')
                .set('Authorization', `Bearer ${operador1Token}`)
                .expect(200);

            expect(proximoRes.body.codprod).toBe(CODPROD_RECONTAGEM);
            const filaId = proximoRes.body.id;

            // Registra contagem com divergência de 20% (contou 80, esperado 100)
            const registrarRes = await request(app.getHttpServer())
                .post('/contagem/registrar')
                .set('Authorization', `Bearer ${operador1Token}`)
                .send({ filaId, qtd_contada: 80 })
                .expect(201);

            console.log('📊 Resultado 1ª contagem:', JSON.stringify(registrarRes.body));

            expect(registrarRes.body.status).toBe(StatusAnalise.DIVERGENCIA_PENDENTE);
            expect(registrarRes.body.acao).toBe('RECONTAGEM_AUTOMATICA');
            expect(registrarRes.body.percDivergencia).toBeGreaterThan(5);

            // Verificar que o item voltou para a fila com prioridade máxima
            const filaAtualizada = await prisma.filaContagem.findFirst({
                where: { codprod: CODPROD_RECONTAGEM },
            });
            expect(filaAtualizada!.status).toBe(FilaStatus.PENDENTE);
            expect(filaAtualizada!.prioridadeManual).toBe(9999);
            expect(filaAtualizada!.recontagens).toBe(1);
        });

        it('2ª contagem (recontagem) que CONFIRMA divergência → vai para supervisor', async () => {
            // Operador 2 busca o item (recontagem)
            await prisma.filaContagem.updateMany({
                where: { codprod: CODPROD_RECONTAGEM },
                data: { prioridadeManual: 99999 },
            });

            const proximoRes = await request(app.getHttpServer())
                .get('/contagem/proximo')
                .set('Authorization', `Bearer ${operador2Token}`)
                .expect(200);

            expect(proximoRes.body.codprod).toBe(CODPROD_RECONTAGEM);
            const filaId = proximoRes.body.id;

            // Recontagem confirma a divergência (contou 82, ainda divergente)
            const registrarRes = await request(app.getHttpServer())
                .post('/contagem/registrar')
                .set('Authorization', `Bearer ${operador2Token}`)
                .send({ filaId, qtd_contada: 82 })
                .expect(201);

            console.log('📊 Resultado recontagem:', JSON.stringify(registrarRes.body));

            expect(registrarRes.body.status).toBe(StatusAnalise.DIVERGENCIA_PENDENTE);
            expect(registrarRes.body.acao).toBe('BLOQUEADO_AUDITORIA');

            // Verificar que o item ficou bloqueado para auditoria
            const filaAtualizada = await prisma.filaContagem.findFirst({
                where: { codprod: CODPROD_RECONTAGEM },
            });
            expect(filaAtualizada!.status).toBe(FilaStatus.BLOQUEADO_AUDITORIA);

            // Verificar que a divergência tem observações de movimentações
            const div = await prisma.divergencia.findFirst({
                where: {
                    contagem: { codprod: CODPROD_RECONTAGEM, tipo: ContagemTipo.RECONTAGEM },
                },
                orderBy: { createdAt: 'desc' },
            });
            expect(div).toBeDefined();
            expect(div!.observacoes).toContain('Recontagem confirmou divergência');
            console.log('📋 Divergência criada com obs:', div!.observacoes);
            console.log('📦 Movimentações:', div!.movimentacoes);
        });
    });

    // ============================================================
    // CENÁRIO 2: Contagem OK (sem divergência → CONCLUIDO)
    // ============================================================
    describe('Contagem OK', () => {
        it('Contagem sem divergência → item finalizado automaticamente', async () => {
            // Preparar um item novo para este teste
            const codprodOk = 8880099;
            await prisma.divergencia.deleteMany({ where: { contagem: { codprod: codprodOk } } });
            await prisma.contagem.deleteMany({ where: { codprod: codprodOk } });
            await prisma.filaContagem.deleteMany({ where: { codprod: codprodOk } });
            await prisma.snapshotEstoque.deleteMany({ where: { codprod: codprodOk } });

            const dataRef = new Date();
            dataRef.setHours(0, 0, 0, 0);

            await prisma.filaContagem.create({
                data: {
                    codprod: codprodOk, codlocal: CODLOCAL, codemp: CODEMP,
                    descprod: 'PRODUTO OK', status: FilaStatus.PENDENTE,
                    prioridadeBase: 999999,
                    prioridadeManual: 999999,
                },
            });
            await prisma.snapshotEstoque.create({
                data: {
                    dataRef, codemp: CODEMP, codlocal: CODLOCAL, codprod: codprodOk,
                    descprod: 'PRODUTO OK', saldoEspelho: 50, custoEspelho: 5, valorEstoque: 250,
                },
            });

            const proximoRes = await request(app.getHttpServer())
                .get('/contagem/proximo')
                .set('Authorization', `Bearer ${operador1Token}`)
                .expect(200);

            expect(proximoRes.body.codprod).toBe(codprodOk);

            // Contagem exata: 50 = 50
            const registrarRes = await request(app.getHttpServer())
                .post('/contagem/registrar')
                .set('Authorization', `Bearer ${operador1Token}`)
                .send({ filaId: proximoRes.body.id, qtd_contada: 50 })
                .expect(201);

            expect(registrarRes.body.status).toBe(StatusAnalise.OK_AUTOMATICO);
            expect(registrarRes.body.acao).toBe('CONCLUIDO');

            // Limpar
            await prisma.divergencia.deleteMany({ where: { contagem: { codprod: codprodOk } } });
            await prisma.contagem.deleteMany({ where: { codprod: codprodOk } });
            await prisma.filaContagem.deleteMany({ where: { codprod: codprodOk } });
            await prisma.snapshotEstoque.deleteMany({ where: { codprod: codprodOk } });
        });
    });

    // ============================================================
    // CENÁRIO 3: Regra "Não Achei"
    // ============================================================
    describe('Regra "Não Achei"', () => {
        it('Operador 1 marca "Não Achei" → item volta pra fila', async () => {
            // Garantir item pendente com alta prioridade
            await prisma.filaContagem.updateMany({
                where: { codprod: CODPROD_NAO_ACHEI },
                data: {
                    status: FilaStatus.PENDENTE,
                    prioridadeBase: 99999,
                    prioridadeManual: 99999,
                    lockedBy: null,
                    lockedAt: null,
                    naoAchouCount: 0,
                    ultimoNaoAchouPor: null,
                },
            });

            // Operador 1 busca o item
            const proximoRes = await request(app.getHttpServer())
                .get('/contagem/proximo')
                .set('Authorization', `Bearer ${operador1Token}`)
                .expect(200);

            expect(proximoRes.body.codprod).toBe(CODPROD_NAO_ACHEI);
            const filaId = proximoRes.body.id;

            // Marca como "Não Achei"
            const naoAcheiRes = await request(app.getHttpServer())
                .post(`/contagem/nao-achei/${filaId}`)
                .set('Authorization', `Bearer ${operador1Token}`)
                .expect(201);

            console.log('🔎 1° Não Achei:', JSON.stringify(naoAcheiRes.body));
            expect(naoAcheiRes.body.naoAchouCount).toBe(1);
            expect(naoAcheiRes.body.bloqueado).toBe(false);

            // Verificar que o item está PENDENTE (volta pra fila)
            const fila = await prisma.filaContagem.findFirst({ where: { codprod: CODPROD_NAO_ACHEI } });
            expect(fila!.status).toBe(FilaStatus.PENDENTE);
            expect(fila!.ultimoNaoAchouPor).toBe(operador1Id);
        });

        it('Mesmo operador não pode marcar "Não Achei" 2x', async () => {
            // Travar item pro operador 1 de novo
            await prisma.filaContagem.updateMany({
                where: { codprod: CODPROD_NAO_ACHEI },
                data: {
                    status: FilaStatus.EM_CONTAGEM,
                    lockedBy: operador1Id,
                    lockedAt: new Date(),
                    prioridadeManual: 99999,
                },
            });

            const fila = await prisma.filaContagem.findFirst({ where: { codprod: CODPROD_NAO_ACHEI } });

            const res = await request(app.getHttpServer())
                .post(`/contagem/nao-achei/${fila!.id}`)
                .set('Authorization', `Bearer ${operador1Token}`)
                .expect(400); // BadRequest esperado

            console.log('🚫 Guarda anti-duplicação:', res.body.message);
            expect(res.body.message).toContain('Você já marcou');
        });

        it('Operador 2 marca "Não Achei" (2x total) → Divergência ALTA criada', async () => {
            // Liberar item e travar pro operador 2
            await prisma.filaContagem.updateMany({
                where: { codprod: CODPROD_NAO_ACHEI },
                data: {
                    status: FilaStatus.EM_CONTAGEM,
                    lockedBy: operador2Id,
                    lockedAt: new Date(),
                    prioridadeManual: 99999,
                },
            });

            const fila = await prisma.filaContagem.findFirst({ where: { codprod: CODPROD_NAO_ACHEI } });

            const naoAcheiRes = await request(app.getHttpServer())
                .post(`/contagem/nao-achei/${fila!.id}`)
                .set('Authorization', `Bearer ${operador2Token}`)
                .expect(201);

            console.log('🚨 2° Não Achei:', JSON.stringify(naoAcheiRes.body));
            expect(naoAcheiRes.body.naoAchouCount).toBe(2);
            expect(naoAcheiRes.body.bloqueado).toBe(true);

            // Verificar item bloqueado para auditoria
            const filaAtualizada = await prisma.filaContagem.findFirst({ where: { codprod: CODPROD_NAO_ACHEI } });
            expect(filaAtualizada!.status).toBe(FilaStatus.BLOQUEADO_AUDITORIA);

            // Verificar divergência formal criada
            const div = await prisma.divergencia.findFirst({
                where: { contagem: { codprod: CODPROD_NAO_ACHEI, tipo: ContagemTipo.NAO_ACHOU } },
                orderBy: { createdAt: 'desc' },
            });
            expect(div).toBeDefined();
            expect(div!.severidade).toBe('ALTA');
            expect(div!.observacoes).toContain('2 operadores diferentes');
            console.log('📋 Divergência NAO_ACHOU:', div!.observacoes);
        });
    });

    // ============================================================
    // CENÁRIO 4: Ação FINALIZAR_ANALISE do Supervisor
    // ============================================================
    describe('Ação FINALIZAR_ANALISE', () => {
        it('Supervisor finaliza análise → item vai pro final da fila', async () => {
            // Preparar: criar divergência para o item CODPROD_FINALIZAR
            await prisma.filaContagem.updateMany({
                where: { codprod: CODPROD_FINALIZAR },
                data: {
                    status: FilaStatus.EM_CONTAGEM,
                    lockedBy: operador1Id,
                    lockedAt: new Date(),
                    prioridadeBase: 99999,
                    prioridadeManual: 99999,
                    naoAchouCount: 2,
                    recontagens: 1,
                },
            });

            // Registrar contagem divergente
            const fila = await prisma.filaContagem.findFirst({ where: { codprod: CODPROD_FINALIZAR } });
            const registrarRes = await request(app.getHttpServer())
                .post('/contagem/registrar')
                .set('Authorization', `Bearer ${operador1Token}`)
                .send({ filaId: fila!.id, qtd_contada: 50 }) // 50 vs 100 = 50% divergência
                .expect(201);

            // Buscar a divergência criada
            const div = await prisma.divergencia.findFirst({
                where: { contagem: { codprod: CODPROD_FINALIZAR } },
                orderBy: { createdAt: 'desc' },
            });
            expect(div).toBeDefined();

            // Supervisor finaliza a análise
            const tratarRes = await request(app.getHttpServer())
                .post(`/contagem/divergencias/${div!.id}/tratar`)
                .set('Authorization', `Bearer ${supervisorToken}`)
                .send({ acao: 'FINALIZAR_ANALISE', observacao: 'Produto em investigação' })
                .expect(201);

            console.log('✅ FINALIZAR_ANALISE:', tratarRes.body.message);
            expect(tratarRes.body.message).toContain('final da fila');

            // Verificar que o item voltou PENDENTE com contadores resetados
            const filaAtualizada = await prisma.filaContagem.findFirst({ where: { codprod: CODPROD_FINALIZAR } });
            expect(filaAtualizada!.status).toBe(FilaStatus.PENDENTE);
            expect(filaAtualizada!.prioridadeManual).toBe(0);
            expect(filaAtualizada!.naoAchouCount).toBe(0);
            expect(filaAtualizada!.recontagens).toBe(0);

            // Verificar decisão da divergência
            const divAtualizada = await prisma.divergencia.findUnique({ where: { id: div!.id } });
            expect(divAtualizada!.decisao).toBe(Decisao.FINALIZAR_ANALISE);
            expect(divAtualizada!.status).toBe(DivergenciaStatus.CONCLUIDO);
        });
    });
});
