import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🕵️ Checando dados reais...');

    const op1 = await prisma.user.findFirst({ where: { login: 'operador1' } });
    console.log('Original Op1:', op1);

    const opTest1 = await prisma.user.findUnique({ where: { id: 901 } });
    console.log('Op Test 1 (901):', opTest1);

    const item = await prisma.filaContagem.findFirst({
        where: { status: 'PENDENTE', lockedBy: null },
        take: 1
    });
    console.log('Item Candidato:', item);

    if (item) {
        // Verificar Snapshot
        const snap = await prisma.snapshotEstoque.findFirst({
            where: { codprod: item.codprod, codlocal: item.codlocal, codemp: item.codemp }
        });
        console.log('Snapshot:', snap);
    }
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
