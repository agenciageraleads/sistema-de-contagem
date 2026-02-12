import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const fila = await prisma.filaContagem.findMany({
        where: { status: 'PENDENTE' },
        orderBy: { prioridadeBase: 'desc' }
    });

    console.log('--- ITENS DISPONÍVEIS NA FILA ---');
    fila.forEach(item => {
        console.log(`Cód: ${item.codprod} | Desc: ${item.descprod} | Local: ${item.codlocal}`);
    });
    console.log('---------------------------------');
}

main();
