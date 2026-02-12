import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    try {
        const snapshotCount = await prisma.snapshotEstoque.count();
        const filaCount = await prisma.filaContagem.count();
        const divergenciasCount = await prisma.divergencia.count();

        console.log('--- CONTAGEM DE DADOS ---');
        console.log(`Snapshot Estoque: ${snapshotCount}`);
        console.log(`Fila Contagem:    ${filaCount}`);
        console.log(`Divergências:     ${divergenciasCount}`);
        console.log('-------------------------');
    } catch (e) {
        console.error('Erro ao contar:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
