import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const snapshot = await prisma.snapshotEstoque.findFirst({
        where: { codprod: 2, codlocal: 10010000 }
    });

    console.log('--- SALDO ESPERADO ---');
    console.log(`Produto 2: ${snapshot?.saldoEspelho}`);
    console.log('----------------------');
}

main();
