import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SankhyaClient } from '../sankhya/sankhya.client';
import { PrismaService } from '../prisma/prisma.service';

export interface ProdutoNunota {
  sequencia: number;
  codprod: number;
  descprod: string;
  qtdneg: number;
  codvol: string;
  controle: string;
  nunota: number;
  codigoBarrasCadastro: string;
  localizacao: string;
}

@Injectable()
export class SeparacaoService {
  private readonly logger = new Logger(SeparacaoService.name);
  private colunaLocalizacaoTgfpro: string | null | undefined = undefined;

  constructor(
    private sankhyaClient: SankhyaClient,
    private prisma: PrismaService,
  ) {}

  async buscarImagemProduto(codprod: number): Promise<{
    buffer: Buffer;
    contentType: string;
  }> {
    const codigo = Math.trunc(Number(codprod));
    if (!Number.isFinite(codigo) || codigo <= 0) {
      throw new NotFoundException('Produto inválido para imagem.');
    }

    const origemBase =
      process.env.SANKHYA_IMAGE_BASE_URL?.trim() ||
      'http://portal.snk.ativy.com:40235';

    const candidatos = this.montarUrlsImagemProduto(origemBase, codigo);
    let ultimoErro: string | null = null;

    for (const url of candidatos) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (!response.ok) {
          ultimoErro = `HTTP ${response.status}`;
          continue;
        }

        const arr = await response.arrayBuffer();
        const buffer = Buffer.from(arr);
        if (!buffer || buffer.length === 0) {
          ultimoErro = 'Resposta sem conteúdo';
          continue;
        }

        const contentType =
          response.headers.get('content-type') || 'application/octet-stream';
        return { buffer, contentType };
      } catch (error: any) {
        ultimoErro = error?.message || 'Erro desconhecido';
      }
    }

    this.logger.warn(
      `Imagem do produto ${codigo} não encontrada. Último erro: ${ultimoErro || 'n/d'}`,
    );
    throw new NotFoundException('Imagem do produto não encontrada.');
  }

  async registrarAcao(data: {
    nunota: number;
    userId?: number;
    codusu?: number;
    acao: string;
    localizacao?: string;
    box?: string;
  }) {
    const codusu = await this.resolverCodusuSankhya(data.userId, data.codusu);
    const entidadeSeparacao =
      process.env.SEPARACAO_ENTITY_NAME?.trim() || 'AD_TGFSEP';

    this.logger.log(
      `Registrando ação de separação na ${entidadeSeparacao}: NUNOTA=${data.nunota}, ACAO=${data.acao}, USU=${codusu}`,
    );

    // A data formatada pode ser dd/mm/yyyy hh:mm:ss que o Sankhya aceita
    const now = new Date();
    const dh = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const dthrFormatada = dh.replace(',', '');

    // Mapping action names to exact numeric options in TDDOPC for ACAO
    // 0=INICIAR, 1=PAUSAR, 2=RETOMAR, 3=FINALIZAR
    const acaoMap: Record<string, string> = {
      INICIAR: '0',
      PAUSAR: '1',
      RETORNAR: '2',
      RETOMAR: '2',
      FINALIZAR: '3',
    };

    const acaoSankhya = acaoMap[data.acao] || data.acao;

    const payload: Record<string, any> = {
      NUNOTA: data.nunota,
      CODUSU: codusu,
      DTHR: dthrFormatada,
      ACAO: acaoSankhya,
    };

    if (data.localizacao) {
      payload.LOCALIZACAO = data.localizacao;
    }

    if (data.box) {
      payload.BOX = data.box;
    }

    try {
      await this.sankhyaClient.saveRecord(entidadeSeparacao, payload);

      let produtosNunota: ProdutoNunota[] = [];
      if (data.acao === 'INICIAR') {
        try {
          produtosNunota = await this.buscarProdutosDaNunota(data.nunota);
        } catch (error: any) {
          this.logger.warn(
            `Não foi possível carregar itens da NUNOTA ${data.nunota}: ${error.message}`,
          );
        }
      }

      return {
        success: true,
        message: 'Ação registrada com sucesso',
        data: payload,
        nunotaResolvida:
          produtosNunota.length > 0 ? produtosNunota[0].nunota : data.nunota,
        produtosNunota,
      };
    } catch (error: any) {
      this.logger.error(
        `Falha ao registrar ação na ${entidadeSeparacao}: ${error.message}`,
      );
      throw new Error(`Falha ao registrar separação: ${error.message}`);
    }
  }

  private async resolverCodusuSankhya(
    userId?: number,
    codusuFallback?: number,
  ): Promise<number> {
    const fallback = Math.trunc(Number(codusuFallback));
    if (Number.isFinite(fallback) && fallback > 0) {
      return fallback;
    }

    const uid = Math.trunc(Number(userId));
    if (!Number.isFinite(uid) || uid <= 0) {
      throw new BadRequestException(
        'Usuário inválido para resolver código Sankhya.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: uid },
      select: { codusuSankhya: true },
    });

    if (!user || !user.codusuSankhya || user.codusuSankhya <= 0) {
      throw new BadRequestException(
        'Seu usuário não possui Código Sankhya cadastrado. Solicite ao supervisor para preencher no cadastro.',
      );
    }

    return user.codusuSankhya;
  }

  private async buscarProdutosDaNunota(
    nunota: number,
  ): Promise<ProdutoNunota[]> {
    const notaInformada = Number(nunota);
    if (!Number.isFinite(notaInformada) || notaInformada <= 0) {
      return [];
    }

    const nunotaResolvida = await this.resolverNunotaInterna(notaInformada);
    if (!nunotaResolvida) {
      return [];
    }

    const expressaoLocalizacao = await this.obterExpressaoLocalizacaoProduto(
      'PRO',
    );

    const sql = `
      SELECT
        CAB.NUNOTA AS NUNOTA,
        ITE.SEQUENCIA,
        ITE.CODPROD,
        COALESCE(PRO.DESCRPROD, 'Produto sem descrição') AS DESCRPROD,
        ITE.QTDNEG,
        COALESCE(ITE.CODVOL, '') AS CODVOL,
        COALESCE(ITE.CONTROLE, '') AS CONTROLE,
        COALESCE(
          NULLIF(TRIM(PRO.AD_CODBARRAESTOQUE), ''),
          (
            SELECT MAX(BAR.CODBARRA)
            FROM TGFBAR BAR
            WHERE BAR.CODPROD = ITE.CODPROD
          ),
          ''
        ) AS CODBARRA,
        ${expressaoLocalizacao} AS LOCALIZACAO
      FROM TGFCAB CAB
      INNER JOIN TGFITE ITE ON ITE.NUNOTA = CAB.NUNOTA
      LEFT JOIN TGFPRO PRO ON PRO.CODPROD = ITE.CODPROD
      WHERE CAB.NUNOTA = ${Math.trunc(nunotaResolvida)}
      ORDER BY ITE.SEQUENCIA
    `;

    const rows = await this.sankhyaClient.executeQuery<{
      NUNOTA: number;
      SEQUENCIA: number;
      CODPROD: number;
      DESCRPROD: string;
      QTDNEG: number;
      CODVOL: string;
      CONTROLE: string;
      CODBARRA: string;
      LOCALIZACAO: string;
    }>(sql);

    return rows.map((row) => ({
      nunota: Number(row.NUNOTA),
      sequencia: Number(row.SEQUENCIA),
      codprod: Number(row.CODPROD),
      descprod: String(row.DESCRPROD || ''),
      qtdneg: Number(row.QTDNEG || 0),
      codvol: String(row.CODVOL || ''),
      controle: String(row.CONTROLE || ''),
      codigoBarrasCadastro: String(row.CODBARRA || '').trim(),
      localizacao: String(row.LOCALIZACAO || '').trim(),
    }));
  }

  private async obterExpressaoLocalizacaoProduto(
    aliasTabela: string,
  ): Promise<string> {
    const coluna = await this.resolverColunaLocalizacaoTgfpro();
    if (!coluna) {
      return `''`;
    }

    return `COALESCE(NULLIF(TRIM(${aliasTabela}.${coluna}), ''), '')`;
  }

  private async resolverColunaLocalizacaoTgfpro(): Promise<string | null> {
    if (this.colunaLocalizacaoTgfpro !== undefined) {
      return this.colunaLocalizacaoTgfpro;
    }

    const candidatas = ['LOCALIZACAO', 'AD_LOCALIZACAO'];
    const sql = `
      SELECT COLUMN_NAME
      FROM ALL_TAB_COLUMNS
      WHERE TABLE_NAME = 'TGFPRO'
        AND COLUMN_NAME IN (${candidatas.map((coluna) => `'${coluna}'`).join(', ')})
    `;

    try {
      const rows = await this.sankhyaClient.executeQuery<{ COLUMN_NAME: string }>(
        sql,
      );
      const colunasDisponiveis = new Set(
        (rows || []).map((row) => String(row.COLUMN_NAME || '').toUpperCase()),
      );

      this.colunaLocalizacaoTgfpro =
        candidatas.find((coluna) => colunasDisponiveis.has(coluna)) || null;
      return this.colunaLocalizacaoTgfpro;
    } catch (error: any) {
      this.logger.warn(
        `Não foi possível identificar coluna de localização na TGFPRO: ${error.message}`,
      );
      this.colunaLocalizacaoTgfpro = null;
      return null;
    }
  }

  private async resolverNunotaInterna(
    notaInformada: number,
  ): Promise<number | null> {
    const nota = Math.trunc(Number(notaInformada));
    if (!Number.isFinite(nota) || nota <= 0) {
      return null;
    }

    const sql = `
      SELECT NUNOTA
      FROM (
        SELECT
          CAB.NUNOTA,
          CASE WHEN CAB.NUNOTA = ${nota} THEN 0 ELSE 1 END AS ORDEM
        FROM TGFCAB CAB
        WHERE CAB.NUNOTA = ${nota} OR CAB.NUMNOTA = ${nota}
        ORDER BY ORDEM, CAB.DTMOV DESC
      )
      WHERE ROWNUM = 1
    `;

    const result = await this.sankhyaClient.executeQuery<{ NUNOTA: number }>(
      sql,
    );

    if (!result || result.length === 0) {
      return null;
    }

    return Number(result[0].NUNOTA);
  }

  private montarUrlsImagemProduto(origemBase: string, codprod: number): string[] {
    const base = origemBase.replace(/\/+$/, '');
    const paths = [
      `/mge/Produto@IMAGEM@CODPROD=${codprod}.dbimage`,
      `/mge/Produto@IMAGEM@CODPROD=${codprod}`,
      `/mge/produto@IMAGEM@CODPROD=${codprod}.dbimage`,
      `/mge/produto@IMAGEM@CODPROD=${codprod}`,
      `/mge/TGFPRO@IMAGEM@CODPROD=${codprod}.dbimage`,
      `/mge/TGFPRO@IMAGEM@CODPROD=${codprod}`,
      `/mge/tgfpro@IMAGEM@CODPROD=${codprod}.dbimage`,
      `/mge/tgfpro@IMAGEM@CODPROD=${codprod}`,
    ];

    const urls: string[] = [];
    for (const path of paths) {
      const urlBase = `${base}${path}`;
      if (urlBase.startsWith('http://')) {
        urls.push(urlBase.replace(/^http:\/\//i, 'https://'));
        urls.push(urlBase);
      } else if (urlBase.startsWith('https://')) {
        urls.push(urlBase);
        urls.push(urlBase.replace(/^https:\/\//i, 'http://'));
      } else {
        urls.push(urlBase);
      }
    }

    return Array.from(new Set(urls.filter(Boolean)));
  }
}
