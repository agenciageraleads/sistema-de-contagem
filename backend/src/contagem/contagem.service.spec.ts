import { Test, TestingModule } from '@nestjs/testing';
import { ContagemService } from './contagem.service';
import { PrismaService } from '../prisma/prisma.service';
import { FilaStatus, ContagemTipo, StatusAnalise } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('ContagemService', () => {
    let service: ContagemService;
    let prisma: PrismaService;

    const mockPrismaService = {
        filaContagem: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        snapshotEstoque: {
            findFirst: jest.fn(),
        },
        contagem: {
            create: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
        },
        divergencia: {
            create: jest.fn(),
        },
        metaUser: {
            findFirst: jest.fn(),
        },
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ContagemService,
                {
                    provide: PrismaService,
                    useValue: mockPrismaService,
                },
            ],
        }).compile();

        service = module.get<ContagemService>(ContagemService);
        prisma = module.get<PrismaService>(PrismaService);
        jest.clearAllMocks();
    });

    describe('buscaProximo', () => {
        it('deve retornar item já travado se o usuário já tiver um', async () => {
            const mockItem = { id: 1, codprod: 10, status: FilaStatus.EM_CONTAGEM, lockedBy: 1 };
            mockPrismaService.filaContagem.findFirst.mockResolvedValueOnce(mockItem);

            const result = await service.buscaProximo(1);

            expect(result).toEqual(mockItem);
            expect(prisma.filaContagem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: { lockedBy: 1, status: FilaStatus.EM_CONTAGEM }
            }));
        });

        it('deve buscar novo item e travar se não houver um travado', async () => {
            mockPrismaService.filaContagem.findFirst.mockResolvedValueOnce(null); // Nenhum travado
            mockPrismaService.filaContagem.findFirst.mockResolvedValueOnce({ id: 2, codprod: 20 }); // Próximo da fila
            mockPrismaService.filaContagem.update.mockResolvedValueOnce({ id: 2, status: FilaStatus.EM_CONTAGEM });

            const result = await service.buscaProximo(1);

            expect(result).not.toBeNull();
            if (result) {
                expect(result.status).toBe(FilaStatus.EM_CONTAGEM);
            }
            expect(prisma.filaContagem.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 2 },
                data: expect.objectContaining({ lockedBy: 1, status: FilaStatus.EM_CONTAGEM })
            }));
        });
    });

    describe('registrar', () => {
        const mockFila = { id: 1, codprod: 10, codlocal: 1, codemp: 1, lockedBy: 1, lockedAt: new Date() };
        const mockSnapshot = { id: 100, saldoEspelho: 10 };

        it('deve lançar erro se o item não estiver travado para o usuário', async () => {
            mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(null);
            await expect(service.registrar(1, { filaId: 1, qtd_contada: 10 }))
                .rejects.toThrow(BadRequestException);
        });

        it('deve registrar OK_AUTOMATICO quando a contagem bate', async () => {
            mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);
            mockPrismaService.snapshotEstoque.findFirst.mockResolvedValueOnce(mockSnapshot);
            mockPrismaService.contagem.findFirst.mockResolvedValueOnce(null); // Sem contagem anterior
            mockPrismaService.contagem.create.mockResolvedValueOnce({ id: 50, statusAnalise: StatusAnalise.OK_AUTOMATICO });

            const result = await service.registrar(1, { filaId: 1, qtd_contada: 10 });

            expect(result.status).toBe(StatusAnalise.OK_AUTOMATICO);
            expect(prisma.contagem.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ statusAnalise: StatusAnalise.OK_AUTOMATICO })
            }));
            // Verifica se incrementou contagensOk
            expect(prisma.filaContagem.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ contagensOk: { increment: 1 } })
            }));
        });

        it('deve registrar DIVERGENCIA_PENDENTE e criar registro de divergência quando não bate', async () => {
            mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);
            mockPrismaService.snapshotEstoque.findFirst.mockResolvedValueOnce(mockSnapshot);
            mockPrismaService.contagem.findFirst.mockResolvedValueOnce(null); // Sem contagem anterior
            mockPrismaService.contagem.create.mockResolvedValueOnce({ id: 51, statusAnalise: StatusAnalise.DIVERGENCIA_PENDENTE });

            const result = await service.registrar(1, { filaId: 1, qtd_contada: 12 });

            expect(result.status).toBe(StatusAnalise.DIVERGENCIA_PENDENTE);
            expect(prisma.divergencia.create).toHaveBeenCalled();
            // Verifica se RESETOU contagensOk
            expect(prisma.filaContagem.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ contagensOk: 0 })
            }));
        });
    });

    describe('naoAchei', () => {
        it('deve zerar prioridades e liberar item', async () => {
            const mockFila = { id: 1, lockedBy: 1, naoAchouCount: 0 };
            mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);

            const result = await service.naoAchei(1, 1);

            expect(result.naoAchouCount).toBe(1);
            expect(prisma.filaContagem.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    prioridadeManual: 0,
                    prioridadeBase: 0,
                    status: FilaStatus.PENDENTE,
                    lockedBy: null
                })
            }));
        });

        it('deve bloquear para auditoria se for a segunda vez que não acha', async () => {
            const mockFila = { id: 1, lockedBy: 1, naoAchouCount: 1 };
            mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);

            const result = await service.naoAchei(1, 1);

            expect(result.status).toBe(FilaStatus.BLOQUEADO_AUDITORIA);
            expect(prisma.filaContagem.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: FilaStatus.BLOQUEADO_AUDITORIA })
            }));
        });
    });
});
