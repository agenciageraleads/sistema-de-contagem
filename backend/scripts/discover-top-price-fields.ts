import * as dotenv from 'dotenv';
import { SankhyaClient } from '../src/sankhya/sankhya.client';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

// Carregar variáveis de ambiente
dotenv.config();

/**
 * Script para descobrir campos de validação de preço na TGFTOP
 * usando o dicionário de dados TDDCAM
 * 
 * Uso: npx ts-node scripts/discover-top-price-fields.ts
 */

async function main() {
    const logger = new Logger('DiscoverTOPFields');

    const configService = new ConfigService();
    const sankhyaClient = new SankhyaClient(configService);

    try {
        logger.log('🔍 Descobrindo campos de validação de preço na TGFTOP...\n');

        // 1. Buscar TODOS os campos da TGFTOP no dicionário
        logger.log('1️⃣ Campos da TGFTOP (via TDDCAM):');
        const allFields = await sankhyaClient.executeQuery(`
            SELECT 
                NOMETAB,
                NOMECAM,
                DESCCAM,
                TIPO,
                TAMANHO
            FROM TDDCAM
            WHERE NOMETAB = 'TGFTOP'
            ORDER BY NOMECAM
        `);

        logger.log(`\n📊 Total de campos: ${allFields.length}\n`);

        // 2. Filtrar campos relacionados a PREÇO
        logger.log('2️⃣ Campos relacionados a PREÇO:');
        const priceFields = allFields.filter(f =>
            f.NOMECAM.includes('PREC') ||
            f.NOMECAM.includes('VLR') ||
            f.NOMECAM.includes('TAB') ||
            f.DESCCAM?.toUpperCase().includes('PREÇO') ||
            f.DESCCAM?.toUpperCase().includes('PRECO') ||
            f.DESCCAM?.toUpperCase().includes('TABELA') ||
            f.DESCCAM?.toUpperCase().includes('VALOR')
        );
        console.table(priceFields);
        console.log('\n');

        // 3. Filtrar campos relacionados a VALIDAÇÃO/BLOQUEIO
        logger.log('3️⃣ Campos relacionados a VALIDAÇÃO/BLOQUEIO:');
        const validationFields = allFields.filter(f =>
            f.NOMECAM.includes('VALID') ||
            f.NOMECAM.includes('BLOQ') ||
            f.NOMECAM.includes('EXIG') ||
            f.NOMECAM.includes('OBRIG') ||
            f.DESCCAM?.toUpperCase().includes('VALID') ||
            f.DESCCAM?.toUpperCase().includes('BLOQ') ||
            f.DESCCAM?.toUpperCase().includes('EXIG') ||
            f.DESCCAM?.toUpperCase().includes('OBRIG')
        );
        console.table(validationFields);
        console.log('\n');

        // 4. Buscar campos tipo 'S/N' (flags booleanas)
        logger.log('4️⃣ Campos tipo S/N (possíveis flags de controle):');
        const flagFields = allFields.filter(f =>
            f.TIPO === 'C' && f.TAMANHO === 1
        );
        console.table(flagFields.slice(0, 30)); // Primeiros 30
        console.log(`\n... e mais ${flagFields.length - 30} campos\n`);

        // 5. Buscar valores REAIS do TOP 1121
        logger.log('5️⃣ Valores do TOP 1121 (campos suspeitos):');

        // Montar query dinâmica com campos suspeitos
        const suspectFields = [
            ...priceFields.map(f => f.NOMECAM),
            ...validationFields.map(f => f.NOMECAM)
        ].filter((v, i, a) => a.indexOf(v) === i); // Remove duplicatas

        if (suspectFields.length > 0) {
            const fieldsStr = suspectFields.join(', ');
            const top1121Values = await sankhyaClient.executeQuery(`
                SELECT ${fieldsStr}
                FROM TGFTOP
                WHERE CODTIPOPER = 1121
            `);
            console.log(JSON.stringify(top1121Values, null, 2));
        }
        console.log('\n');

        // 6. Comparar TOP 221 vs 1121 (campos suspeitos)
        logger.log('6️⃣ Comparação TOP 221 vs 1121 (campos suspeitos):');
        if (suspectFields.length > 0) {
            const fieldsStr = ['CODTIPOPER', 'DESCROPER', ...suspectFields].join(', ');
            const comparison = await sankhyaClient.executeQuery(`
                SELECT ${fieldsStr}
                FROM TGFTOP
                WHERE CODTIPOPER IN (221, 1121)
                ORDER BY CODTIPOPER
            `);

            // Mostrar diferenças
            if (comparison.length === 2) {
                const top221 = comparison[0];
                const top1121 = comparison[1];

                logger.log('\n🔍 DIFERENÇAS ENCONTRADAS:');
                suspectFields.forEach(field => {
                    if (top221[field] !== top1121[field]) {
                        console.log(`\n📌 ${field}:`);
                        console.log(`   TOP 221:  ${top221[field]}`);
                        console.log(`   TOP 1121: ${top1121[field]}`);
                    }
                });
            }
        }

        logger.log('\n\n✅ Descoberta concluída!');
        logger.log('\n📋 Próximos passos:');
        logger.log('1. Analise os campos "suspeitos" acima');
        logger.log('2. Identifique qual campo está causando a validação');
        logger.log('3. Ajuste o valor para igualar ao TOP 221 (que funciona)');

    } catch (error) {
        logger.error('❌ Erro na descoberta:', error);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
