import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module'; // ajuste o path conforme necessario
import { SankhyaService } from '../src/sankhya/sankhya.service';
import { SankhyaClient } from '../src/sankhya/sankhya.client';
import { ConfigService } from '@nestjs/config';

async function main() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const sankhyaClient = app.get(SankhyaClient);
    const configService = app.get(ConfigService);

    const codemp = configService.get('CODEMP') || 1;
    const codlocal = configService.get('CODLOCAL') || 10010000;

    console.log(`Diagnosticando Query Sankhya: EMP=${codemp}, LOCAL=${codlocal}`);

    const sql = `
            WITH 
            CustosVigentes AS (
                SELECT C.CODPROD, C.CUSREP FROM TGFCUS C
                WHERE C.CODEMP = ${codemp}
                  AND C.DHALTER = (SELECT MAX(X.DHALTER) FROM TGFCUS X WHERE X.CODPROD = C.CODPROD AND X.CODEMP = C.CODEMP)
            ),
            EstoqueAgregado AS (
                SELECT EST.CODPROD, SUM(EST.ESTOQUE) AS ESTOQUE_TOTAL, MAX(NVL(NULLIF(EST.CONTROLE, ' '), ' ')) AS CONTROLE_LOTE,
                       MAX(EST.DTENTRADA) AS DTULTENT
                FROM TGFEST EST
                WHERE EST.CODLOCAL = ${codlocal} AND EST.CODEMP = ${codemp}
                GROUP BY EST.CODPROD
            ),
            DadosBase AS (
                SELECT 
                    P.CODPROD, P.DESCRPROD, TRIM(NVL(P.MARCA, 'SEM MARCA')) AS MARCA, P.CODVOL AS UNIDADE, 
                    NVL(E.ESTOQUE_TOTAL, 0) AS ESTOQUE,
                    NVL(CS.CUSREP, 0) AS CUSTO,
                    (NVL(E.ESTOQUE_TOTAL, 0) * NVL(CS.CUSREP, 0)) AS VALOR_ESTOQUE,
                    NVL(E.CONTROLE_LOTE, ' ') AS MARCA_CONTROLE,
                    NVL(E.DTULTENT, TO_DATE('2000-01-01', 'YYYY-MM-DD')) AS DTULTENT
                FROM TGFPRO P
                LEFT JOIN EstoqueAgregado E ON P.CODPROD = E.CODPROD
                LEFT JOIN CustosVigentes CS ON P.CODPROD = CS.CODPROD
                WHERE P.ATIVO = 'S' AND P.USOPROD = 'R'
            )
            SELECT COUNT(*) AS TOTAL FROM DadosBase
  `;

    try {
        const result = await sankhyaClient.executeQuery(sql);
        console.log('Resultado Count:', result);

        // Se count > 0, pegar amostra
        if (result[0]?.TOTAL > 0) {
            const sampleSql = `SELECT * FROM TGFPRO WHERE ATIVO='S' AND USOPROD='R' AND ROWNUM <= 5`;
            const sample = await sankhyaClient.executeQuery(sampleSql);
            console.log('Amostra 5 produtos:', sample.map(s => s.CODPROD));
        }

    } catch (e) {
        console.error('Erro na query:', e.message);
    } finally {
        await app.close();
    }
}

main();
