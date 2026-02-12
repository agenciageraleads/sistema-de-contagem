import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const item = await prisma.filaContagem.findFirst({
        where: { codprod: 2 },
        include: { locker: true }
    });

    console.log('--- STATUS DO ITEM 2 ---');
    console.log(`Status: ${item?.status}`);
    console.log(`Locked By: ${item?.locker?.nome || 'Ninguém'}`);
    console.log(`Locked At: ${item?.lockedAt}`);
    console.log('------------------------');
}

main();
