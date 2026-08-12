import {
  avaliarPrimeiraContagemInventario,
  avaliarSegundaContagemInventario,
  criarOperacoesFinalizacaoRessalva,
  finalizarTerceiraContagemInventario,
  INVENTARIO_LOCAIS,
  INVENTARIO_TOPS,
} from './inventario-flow';

describe('inventario-flow', () => {
  it('usa TOP 1121 para baixa/retirada da ressalva', () => {
    expect(INVENTARIO_TOPS.SAIDA_RESSALVA).toBe(1121);
  });

  it('conclui quando a primeira contagem bate com o snapshot', () => {
    const decisao = avaliarPrimeiraContagemInventario({
      saldoSnapshot: 100,
      quantidadeContada: 100,
      movimentacoes: [],
    });

    expect(decisao).toMatchObject({
      acao: 'CONCLUIDO',
      motivo: 'SEM_DIVERGENCIA',
      saldoEsperadoAtual: 100,
      diferencaFinal: 0,
    });
  });

  it('conclui quando a divergencia e explicada por movimentacoes do Sankhya', () => {
    const decisao = avaliarPrimeiraContagemInventario({
      saldoSnapshot: 100,
      quantidadeContada: 93,
      movimentacoes: [
        { TIPMOV: 'E', QTDNEG: 5 },
        { TIPMOV: 'S', QTDNEG: 10 },
        { ORIGEM: 'RESERVA', QTDNEG: 2 },
      ],
    });

    expect(decisao).toMatchObject({
      acao: 'CONCLUIDO',
      motivo: 'MOVIMENTACAO_EXPLICA_DIVERGENCIA',
      saldoEsperadoAtual: 93,
      diferencaFinal: 0,
    });
  });

  it('segrega falta com TOP 700 de Estoque Portal para Ressalva Inventario', () => {
    const decisao = avaliarPrimeiraContagemInventario({
      saldoSnapshot: 100,
      quantidadeContada: 87,
      movimentacoes: [{ TIPMOV: 'S', QTDNEG: 3 }],
    });

    expect(decisao).toMatchObject({
      acao: 'AUDITORIA',
      tipoDivergencia: 'FALTA',
      saldoEsperadoAtual: 97,
      diferencaFinal: -10,
      operacaoRessalva: {
        tipo: 'TRANSFERENCIA_INTERNA',
        top: INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
        codlocalOrigem: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
        codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        quantidade: 10,
      },
    });
  });

  it('segrega sobra com entrada temporaria TOP 221 na Ressalva Inventario', () => {
    const decisao = avaliarPrimeiraContagemInventario({
      saldoSnapshot: 100,
      quantidadeContada: 112,
      movimentacoes: [{ TIPMOV: 'E', QTDNEG: 2 }],
    });

    expect(decisao).toMatchObject({
      acao: 'AUDITORIA',
      tipoDivergencia: 'SOBRA',
      saldoEsperadoAtual: 102,
      diferencaFinal: 10,
      operacaoRessalva: {
        tipo: 'ENTRADA_TEMPORARIA',
        top: INVENTARIO_TOPS.ENTRADA_TEMPORARIA,
        codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        quantidade: 10,
      },
    });
  });

  it('finaliza quando a segunda contagem bate com a primeira', () => {
    const decisao = avaliarSegundaContagemInventario({
      primeiraContagem: 87,
      segundaContagem: 87,
      saldoEsperadoAtual: 97,
    });

    expect(decisao).toMatchObject({
      acao: 'FINALIZAR_SEGUNDA_CONTAGEM',
      contagemVencedora: 87,
      diferencaFinal: -10,
      operacaoFinal: {
        tipo: 'RETIRADA_RESSALVA',
        codlocal: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        quantidade: 10,
      },
    });
  });

  it('finaliza quando a segunda contagem corrige a primeira e bate com o saldo esperado', () => {
    const decisao = avaliarSegundaContagemInventario({
      primeiraContagem: 15,
      segundaContagem: 20,
      saldoEsperadoAtual: 20,
    });

    expect(decisao).toMatchObject({
      acao: 'FINALIZAR_SEGUNDA_CONTAGEM',
      contagemVencedora: 20,
      diferencaFinal: 0,
      operacaoFinal: {
        tipo: 'SEM_AJUSTE',
        quantidade: 0,
      },
    });
  });

  it('exige terceira contagem do supervisor quando a segunda diverge da primeira', () => {
    const decisao = avaliarSegundaContagemInventario({
      primeiraContagem: 87,
      segundaContagem: 92,
      saldoEsperadoAtual: 97,
    });

    expect(decisao).toEqual({
      acao: 'TERCEIRA_CONTAGEM_SUPERVISOR',
      primeiraContagem: 87,
      segundaContagem: 92,
    });
  });

  it('usa sempre o resultado da terceira contagem como vencedor', () => {
    const decisao = finalizarTerceiraContagemInventario({
      terceiraContagem: 94,
      saldoEsperadoAtual: 97,
    });

    expect(decisao).toMatchObject({
      acao: 'FINALIZAR_TERCEIRA_CONTAGEM',
      contagemVencedora: 94,
      diferencaFinal: -3,
      operacaoFinal: {
        tipo: 'RETIRADA_RESSALVA',
        codlocal: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        quantidade: 3,
      },
    });
  });

  it('complementa a ressalva antes de liberar sobra final maior que a primeira', () => {
    const operacoes = criarOperacoesFinalizacaoRessalva({
      diferencaFinal: 3,
      segregacaoRessalva: {
        etapa: 'SEGREGACAO',
        tipo: 'ENTRADA_TEMPORARIA',
        top: INVENTARIO_TOPS.ENTRADA_TEMPORARIA,
        codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        quantidade: 1,
        motivo: 'SOBRA',
      },
    });

    expect(operacoes).toEqual([
      expect.objectContaining({
        tipo: 'ENTRADA_TEMPORARIA',
        top: INVENTARIO_TOPS.ENTRADA_TEMPORARIA,
        codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        quantidade: 2,
      }),
      expect.objectContaining({
        tipo: 'LIBERACAO_RESSALVA',
        top: INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
        codlocalOrigem: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        codlocalDestino: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
        quantidade: 3,
      }),
    ]);
  });

  it('libera a sobra confirmada e retira o excesso temporario quando a sobra final diminui', () => {
    const operacoes = criarOperacoesFinalizacaoRessalva({
      diferencaFinal: 3,
      segregacaoRessalva: {
        etapa: 'SEGREGACAO',
        tipo: 'ENTRADA_TEMPORARIA',
        top: INVENTARIO_TOPS.ENTRADA_TEMPORARIA,
        codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        quantidade: 5,
        motivo: 'SOBRA',
      },
    });

    expect(operacoes).toEqual([
      expect.objectContaining({
        tipo: 'LIBERACAO_RESSALVA',
        quantidade: 3,
      }),
      expect.objectContaining({
        tipo: 'RETIRADA_RESSALVA',
        top: INVENTARIO_TOPS.SAIDA_RESSALVA,
        quantidade: 2,
        motivo: 'SEM_DIVERGENCIA',
      }),
    ]);
  });

  it('retira a falta confirmada e estorna o excesso quando a falta final diminui', () => {
    const operacoes = criarOperacoesFinalizacaoRessalva({
      diferencaFinal: -3,
      segregacaoRessalva: {
        etapa: 'SEGREGACAO',
        tipo: 'TRANSFERENCIA_INTERNA',
        top: INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
        codlocalOrigem: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
        codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        quantidade: 5,
        motivo: 'FALTA',
      },
    });

    expect(operacoes).toEqual([
      expect.objectContaining({
        tipo: 'RETIRADA_RESSALVA',
        top: INVENTARIO_TOPS.SAIDA_RESSALVA,
        quantidade: 3,
        motivo: 'FALTA',
      }),
      expect.objectContaining({
        tipo: 'ESTORNO_RESSALVA',
        top: INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
        codlocalOrigem: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        codlocalDestino: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
        quantidade: 2,
      }),
    ]);
  });

  it('estorna a ressalva quando a contagem final elimina a falta inicial', () => {
    const operacoes = criarOperacoesFinalizacaoRessalva({
      diferencaFinal: 0,
      segregacaoRessalva: {
        etapa: 'SEGREGACAO',
        tipo: 'TRANSFERENCIA_INTERNA',
        top: INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
        codlocalOrigem: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
        codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        quantidade: 5,
        motivo: 'FALTA',
      },
    });

    expect(operacoes).toEqual([
      expect.objectContaining({
        tipo: 'ESTORNO_RESSALVA',
        quantidade: 5,
        codlocalOrigem: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
        codlocalDestino: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
      }),
    ]);
  });
});
