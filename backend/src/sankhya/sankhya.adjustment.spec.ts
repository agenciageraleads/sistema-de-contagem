import { Test, TestingModule } from '@nestjs/testing';
import { SankhyaService } from './sankhya.service';
import { SankhyaClient } from './sankhya.client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { DivergenciaStatus, Decisao, FilaStatus, ContagemTipo } from '@prisma/client';

describe('Sankhya Adjustment Integration', () => {
    let service: SankhyaService;
    let prisma: PrismaService;
    let sankhyaClient: SankhyaClient;

    beforeAll(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SankhyaService,
                PrismaService,
                {
                    provide: SankhyaClient,
                    useValue: {
                        createAdjustmentNote: jest.fn().mockResolvedValue(123456),
                        executeQuery: jest.fn().mockResolvedValue([]),
                        authenticate: jest.fn().mockResolvedValue(undefined),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string) => {
                            if (key === 'CODEMP') return 1;
                            if (key === 'SANKHYA_CLIENT_ID') return 'fake-client-id';
                            return null;
                        },
                    },
                },
            ],
        }).compile();

        service = module.get<SankhyaService>(SankhyaService);
        prisma = module.get<PrismaService>(PrismaService);
        sankhyaClient = module.get<SankhyaClient>(SankhyaClient);
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('should create an adjustment note for approved divergences', async () => {
        // 1. Limpar e Preparar Cenário
        await prisma.divergencia.deleteMany({});
        await prisma.contagem.deleteMany({});
        await prisma.filaContagem.deleteMany({});
        await prisma.snapshotEstoque.deleteMany({});

        const codprod = 99999;
        const codlocal = 10010000;
        const codemp = 1;

        const snapshot = await prisma.snapshotEstoque.create({
            data: {
                dataRef: new Date(),
                codemp,
                codlocal,
                codprod,
                descprod: 'PRODUTO TESTE JEST',
                saldoEspelho: 10,
                custoEspelho: 5.0,
                valorEstoque: 50.0,
                unidade: 'UN'
            }
        });

        const fila = await prisma.filaContagem.create({
            data: {
                codprod,
                codlocal,
                codemp,
                descprod: 'PRODUTO TESTE JEST',
                status: FilaStatus.CONCLUIDO
            }
        });

        const contagem = await prisma.contagem.create({
            data: {
                codprod,
                codlocal,
                codemp,
                userId: 1, // Need existing user or skip constraint if user mock not needed for this part
                filaId: fila.id,
                tipo: ContagemTipo.CONTAGEM,
                qtdContada: 12, // +2
                tsInicio: new Date(),
                snapshotId: snapshot.id,
                divergencia: 2,
                divergenciaPercent: 20,
                statusAnalise: 'DIVERGENCIA_PENDENTE'
            }
        });

        // Ensure user exists for contagem relation if foreign key enforced
        // But since we reset DB, user 1 might not exist. Let's create a user first.
        const user = await prisma.user.upsert({
            where: { id: 1 },
            update: {},
            create: {
                id: 1,
                nome: 'Test User',
                login: 'testuser',
                senhaHash: 'hash',
                role: 'ADMIN'
            }
        });

        const divergencia = await prisma.divergencia.create({
            data: {
                contagemId: contagem.id,
                status: DivergenciaStatus.ACEITO,
                decisao: Decisao.AJUSTAR,
                observacoes: 'Aprovado via Jest',
                aprovadoPor: 1
            }
        });

        // 2. Executar Lógica
        const result = await service.syncPendingAdjustments();

        // 3. Verificações
        expect(result.processed).toBe(1);
        expect(result.notasCreated).toBe(1);
        expect(sankhyaClient.createAdjustmentNote).toHaveBeenCalled();

        const divAtualizada = await prisma.divergencia.findUnique({
            where: { id: divergencia.id }
        });

        expect(divAtualizada?.adjustStatus).toBe('SYNCED');
        expect(divAtualizada?.adjustNoteId).toBe(123456);
    });
});
