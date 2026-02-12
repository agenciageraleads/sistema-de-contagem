import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Apagar contagens e divergências de itens de teste
    const testItems = await prisma.filaContagem.findMany({
        where: { codprod: { gte: 90000 } },
        select: { id: true }
    });

    const ids = testItems.map(i => i.id);

    if (ids.length > 0) {
        await prisma.divergencia.deleteMany({ where: { contagem: { filaId: { in: ids } } } });
        await prisma.contagem.deleteMany({ where: { filaId: { in: ids } } });
        await prisma.filaContagem.deleteMany({ where: { id: { in: ids } } });
        console.log(`${ids.length} itens de teste removidos.`);
    } else {
        console.log('Nenhum item de teste encontrado.');
    }

    // Verificar itens reais
    const realItems = await prisma.filaContagem.count({ where: { status: 'PENDENTE' } });
    console.log(`Itens pendentes reais na fila: ${realItems}`);
}

main();
