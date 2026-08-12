// Script para testar a criação REAL de uma nota no Sankhya
// Uso: npx ts-node src/scripts/test-real-sankhya-note.ts

import { SankhyaClient } from '../sankhya/sankhya.client';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv';
import { Logger } from '@nestjs/common';

dotenv.config();

async function main() {
  const logger = new Logger('TestRealSankhya');
  logger.log('🚀 Iniciando Teste REAL de Criação de Nota no Sankhya...');

  // Mock ConfigService com valores reais do .env
  const configService = new ConfigService();

  const client = new SankhyaClient(configService);

  try {
    // 1. Autenticar
    await client.authenticate();
    logger.log('✅ Autenticado.');

    // 2. Dados de Teste
    const codemp = 1;
    const hoje = new Date().toLocaleDateString('pt-BR'); // dd/mm/yyyy
    const top = 221; // Entrada

    // Item de teste
    const items = [
      {
        codprod: 969, // Usar um produto existente que não gere erro (ex: 969 ou pegar um da lista de sync)
        qtdneg: 1,
        codlocal: 10010000,
        vlrunit: 10.5,
        codvol: 'UN',
      },
    ];

    // 3. Criar Nota
    logger.log(
      `Tentando criar nota TOP ${top} para produto ${items[0].codprod}...`,
    );

    const nunota = await client.createAdjustmentNote(codemp, hoje, top, items);

    logger.log(`🎉 SUCESSO! Nota Criada: ${nunota}`);
    logger.log(
      `⚠️ Verifique no Sankhya (Movimentação) se a nota ${nunota} está correta.`,
    );

    // DEBUG: Tentar descobrir o nome do serviço
    /*
        logger.log('🕵️ Buscando serviços de inclusão de nota na tabela TGESERV (ou TGFSER)...');
        
        // Descobrir colunas de TGFSER
        const sql = "SELECT * FROM TGFSER WHERE ROWNUM = 1";
        const results = await client.executeQuery(sql);
 
        logger.log('Resultados da busca:');
        console.table(results);
        */
  } catch (error: any) {
    logger.error(`❌ FALHA: ${error.message}`);
    if (error.response) {
      console.error(error.response.data);
    }
  }
}

main();
