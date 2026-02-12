import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔒 Diagnóstico de Locks Ativos:');

    const locks = await prisma.filaContagem.findMany({
        where: {
            OR: [
                { lockedBy: { not: null } },
                { status: 'EM_CONTAGEM' }
            ]
        },
        include: { locker: true }
    });

    if (locks.length === 0) {
        console.log('✅ Nenhum lock ativo.');
    } else {
        locks.forEach(l => {
            console.log(`❌ Item ${l.id} (${l.descprod}) | Marca: ${l.marca} | Status: ${l.status} | LockedBy: ${l.lockedBy} (${l.locker?.login})`);
        });
    }

    console.log('\n📅 Histórico Recente (15 min):');
    const timeframe = new Date();
    timeframe.setMinutes(timeframe.getMinutes() - 15);

    const historico = await prisma.contagem.findMany({
        where: { createdAt: { gte: timeframe } },
        include: { user: true, fila: true },
        orderBy: { createdAt: 'desc' }
    });

    historico.forEach(h => {
        console.log(`🕒 ${h.createdAt.toISOString()} | User: ${h.user.login} | Item ${h.filaId} | Marca: ${h.fila.marca}`);
    });
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
