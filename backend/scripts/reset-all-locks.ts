import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    await prisma.filaContagem.updateMany({
        data: {
            lockedBy: null,
            lockedAt: null,
            status: 'PENDENTE' // Reseta status de bloqueado/concluido
        }
    });

    console.log('Todos os locks foram removidos e status resetado para PENDENTE.');
}

main();
