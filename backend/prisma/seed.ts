// Seed de desenvolvimento - Cria dados iniciais para testar o sistema
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Iniciando seed de desenvolvimento...');

    // Criar usuário admin padrão
    const adminHash = await bcrypt.hash('admin123', 10);
    const admin = await prisma.user.upsert({
        where: { login: 'admin' },
        update: {},
        create: {
            nome: 'Administrador',
            login: 'admin',
            senhaHash: adminHash,
            role: UserRole.ADMIN,
        },
    });
    console.log(`✅ Admin criado: ${admin.login}`);

    // Criar usuário supervisor
    const supHash = await bcrypt.hash('super123', 10);
    const supervisor = await prisma.user.upsert({
        where: { login: 'supervisor' },
        update: {},
        create: {
            nome: 'Supervisor Teste',
            login: 'supervisor',
            senhaHash: supHash,
            role: UserRole.SUPERVISOR,
        },
    });
    console.log(`✅ Supervisor criado: ${supervisor.login}`);

    // Criar 2 operadores de teste
    const opHash = await bcrypt.hash('oper123', 10);

    const operador1 = await prisma.user.upsert({
        where: { login: 'operador1' },
        update: {},
        create: {
            nome: 'João Operador',
            login: 'operador1',
            senhaHash: opHash,
            role: UserRole.OPERADOR,
        },
    });

    const operador2 = await prisma.user.upsert({
        where: { login: 'operador2' },
        update: {},
        create: {
            nome: 'Maria Operadora',
            login: 'operador2',
            senhaHash: opHash,
            role: UserRole.OPERADOR,
        },
    });

    console.log(`✅ Operadores criados: ${operador1.login}, ${operador2.login}`);

    // Criar metas para os operadores
    for (const user of [operador1, operador2]) {
        const existingMeta = await prisma.metaUser.findFirst({
            where: { userId: user.id },
        });
        if (!existingMeta) {
            await prisma.metaUser.create({
                data: {
                    userId: user.id,
                    metaDiaria: 30,
                    metaMensal: 1000,
                    vigenciaInicio: new Date(),
                },
            });
        }
    }
    console.log('✅ Metas criadas para operadores');

    // Criar configurações padrão do sistema
    const configs = [
        { chave: 'LOCK_TIMEOUT_MINUTES', valor: '10', descricao: 'Tempo em minutos para lock de item na fila' },
        { chave: 'NAO_ACHOU_LIMITE', valor: '2', descricao: 'Limite de não achei antes de enviar para auditoria' },
        { chave: 'DIVERGENCIA_PERCENTUAL', valor: '2', descricao: '% de divergência para solicitar recontagem' },
        { chave: 'META_DIARIA_PADRAO', valor: '30', descricao: 'Meta diária padrão de contagens' },
        { chave: 'META_MENSAL_PADRAO', valor: '1000', descricao: 'Meta mensal padrão de contagens' },
        { chave: 'SNAPSHOT_HORA', valor: '03:00', descricao: 'Horário do snapshot diário' },
        { chave: 'DECAY_FATOR', valor: '0.5', descricao: 'Fator de decay para prioridade' },
        { chave: 'TOP_ENTRADA', valor: '221', descricao: 'TOP Sankhya para ajuste de entrada' },
        { chave: 'TOP_SAIDA', valor: '1221', descricao: 'TOP Sankhya para ajuste de saída' },
        { chave: 'CODEMP', valor: '1', descricao: 'Código da empresa no Sankhya' },
        { chave: 'CODLOCAL', valor: '10010000', descricao: 'Código do local principal' },
    ];

    for (const cfg of configs) {
        await prisma.configuracao.upsert({
            where: { chave: cfg.chave },
            update: { valor: cfg.valor },
            create: cfg,
        });
    }
    console.log('✅ Configurações criadas');

    console.log('');
    console.log('🎉 Seed concluído!');
    console.log('');
    console.log('📋 Credenciais de acesso:');
    console.log('   Admin:      admin / admin123');
    console.log('   Supervisor: supervisor / super123');
    console.log('   Operador 1: operador1 / oper123');
    console.log('   Operador 2: operador2 / oper123');
}

main()
    .catch((e) => {
        console.error('❌ Erro no seed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
