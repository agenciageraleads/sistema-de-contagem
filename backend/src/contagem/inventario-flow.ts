export const INVENTARIO_LOCAIS = {
  ESTOQUE_PORTAL: 10010000,
  RESSALVA_INVENTARIO: 10820000,
} as const;

export const INVENTARIO_TOPS = {
  MOVIMENTACAO_INTERNA: 700,
  ENTRADA_TEMPORARIA: 221,
  SAIDA_RESSALVA: 1121,
} as const;

export type TipoDivergenciaInventario = 'FALTA' | 'SOBRA';

export interface MovimentoSankhya {
  TIPMOV?: string;
  ORIGEM?: string;
  QTDNEG?: number | string;
}

export interface ResumoMovimentacoesInventario {
  entradas: number;
  saidas: number;
  reservas: number;
  ajusteTotal: number;
  saldoEsperadoAtual: number;
  temMovimentacao: boolean;
}

export interface OperacaoRessalvaInventario {
  etapa: 'SEGREGACAO' | 'FINALIZACAO';
  tipo:
    | 'TRANSFERENCIA_INTERNA'
    | 'ENTRADA_TEMPORARIA'
    | 'RETIRADA_RESSALVA'
    | 'ESTORNO_RESSALVA'
    | 'LIBERACAO_RESSALVA'
    | 'SEM_AJUSTE';
  top: number | null;
  codlocalOrigem?: number;
  codlocalDestino?: number;
  codlocal?: number;
  quantidade: number;
  motivo: TipoDivergenciaInventario | 'SEM_DIVERGENCIA';
}

export type DecisaoPrimeiraContagem =
  | {
      acao: 'CONCLUIDO';
      motivo: 'SEM_DIVERGENCIA';
      saldoEsperadoAtual: number;
      diferencaFinal: number;
      resumoMovimentacoes: ResumoMovimentacoesInventario;
    }
  | {
      acao: 'CONCLUIDO';
      motivo: 'MOVIMENTACAO_EXPLICA_DIVERGENCIA';
      saldoEsperadoAtual: number;
      diferencaFinal: number;
      resumoMovimentacoes: ResumoMovimentacoesInventario;
    }
  | {
      acao: 'AUDITORIA';
      motivo: 'DIVERGENCIA_NAO_EXPLICADA';
      tipoDivergencia: TipoDivergenciaInventario;
      saldoEsperadoAtual: number;
      diferencaFinal: number;
      resumoMovimentacoes: ResumoMovimentacoesInventario;
      operacaoRessalva: OperacaoRessalvaInventario;
    };

export type DecisaoRecontagemInventario =
  | {
      acao: 'FINALIZAR_SEGUNDA_CONTAGEM';
      contagemVencedora: number;
      diferencaFinal: number;
      operacaoFinal: OperacaoRessalvaInventario;
    }
  | {
      acao: 'TERCEIRA_CONTAGEM_SUPERVISOR';
      primeiraContagem: number;
      segundaContagem: number;
    };

export interface FinalizacaoTerceiraContagem {
  acao: 'FINALIZAR_TERCEIRA_CONTAGEM';
  contagemVencedora: number;
  diferencaFinal: number;
  operacaoFinal: OperacaoRessalvaInventario;
}

export function resumirMovimentacoesInventario(
  saldoSnapshot: number,
  movimentacoes: MovimentoSankhya[],
): ResumoMovimentacoesInventario {
  let entradas = 0;
  let saidas = 0;
  let reservas = 0;
  let ajusteTotal = 0;

  for (const mov of movimentacoes) {
    const quantidade = Number(mov.QTDNEG || 0);
    if (!Number.isFinite(quantidade) || quantidade === 0) continue;

    if (mov.ORIGEM === 'RESERVA') {
      reservas += quantidade;
      ajusteTotal -= quantidade;
    } else if (mov.TIPMOV === 'E') {
      entradas += quantidade;
      ajusteTotal += quantidade;
    } else if (mov.TIPMOV === 'S') {
      saidas += quantidade;
      ajusteTotal -= quantidade;
    }
  }

  return {
    entradas,
    saidas,
    reservas,
    ajusteTotal,
    saldoEsperadoAtual: saldoSnapshot + ajusteTotal,
    temMovimentacao: movimentacoes.length > 0,
  };
}

export function criarOperacaoSegregacao(
  diferencaFinal: number,
): OperacaoRessalvaInventario {
  const quantidade = Math.abs(diferencaFinal);
  const motivo: TipoDivergenciaInventario =
    diferencaFinal > 0 ? 'SOBRA' : 'FALTA';

  if (motivo === 'FALTA') {
    return {
      etapa: 'SEGREGACAO',
      tipo: 'TRANSFERENCIA_INTERNA',
      top: INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
      codlocalOrigem: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
      codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
      quantidade,
      motivo,
    };
  }

  return {
    etapa: 'SEGREGACAO',
    tipo: 'ENTRADA_TEMPORARIA',
    top: INVENTARIO_TOPS.ENTRADA_TEMPORARIA,
    codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
    quantidade,
    motivo,
  };
}

export function criarOperacaoFinalizacao(
  diferencaFinal: number,
): OperacaoRessalvaInventario {
  const quantidade = Math.abs(diferencaFinal);

  if (quantidade === 0) {
    return {
      etapa: 'FINALIZACAO',
      tipo: 'SEM_AJUSTE',
      top: null,
      quantidade: 0,
      motivo: 'SEM_DIVERGENCIA',
    };
  }

  return {
    etapa: 'FINALIZACAO',
    tipo: 'RETIRADA_RESSALVA',
    top: null,
    codlocal: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
    quantidade,
    motivo: diferencaFinal > 0 ? 'SOBRA' : 'FALTA',
  };
}

function arredondarQuantidade(quantidade: number) {
  return Number(Math.abs(quantidade).toFixed(4));
}

function criarTransferenciaPortalParaRessalva(
  quantidade: number,
): OperacaoRessalvaInventario {
  return {
    etapa: 'FINALIZACAO',
    tipo: 'TRANSFERENCIA_INTERNA',
    top: INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
    codlocalOrigem: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
    codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
    quantidade: arredondarQuantidade(quantidade),
    motivo: 'FALTA',
  };
}

function criarEntradaTemporariaRessalva(
  quantidade: number,
): OperacaoRessalvaInventario {
  return {
    etapa: 'FINALIZACAO',
    tipo: 'ENTRADA_TEMPORARIA',
    top: INVENTARIO_TOPS.ENTRADA_TEMPORARIA,
    codlocalDestino: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
    quantidade: arredondarQuantidade(quantidade),
    motivo: 'SOBRA',
  };
}

function criarRetiradaRessalva(
  quantidade: number,
  motivo: TipoDivergenciaInventario | 'SEM_DIVERGENCIA',
): OperacaoRessalvaInventario {
  return {
    etapa: 'FINALIZACAO',
    tipo: 'RETIRADA_RESSALVA',
    top: INVENTARIO_TOPS.SAIDA_RESSALVA,
    codlocal: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
    quantidade: arredondarQuantidade(quantidade),
    motivo,
  };
}

function criarEstornoRessalva(
  quantidade: number,
  motivo: TipoDivergenciaInventario | 'SEM_DIVERGENCIA',
): OperacaoRessalvaInventario {
  return {
    etapa: 'FINALIZACAO',
    tipo: 'ESTORNO_RESSALVA',
    top: INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
    codlocalOrigem: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
    codlocalDestino: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
    quantidade: arredondarQuantidade(quantidade),
    motivo,
  };
}

function criarLiberacaoRessalva(
  quantidade: number,
): OperacaoRessalvaInventario {
  return {
    etapa: 'FINALIZACAO',
    tipo: 'LIBERACAO_RESSALVA',
    top: INVENTARIO_TOPS.MOVIMENTACAO_INTERNA,
    codlocalOrigem: INVENTARIO_LOCAIS.RESSALVA_INVENTARIO,
    codlocalDestino: INVENTARIO_LOCAIS.ESTOQUE_PORTAL,
    quantidade: arredondarQuantidade(quantidade),
    motivo: 'SOBRA',
  };
}

export function criarOperacoesFinalizacaoRessalva(input: {
  diferencaFinal: number;
  segregacaoRessalva?: OperacaoRessalvaInventario | null;
}): OperacaoRessalvaInventario[] {
  const diferencaFinal = Number(input.diferencaFinal || 0);
  const quantidadeFinal = arredondarQuantidade(diferencaFinal);
  const segregacao = input.segregacaoRessalva || null;
  const quantidadeSegregada = arredondarQuantidade(
    Number(segregacao?.quantidade || 0),
  );
  const operacoes: OperacaoRessalvaInventario[] = [];

  if (quantidadeFinal === 0) {
    if (quantidadeSegregada === 0) return [];

    if (segregacao?.tipo === 'TRANSFERENCIA_INTERNA') {
      return [criarEstornoRessalva(quantidadeSegregada, 'SEM_DIVERGENCIA')];
    }

    if (segregacao?.tipo === 'ENTRADA_TEMPORARIA') {
      return [criarRetiradaRessalva(quantidadeSegregada, 'SEM_DIVERGENCIA')];
    }

    return [];
  }

  if (diferencaFinal > 0) {
    if (segregacao?.tipo === 'TRANSFERENCIA_INTERNA' && quantidadeSegregada > 0) {
      operacoes.push(criarEstornoRessalva(quantidadeSegregada, 'SEM_DIVERGENCIA'));
    }

    const sobraJaNaRessalva =
      segregacao?.tipo === 'ENTRADA_TEMPORARIA' ? quantidadeSegregada : 0;
    const complemento = arredondarQuantidade(quantidadeFinal - sobraJaNaRessalva);
    if (quantidadeFinal > sobraJaNaRessalva && complemento > 0) {
      operacoes.push(criarEntradaTemporariaRessalva(complemento));
    }

    operacoes.push(criarLiberacaoRessalva(quantidadeFinal));

    const excesso = arredondarQuantidade(sobraJaNaRessalva - quantidadeFinal);
    if (sobraJaNaRessalva > quantidadeFinal && excesso > 0) {
      operacoes.push(criarRetiradaRessalva(excesso, 'SEM_DIVERGENCIA'));
    }

    return operacoes;
  }

  if (segregacao?.tipo === 'ENTRADA_TEMPORARIA' && quantidadeSegregada > 0) {
    operacoes.push(criarRetiradaRessalva(quantidadeSegregada, 'SEM_DIVERGENCIA'));
  }

  const faltaJaNaRessalva =
    segregacao?.tipo === 'TRANSFERENCIA_INTERNA' ? quantidadeSegregada : 0;
  const complemento = arredondarQuantidade(quantidadeFinal - faltaJaNaRessalva);
  if (quantidadeFinal > faltaJaNaRessalva && complemento > 0) {
    operacoes.push(criarTransferenciaPortalParaRessalva(complemento));
  }

  operacoes.push(criarRetiradaRessalva(quantidadeFinal, 'FALTA'));

  const excesso = arredondarQuantidade(faltaJaNaRessalva - quantidadeFinal);
  if (faltaJaNaRessalva > quantidadeFinal && excesso > 0) {
    operacoes.push(criarEstornoRessalva(excesso, 'FALTA'));
  }

  return operacoes;
}

export function avaliarPrimeiraContagemInventario(input: {
  saldoSnapshot: number;
  quantidadeContada: number;
  movimentacoes: MovimentoSankhya[];
}): DecisaoPrimeiraContagem {
  const resumoMovimentacoes = resumirMovimentacoesInventario(
    input.saldoSnapshot,
    input.movimentacoes,
  );

  const diferencaSnapshot = input.quantidadeContada - input.saldoSnapshot;
  if (diferencaSnapshot === 0) {
    return {
      acao: 'CONCLUIDO',
      motivo: 'SEM_DIVERGENCIA',
      saldoEsperadoAtual: input.saldoSnapshot,
      diferencaFinal: 0,
      resumoMovimentacoes,
    };
  }

  const diferencaFinal =
    input.quantidadeContada - resumoMovimentacoes.saldoEsperadoAtual;

  if (diferencaFinal === 0) {
    return {
      acao: 'CONCLUIDO',
      motivo: 'MOVIMENTACAO_EXPLICA_DIVERGENCIA',
      saldoEsperadoAtual: resumoMovimentacoes.saldoEsperadoAtual,
      diferencaFinal,
      resumoMovimentacoes,
    };
  }

  return {
    acao: 'AUDITORIA',
    motivo: 'DIVERGENCIA_NAO_EXPLICADA',
    tipoDivergencia: diferencaFinal > 0 ? 'SOBRA' : 'FALTA',
    saldoEsperadoAtual: resumoMovimentacoes.saldoEsperadoAtual,
    diferencaFinal,
    resumoMovimentacoes,
    operacaoRessalva: criarOperacaoSegregacao(diferencaFinal),
  };
}

export function avaliarSegundaContagemInventario(input: {
  primeiraContagem: number;
  segundaContagem: number;
  saldoEsperadoAtual: number;
}): DecisaoRecontagemInventario {
  if (input.segundaContagem === input.saldoEsperadoAtual) {
    return {
      acao: 'FINALIZAR_SEGUNDA_CONTAGEM',
      contagemVencedora: input.segundaContagem,
      diferencaFinal: 0,
      operacaoFinal: criarOperacaoFinalizacao(0),
    };
  }

  if (input.segundaContagem !== input.primeiraContagem) {
    return {
      acao: 'TERCEIRA_CONTAGEM_SUPERVISOR',
      primeiraContagem: input.primeiraContagem,
      segundaContagem: input.segundaContagem,
    };
  }

  const diferencaFinal =
    input.segundaContagem - input.saldoEsperadoAtual;

  return {
    acao: 'FINALIZAR_SEGUNDA_CONTAGEM',
    contagemVencedora: input.segundaContagem,
    diferencaFinal,
    operacaoFinal: criarOperacaoFinalizacao(diferencaFinal),
  };
}

export function finalizarTerceiraContagemInventario(input: {
  terceiraContagem: number;
  saldoEsperadoAtual: number;
}): FinalizacaoTerceiraContagem {
  const diferencaFinal =
    input.terceiraContagem - input.saldoEsperadoAtual;

  return {
    acao: 'FINALIZAR_TERCEIRA_CONTAGEM',
    contagemVencedora: input.terceiraContagem,
    diferencaFinal,
    operacaoFinal: criarOperacaoFinalizacao(diferencaFinal),
  };
}
