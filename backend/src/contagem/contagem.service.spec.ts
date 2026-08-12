import { Test, TestingModule } from '@nestjs/testing';
import { ContagemService } from './contagem.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  Decisao,
  DivergenciaStatus,
  FilaStatus,
  ContagemTipo,
  StatusAnalise,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { SankhyaClient } from '../sankhya/sankhya.client';
import { SankhyaService } from '../sankhya/sankhya.service';

describe('ContagemService', () => {
  let service: ContagemService;
  let prisma: PrismaService;

  const mockPrismaService = {
    filaContagem: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    snapshotEstoque: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    contagem: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    divergencia: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    metaUser: {
      findFirst: jest.fn(),
    },
  };

  const mockSankhyaClient = {
    getMovimentacoes: jest.fn(),
    executeQuery: jest.fn(),
  };

  const mockSankhyaService = {
    fetchLiveStockFromSankhya: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContagemService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: SankhyaClient,
          useValue: mockSankhyaClient,
        },
        {
          provide: SankhyaService,
          useValue: mockSankhyaService,
        },
      ],
    }).compile();

    service = module.get<ContagemService>(ContagemService);
    prisma = module.get<PrismaService>(PrismaService);
    process.env.CONTAGEM_QUEUE_STRATEGY = 'legacy';
    process.env.INVENTARIO_LOCAL_VALIDATION = 'true';
    delete process.env.INVENTARIO_DIRECIONADA_SANKHYA_ENABLED;
    delete process.env.INVENTARIO_SANKHYA_RESSALVA_ENABLED;
    jest.clearAllMocks();
    mockSankhyaClient.getMovimentacoes.mockResolvedValue([]);
    mockSankhyaClient.executeQuery.mockResolvedValue([]);
    mockSankhyaService.fetchLiveStockFromSankhya.mockResolvedValue({
      saldo: 0,
      reservado: 0,
      disponivel: 0,
    });
  });

  const codigoBarrasTeste = '7891234567890';
  const dtoContagem = (qtd_contada: number) => ({
    filaId: 1,
    qtd_contada,
    codigo_barras_lido: codigoBarrasTeste,
  });

  describe('buscaProximo', () => {
    it('deve retornar item já travado se o usuário já tiver um', async () => {
      const mockItem = {
        id: 1,
        codprod: 10,
        status: FilaStatus.EM_CONTAGEM,
        lockedBy: 1,
      };
      mockPrismaService.filaContagem.findFirst.mockResolvedValueOnce(mockItem);

      const result = await service.buscaProximo(1);

      expect(result).toEqual(
        expect.objectContaining(mockItem),
      );
      expect(prisma.filaContagem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { lockedBy: 1, status: FilaStatus.EM_CONTAGEM },
        }),
      );
    });

    it('deve buscar novo item e travar se não houver um travado', async () => {
      mockPrismaService.filaContagem.findFirst.mockResolvedValueOnce(null); // Nenhum travado
      mockPrismaService.filaContagem.findFirst.mockResolvedValueOnce({
        id: 2,
        codprod: 20,
      }); // Próximo da fila
      mockPrismaService.filaContagem.update.mockResolvedValueOnce({
        id: 2,
        status: FilaStatus.EM_CONTAGEM,
      });

      const result = await service.buscaProximo(1);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.status).toBe(FilaStatus.EM_CONTAGEM);
      }
      expect(prisma.filaContagem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 2 },
          data: expect.objectContaining({
            lockedBy: 1,
            status: FilaStatus.EM_CONTAGEM,
          }),
        }),
      );
    });

    it('deve priorizar recontagem crítica antes de item comum já travado', async () => {
      mockPrismaService.filaContagem.findFirst
        .mockResolvedValueOnce({
          id: 10,
          codprod: 12762,
          prioridadeManual: 0,
          status: FilaStatus.EM_CONTAGEM,
          lockedBy: 6,
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 99,
          codprod: 15720,
          prioridadeManual: 9999,
          status: FilaStatus.PENDENTE,
          lockedBy: null,
        });
      mockPrismaService.filaContagem.update
        .mockResolvedValueOnce({
          id: 10,
          status: FilaStatus.PENDENTE,
        })
        .mockResolvedValueOnce({
          id: 99,
          status: FilaStatus.EM_CONTAGEM,
          lockedBy: 6,
        });

      const result = await service.buscaProximo(6);

      expect(result).toEqual(
        expect.objectContaining({
          id: 99,
          status: FilaStatus.EM_CONTAGEM,
          lockedBy: 6,
        }),
      );
      expect(prisma.filaContagem.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({
            status: FilaStatus.PENDENTE,
            lockedBy: null,
            lockedAt: null,
          }),
        }),
      );
      expect(prisma.filaContagem.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: 99 },
          data: expect.objectContaining({
            status: FilaStatus.EM_CONTAGEM,
            lockedBy: 6,
          }),
        }),
      );
    });
  });

  describe('contagem direcionada', () => {
    it('deve listar a cópia de estoque em modo local usando a fila e o snapshot local', async () => {
      process.env.INVENTARIO_LOCAL_VALIDATION = 'true';
      mockPrismaService.filaContagem.findMany.mockResolvedValueOnce([
        {
          id: 10,
          codprod: 12701,
          codemp: 1,
          codlocal: 10010000,
          descprod: 'ELETROCALHA PERFURADA',
          controle: 'PADRAO',
          unidade: 'UN',
          status: FilaStatus.PENDENTE,
          priorizadoPor: null,
        },
      ]);
      mockPrismaService.snapshotEstoque.findMany.mockResolvedValueOnce([
        {
          codprod: 12701,
          codemp: 1,
          codlocal: 10010000,
          saldoEspelho: 8,
          dataRef: new Date('2026-08-06T00:00:00'),
        },
      ]);

      const result = await service.buscarCopiaEstoqueSankhya({
        codemp: 1,
        codlocal: 10010000,
        busca: 'eletrocalha',
      });

      expect(result).toEqual([
        expect.objectContaining({
          codprod: 12701,
          descprod: 'ELETROCALHA PERFURADA',
          qtdCopiada: 8,
          statusFila: FilaStatus.PENDENTE,
        }),
      ]);
      expect(mockSankhyaClient.executeQuery).not.toHaveBeenCalled();
    });

    it('deve buscar a cópia real do Sankhya quando a contagem direcionada estiver habilitada', async () => {
      process.env.INVENTARIO_LOCAL_VALIDATION = 'true';
      process.env.INVENTARIO_DIRECIONADA_SANKHYA_ENABLED = 'true';
      mockSankhyaClient.executeQuery.mockResolvedValueOnce([
        {
          CODEMP: 1,
          CODPROD: 15720,
          DESCRPROD: '1 INTER PARALELO + TOM 2P+T 10A BC',
          CODLOCAL: 10010000,
          DESCRLOCAL: 'PORTAL',
          CONTROLE: ' ',
          CODVOL: 'UN',
          QTD_COPIADA: 23,
          DATA_COPIA: '2026-08-07',
        },
      ]);

      const result = await service.buscarCopiaEstoqueSankhya({
        data: '2026-08-07',
        codemp: 1,
        codlocal: 10010000,
        sequencia: 1,
      });

      expect(result).toEqual([
        expect.objectContaining({
          codprod: 15720,
          qtdCopiada: 23,
          dataCopia: '2026-08-07',
        }),
      ]);
      expect(mockSankhyaClient.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM TGFCTE CTE'),
      );
      expect(mockPrismaService.filaContagem.findMany).not.toHaveBeenCalled();
    });

    it('deve direcionar item pendente para o operador selecionado', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: 2,
        nome: 'Operador Teste',
        login: 'operador',
        role: 'OPERADOR',
        ativo: true,
      });
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce({
        id: 15,
        codprod: 12701,
        codemp: 1,
        codlocal: 10010000,
        status: FilaStatus.PENDENTE,
      });
      mockPrismaService.filaContagem.update.mockResolvedValueOnce({
        id: 15,
        codprod: 12701,
      });

      const result = await service.direcionarContagem(
        {
          operadorId: 2,
          motivo: 'Compra iluminação',
          itens: [{ codprod: 12701, codemp: 1, codlocal: 10010000 }],
        },
        1,
      );

      expect(result.direcionados).toHaveLength(1);
      expect(prisma.filaContagem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 15 },
          data: expect.objectContaining({
            status: FilaStatus.PENDENTE,
            prioridadeManual: 9000,
            priorizadoPor: 2,
            motivoPriorizacao: 'CONTAGEM_DIRECIONADA: Compra iluminação',
          }),
        }),
      );
    });

    it('não deve sobrescrever item em auditoria ao direcionar contagem', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: 2,
        nome: 'Operador Teste',
        login: 'operador',
        role: 'OPERADOR',
        ativo: true,
      });
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce({
        id: 15,
        codprod: 12701,
        codemp: 1,
        codlocal: 10010000,
        status: FilaStatus.BLOQUEADO_AUDITORIA,
      });

      const result = await service.direcionarContagem(
        {
          operadorId: 2,
          itens: [{ codprod: 12701, codemp: 1, codlocal: 10010000 }],
        },
        1,
      );

      expect(result.direcionados).toHaveLength(0);
      expect(result.conflitos).toEqual([
        { codprod: 12701, motivo: 'Item está em auditoria ou reportado' },
      ]);
      expect(prisma.filaContagem.update).not.toHaveBeenCalled();
    });
  });

  describe('registrar', () => {
    const mockFila = {
      id: 1,
      codprod: 10,
      codlocal: 1,
      codemp: 1,
      lockedBy: 1,
      lockedAt: new Date(),
      codigoBarrasCadastro: codigoBarrasTeste,
    };
    const mockSnapshot = {
      id: 100,
      saldoEspelho: 10,
      codigoBarrasCadastro: codigoBarrasTeste,
    };

    it('deve lançar erro se o item não estiver travado para o usuário', async () => {
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.registrar(1, dtoContagem(10)),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve registrar OK_AUTOMATICO quando a contagem bate', async () => {
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);
      mockPrismaService.snapshotEstoque.findFirst.mockResolvedValueOnce(
        mockSnapshot,
      );
      mockPrismaService.contagem.findMany.mockResolvedValueOnce([]); // Sem contagem anterior
      mockPrismaService.contagem.create.mockResolvedValueOnce({
        id: 50,
        statusAnalise: StatusAnalise.OK_AUTOMATICO,
      });

      const result = await service.registrar(1, dtoContagem(10));

      expect(result.status).toBe(StatusAnalise.OK_AUTOMATICO);
      expect(prisma.contagem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statusAnalise: StatusAnalise.OK_AUTOMATICO,
          }),
        }),
      );
      // Verifica se incrementou contagensOk
      expect(prisma.filaContagem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contagensOk: { increment: 1 } }),
        }),
      );
    });

    it('deve usar saldo vivo do Sankhya quando o snapshot local estiver desatualizado', async () => {
      delete process.env.INVENTARIO_LOCAL_VALIDATION;
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce({
        ...mockFila,
        codprod: 10236,
        descprod: 'ABRAC TIPO "U" 3/4" P/ PERFIL',
      });
      mockPrismaService.snapshotEstoque.findFirst.mockResolvedValueOnce({
        id: 584991,
        saldoEspelho: 0,
        dataRef: new Date('2026-07-20T00:00:00'),
        codigoBarrasCadastro: codigoBarrasTeste,
      });
      mockSankhyaService.fetchLiveStockFromSankhya.mockResolvedValueOnce({
        saldo: 503,
        reservado: 6,
        disponivel: 497,
      });
      mockPrismaService.contagem.findMany.mockResolvedValueOnce([]);
      mockPrismaService.contagem.create.mockResolvedValueOnce({
        id: 52,
        statusAnalise: StatusAnalise.OK_AUTOMATICO,
      });

      const result = await service.registrar(1, dtoContagem(497));

      expect(result.acao).toBe('CONCLUIDO_MOVIMENTACAO_SANKHYA');
      expect(result.esperado).toBe(497);
      expect(result.divergencia).toBe(0);
      expect(prisma.divergencia.create).not.toHaveBeenCalled();
      expect(prisma.contagem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            esperadoNoMomento: 497,
            divergencia: 0,
            statusAnalise: StatusAnalise.OK_AUTOMATICO,
          }),
        }),
      );
    });

    it('deve registrar DIVERGENCIA_PENDENTE e criar registro de divergência quando não bate', async () => {
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);
      mockPrismaService.snapshotEstoque.findFirst.mockResolvedValueOnce(
        mockSnapshot,
      );
      mockPrismaService.contagem.findMany.mockResolvedValueOnce([]); // Sem contagem anterior
      mockPrismaService.contagem.create.mockResolvedValueOnce({
        id: 51,
        statusAnalise: StatusAnalise.DIVERGENCIA_PENDENTE,
      });

      const result = await service.registrar(1, dtoContagem(12));

      expect(result.status).toBe(StatusAnalise.DIVERGENCIA_PENDENTE);
      expect(result.acao).toBe('AUDITORIA');
      expect(prisma.divergencia.create).toHaveBeenCalled();
      // Divergência não explicada fica bloqueada para auditoria e ressalva.
      expect(prisma.filaContagem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FilaStatus.BLOQUEADO_AUDITORIA,
          }),
        }),
      );
    });

    it('deve liberar a sobra confirmada da ressalva para o portal quando a segunda contagem bate com a primeira', async () => {
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);
      mockPrismaService.snapshotEstoque.findFirst.mockResolvedValueOnce(
        mockSnapshot,
      );
      mockPrismaService.contagem.findMany.mockResolvedValueOnce([
        {
          id: 51,
          tipo: ContagemTipo.CONTAGEM,
          qtdContada: 12,
          esperadoNoMomento: 10,
          createdAt: new Date(),
        },
      ]);
      mockPrismaService.divergencia.findFirst.mockResolvedValueOnce({
        id: 80,
        saldoAjustado: 10,
        movimentacoes: {
          fluxoInventario: {
            etapa: 'AUDITORIA',
            segregacaoRessalva: {
              tipo: 'ENTRADA_TEMPORARIA',
              quantidade: 2,
              codlocalDestino: 10820000,
            },
          },
        },
        contagem: { qtdContada: 12 },
      });
      mockPrismaService.contagem.create.mockResolvedValueOnce({ id: 52 });
      mockPrismaService.divergencia.update.mockResolvedValueOnce({});
      mockPrismaService.filaContagem.update.mockResolvedValueOnce({});

      const result = await service.registrar(1, dtoContagem(12));

      expect(result.acao).toBe('FINALIZADO_SEGUNDA_CONTAGEM');
      expect(result.finalizacao).toBeDefined();
      expect(result.finalizacao!.operacaoFinal).toMatchObject({
        tipo: 'LIBERACAO_RESSALVA',
        codlocalOrigem: 10820000,
        codlocalDestino: 10010000,
        quantidade: 2,
      });
      expect(result.finalizacao!.operacoesFinal).toEqual([
        expect.objectContaining({
          tipo: 'LIBERACAO_RESSALVA',
          quantidade: 2,
        }),
      ]);
      expect(prisma.filaContagem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: FilaStatus.CONCLUIDO }),
        }),
      );
    });

    it('deve estornar a ressalva quando a segunda contagem bate com o saldo esperado', async () => {
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce({
        ...mockFila,
        codprod: 18812,
        codlocal: 10010000,
      });
      mockPrismaService.snapshotEstoque.findFirst.mockResolvedValueOnce({
        id: 101,
        saldoEspelho: 20,
      });
      mockPrismaService.contagem.findMany.mockResolvedValueOnce([
        {
          id: 60,
          tipo: ContagemTipo.CONTAGEM,
          qtdContada: 15,
          esperadoNoMomento: 20,
          createdAt: new Date(),
        },
      ]);
      mockPrismaService.divergencia.findFirst.mockResolvedValueOnce({
        id: 81,
        saldoAjustado: 20,
        movimentacoes: {
          fluxoInventario: {
            etapa: 'TERCEIRA_CONTAGEM_SUPERVISOR',
            segregacaoRessalva: {
              tipo: 'TRANSFERENCIA_INTERNA',
              quantidade: 5,
              codlocalOrigem: 10010000,
              codlocalDestino: 10820000,
            },
          },
        },
        contagem: { qtdContada: 15 },
      });
      mockPrismaService.contagem.create.mockResolvedValueOnce({ id: 61 });
      mockPrismaService.divergencia.update.mockResolvedValueOnce({});
      mockPrismaService.filaContagem.update.mockResolvedValueOnce({});

      const result = await service.registrar(1, dtoContagem(20));

      expect(result.acao).toBe('FINALIZADO_SEGUNDA_CONTAGEM');
      expect(result.finalizacao!.operacaoFinal).toMatchObject({
        tipo: 'ESTORNO_RESSALVA',
        quantidade: 5,
        codlocalOrigem: 10820000,
        codlocalDestino: 10010000,
      });
      expect(result.finalizacao!.sankhyaFinalizacao).toMatchObject({
        status: 'SIMULADO',
      });
      expect(prisma.divergencia.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DivergenciaStatus.CONCLUIDO,
            decisao: Decisao.FINALIZAR_ANALISE,
          }),
        }),
      );
    });

    it('deve solicitar terceira contagem quando a segunda diverge da primeira', async () => {
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);
      mockPrismaService.snapshotEstoque.findFirst.mockResolvedValueOnce(
        mockSnapshot,
      );
      mockPrismaService.contagem.findMany.mockResolvedValueOnce([
        {
          id: 51,
          tipo: ContagemTipo.CONTAGEM,
          qtdContada: 12,
          esperadoNoMomento: 10,
          createdAt: new Date(),
        },
      ]);
      mockPrismaService.divergencia.findFirst.mockResolvedValueOnce({
        id: 80,
        saldoAjustado: 10,
        movimentacoes: { fluxoInventario: { etapa: 'AUDITORIA' } },
        contagem: { qtdContada: 12 },
      });
      mockPrismaService.contagem.create.mockResolvedValueOnce({ id: 53 });

      const result = await service.registrar(1, dtoContagem(11));

      expect(result.acao).toBe('TERCEIRA_CONTAGEM_SUPERVISOR');
      expect(prisma.filaContagem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FilaStatus.PENDENTE,
            motivoPriorizacao: 'TERCEIRA_CONTAGEM_SUPERVISOR',
          }),
        }),
      );
    });

    it('deve exigir supervisor na terceira contagem', async () => {
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);
      mockPrismaService.snapshotEstoque.findFirst.mockResolvedValueOnce(
        mockSnapshot,
      );
      mockPrismaService.contagem.findMany.mockResolvedValueOnce([
        { id: 51, qtdContada: 12, esperadoNoMomento: 10 },
        { id: 52, qtdContada: 11, esperadoNoMomento: 10 },
      ]);
      mockPrismaService.divergencia.findFirst.mockResolvedValueOnce({
        id: 80,
        saldoAjustado: 10,
        movimentacoes: { fluxoInventario: { etapa: 'AUDITORIA' } },
        contagem: { qtdContada: 12 },
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        role: 'OPERADOR',
      });

      await expect(
        service.registrar(1, dtoContagem(13)),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve complementar a ressalva antes de liberar a sobra definida pela terceira contagem', async () => {
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);
      mockPrismaService.snapshotEstoque.findFirst.mockResolvedValueOnce(
        mockSnapshot,
      );
      mockPrismaService.contagem.findMany.mockResolvedValueOnce([
        {
          id: 51,
          tipo: ContagemTipo.CONTAGEM,
          qtdContada: 11,
          esperadoNoMomento: 10,
          createdAt: new Date('2026-08-07T10:00:00'),
        },
        {
          id: 52,
          tipo: ContagemTipo.RECONTAGEM,
          qtdContada: 12,
          esperadoNoMomento: 10,
          createdAt: new Date('2026-08-07T10:05:00'),
        },
      ]);
      mockPrismaService.divergencia.findFirst.mockResolvedValueOnce({
        id: 80,
        saldoAjustado: 10,
        movimentacoes: {
          fluxoInventario: {
            etapa: 'TERCEIRA_CONTAGEM_SUPERVISOR',
            segregacaoRessalva: {
              tipo: 'ENTRADA_TEMPORARIA',
              quantidade: 1,
              codlocalDestino: 10820000,
            },
          },
        },
        contagem: { qtdContada: 11 },
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        role: 'SUPERVISOR',
      });
      mockPrismaService.contagem.create.mockResolvedValueOnce({ id: 53 });
      mockPrismaService.divergencia.update.mockResolvedValueOnce({});
      mockPrismaService.filaContagem.update.mockResolvedValueOnce({});

      const result = await service.registrar(1, dtoContagem(13));

      expect(result.acao).toBe('FINALIZADO_TERCEIRA_CONTAGEM');
      expect(result.divergencia).toBe(3);
      expect(result.finalizacao!.operacoesFinal).toEqual([
        expect.objectContaining({
          tipo: 'ENTRADA_TEMPORARIA',
          top: 221,
          codlocalDestino: 10820000,
          quantidade: 2,
        }),
        expect.objectContaining({
          tipo: 'LIBERACAO_RESSALVA',
          top: 700,
          codlocalOrigem: 10820000,
          codlocalDestino: 10010000,
          quantidade: 3,
        }),
      ]);
      expect(prisma.divergencia.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ajusteTipo: 'ENTRADA',
            ajusteQtd: 3,
          }),
        }),
      );
    });
  });

  describe('naoAchei', () => {
    it('deve zerar prioridades e liberar item', async () => {
      const mockFila = { id: 1, lockedBy: 1, naoAchouCount: 0 };
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);

      const result = await service.naoAchei(1, 1);

      expect(result.naoAchouCount).toBe(1);
      expect(prisma.filaContagem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            prioridadeManual: 0,
            prioridadeBase: 0,
            status: FilaStatus.PENDENTE,
            lockedBy: null,
          }),
        }),
      );
    });

    it('deve bloquear para auditoria se for a segunda vez que não acha', async () => {
      const mockFila = { id: 1, lockedBy: 1, naoAchouCount: 1 };
      mockPrismaService.filaContagem.findUnique.mockResolvedValueOnce(mockFila);
      mockPrismaService.contagem.create.mockResolvedValueOnce({ id: 70 });

      const result = await service.naoAchei(1, 1);

      expect(result.status).toBe(FilaStatus.BLOQUEADO_AUDITORIA);
      expect(prisma.filaContagem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FilaStatus.BLOQUEADO_AUDITORIA,
          }),
        }),
      );
    });
  });
});
