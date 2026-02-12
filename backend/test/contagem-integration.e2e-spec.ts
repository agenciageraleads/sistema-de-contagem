import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FilaStatus, UserRole, StatusAnalise } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('Fluxo de Contagem (Integration)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let authToken: string;
    let testUserId: number;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe());
        await app.init();

        prisma = app.get<PrismaService>(PrismaService);

        // Configurar Usuário de Teste
        const login = 'test_operador_' + Date.now();
        const senhaHash = await bcrypt.hash('123456', 10);

        const user = await prisma.user.upsert({
            where: { login },
            update: {},
            create: {
                nome: 'Test Operador',
                login,
                senhaHash,
                role: UserRole.OPERADOR,
                ativo: true,
            },
        });
        testUserId = user.id;

        // Login para obter Token
        const loginRes = await request(app.getHttpServer())
            .post('/auth/login')
            .send({ login, senha: '123456' });

        authToken = loginRes.body.token;
    });

    afterAll(async () => {
        // Limpeza opcional ou manter para auditoria conforme o usuário autorizou
        await app.close();
    });

    it('Deve realizar o fluxo completo: Buscar Próximo -> Registrar com Divergência', async () => {
        // 1. Preparar Fila
        const codprod = 9999901; // ID fictício para teste
        await prisma.filaContagem.upsert({
            where: { codprod_codlocal_codemp: { codprod, codlocal: 1, codemp: 1 } },
            update: { status: FilaStatus.PENDENTE, lockedBy: null, lockedAt: null },
            create: {
                codprod,
                codlocal: 1,
                codemp: 1,
                descprod: 'PRODUTO TESTE E2E',
                status: FilaStatus.PENDENTE,
                prioridadeBase: 100,
            }
        });

        // 2. Preparar Snapshot (Simular que o Sankhya diz que tem 10 itens)
        const dataRef = new Date();
        dataRef.setHours(0, 0, 0, 0);

        await prisma.snapshotEstoque.upsert({
            where: { dataRef_codemp_codlocal_codprod: { dataRef, codemp: 1, codlocal: 1, codprod } },
            update: { saldoEspelho: 10 },
            create: {
                dataRef,
                codemp: 1,
                codlocal: 1,
                codprod,
                descprod: 'PRODUTO TESTE E2E',
                saldoEspelho: 10,
                custoEspelho: 5.50,
                valorEstoque: 55.00
            }
        });

        // 3. Buscar Próximo Item (Operador)
        const proximoRes = await request(app.getHttpServer())
            .get('/contagem/proximo')
            .set('Authorization', `Bearer ${authToken}`)
            .expect(200);

        expect(proximoRes.body.codprod).toBe(codprod);
        const filaId = proximoRes.body.id;

        // 4. Registrar Contagem com Divergência (Contou 12, mas espera 10)
        const registrarRes = await request(app.getHttpServer())
            .post('/contagem/registrar')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
                filaId,
                qtd_contada: 12
            })
            .expect(201);

        expect(registrarRes.body.status).toBe(StatusAnalise.DIVERGENCIA_PENDENTE);

        // 5. Validar se a divergência foi criada no banco
        const div = await prisma.divergencia.findFirst({
            where: { contagem: { filaId } }
        });

        expect(div).toBeDefined();
        expect(div.status).toBe('PENDENTE');
    });
});
