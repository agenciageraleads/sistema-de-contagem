import * as dotenv from 'dotenv';
import { SankhyaClient } from '../src/sankhya/sankhya.client';
import { ConfigService } from '@nestjs/config';

// Carregar variáveis de ambiente
dotenv.config();

/**
 * Script para verificar Custo de Reposição (CUSREP) na TGFCUS
 * Uso: npx ts-node scripts/check-tgfcus.ts
 */

async function main() {
    const configService = new ConfigService();
    // O construtor do SankhyaClient espera apenas ConfigService agora
    const sankhyaClient = new SankhyaClient(configService);

    try {
        console.log('🔍 Verificando Custo de Reposição (CUSREP) na TGFCUS...\n');

        // Produto de Teste (ID 2)
        const codprod = 2;
        const codemp = 1;
        const codlocal = 10010000;

        console.log(`Produto: ${codprod}, Empresa: ${codemp}, Local: ${codlocal}`);

        // 1. Buscar Custo na TGFCUS
        const query = `
            SELECT *
            FROM TGFCUS
            WHERE CODPROD = ${codprod}
              AND CODEMP = ${codemp}
              AND CODLOCAL = ${codlocal}
              AND DTATUAL = (
                  SELECT MAX(DTATUAL) 
                  FROM TGFCUS 
                  WHERE CODPROD = ${codprod} 
                    AND CODEMP = ${codemp} 
                    AND CODLOCAL = ${codlocal}
              )
        `;

        const result = await sankhyaClient.executeQuery(query);
        
        if (result && result.length > 0) {
            console.log('✅ Registro encontrado na TGFCUS:');
            console.table(result);
        } else {
            console.warn('⚠️ Nenhum registro de custo encontrado para este produto/local/empresa.');
        }

        console.log('\n✅ Verificação concluída!');

    } catch (error) {
        console.error('❌ Erro na verificação:', error);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
