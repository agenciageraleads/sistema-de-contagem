// Script para alimentar a fila com itens de teste
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('📦 Alimentando fila de teste...');

    const itens = [
        { codprod: 1010, descprod: 'FIO PARALELO 2X1.5MM', marca: 'SIL', controle: 'PADRAO', prioridadeBase: 5000 },
        { codprod: 2020, descprod: 'DISJUNTOR DIN MONOF 20A', marca: 'STECK', controle: 'PADRAO', prioridadeBase: 3000 },
        { codprod: 3030, descprod: 'CAIXA DE PASSAGEM 4X2', marca: 'TIGRE', controle: 'PADRAO', prioridadeBase: 1000 },
    ];

    for (const item of itens) {
        await prisma.filaContagem.upsert({
            where: { codprod_codlocal_codemp: { codprod: item.codprod, codlocal: 10010000, codemp: 1 } },
            update: {},
            create: {
                ...item,
                codlocal: 10010000,
                codemp: 1,
                status: 'PENDENTE',
            },
        });

        // Criar snapshot para estes itens (base para comparação)
        await prisma.snapshotEstoque.upsert({
            where: { dataRef_codemp_codlocal_codprod: { dataRef: new Date(), codemp: 1, codlocal: 10010000, codprod: item.codprod } },
            update: {},
            create: {
                dataRef: new Date(),
                codemp: 1,
                codlocal: 10010000,
                codprod: item.codprod,
                descprod: item.descprod,
                marca: item.marca,
                saldoEspelho: 100, // Saldo fictício
                custoEspelho: 10,
                valorEstoque: 1000,
            },
        });
    }

    console.log('✅ Fila e Snapshot alimentados!');
}

main().finally(() => prisma.$disconnect());
