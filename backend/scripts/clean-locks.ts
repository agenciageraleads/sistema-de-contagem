import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🧹 Limpando Locks Fantasmas...');

    const res = await prisma.filaContagem.updateMany({
        where: {
            OR: [
                { lockedBy: { not: null } },
                { status: 'EM_CONTAGEM' }
            ]
        },
        data: {
            lockedBy: null,
            status: 'PENDENTE',
            lockedAt: null
        }
    });

    console.log(`✅ ${res.count} itens liberados.`);
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
