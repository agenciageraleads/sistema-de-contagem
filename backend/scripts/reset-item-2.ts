import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const filaId = (await prisma.filaContagem.findFirst({ where: { codprod: 2 } }))?.id;

    if (!filaId) return console.log('Item não encontrado');

    // Apagar divergências e contagens desse item
    await prisma.divergencia.deleteMany({
        where: { contagem: { filaId } }
    });

    await prisma.contagem.deleteMany({
        where: { filaId }
    });

    // Resetar fila
    await prisma.filaContagem.update({
        where: { id: filaId },
        data: {
            status: 'PENDENTE',
            lockedBy: null,
            lockedAt: null,
            contagensOk: 0,
            naoAchouCount: 0,
            recontagens: 0,
            prioridadeBase: 9999 // Alta prioridade pra aparecer logo
        }
    });

    console.log('Item 2 resetado para PENDENTE com sucesso!');
}

main();
