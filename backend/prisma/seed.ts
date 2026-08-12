// Seed de desenvolvimento - Cria dados iniciais para testar o sistema
import { FilaStatus, PrismaClient, UserRole } from '@prisma/client';
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
        { chave: 'TOP_SAIDA', valor: '1121', descricao: 'TOP Sankhya para ajuste de saída' },
        { chave: 'TOP_MOVIMENTACAO_INTERNA', valor: '700', descricao: 'TOP Sankhya para movimentação interna entre locais' },
        { chave: 'TOP_ENTRADA_TEMPORARIA', valor: '221', descricao: 'TOP Sankhya para entrada temporária em ressalva' },
        { chave: 'CODEMP', valor: '1', descricao: 'Código da empresa no Sankhya' },
        { chave: 'CODLOCAL', valor: '10010000', descricao: 'Código do local principal' },
        { chave: 'CODLOCAL_RESSALVA_INVENTARIO', valor: '10820000', descricao: 'Local de estoque segregado para ressalva de inventário' },
    ];

    for (const cfg of configs) {
        await prisma.configuracao.upsert({
            where: { chave: cfg.chave },
            update: { valor: cfg.valor },
            create: cfg,
        });
    }
    console.log('✅ Configurações criadas');

    if (process.env.SEED_INVENTARIO_VALIDATION_ITEMS === 'true') {
        const dataRef = new Date('2026-07-28T00:00:00.000Z');
        const itensValidacao = [
            {
                codprod: 900001,
                descprod: 'VALIDACAO LOCAL - Falta para Auditoria',
                marca: 'VALIDACAO',
                controle: 'FALTA',
                codigoBarrasCadastro: '7899000010001',
                saldo: 100,
                custo: 12.5,
            },
            {
                codprod: 900002,
                descprod: 'VALIDACAO LOCAL - Movimento Explicado',
                marca: 'VALIDACAO',
                controle: 'MOVIMENTO',
                codigoBarrasCadastro: '7899000020000',
                saldo: 100,
                custo: 8.75,
            },
            {
                codprod: 900003,
                descprod: 'VALIDACAO LOCAL - Sobra para Auditoria',
                marca: 'VALIDACAO',
                controle: 'SOBRA',
                codigoBarrasCadastro: '7899000030009',
                saldo: 50,
                custo: 18.3,
            },
        ];

        for (const item of itensValidacao) {
            await prisma.snapshotEstoque.upsert({
                where: {
                    dataRef_codemp_codlocal_codprod: {
                        dataRef,
                        codemp: 1,
                        codlocal: 10010000,
                        codprod: item.codprod,
                    },
                },
                update: {
                    descprod: item.descprod,
                    marca: item.marca,
                    controle: item.controle,
                    codigoBarrasCadastro: item.codigoBarrasCadastro,
                    saldoEspelho: item.saldo,
                    custoEspelho: item.custo,
                    valorEstoque: item.saldo * item.custo,
                    unidade: 'UN',
                },
                create: {
                    dataRef,
                    codemp: 1,
                    codlocal: 10010000,
                    codprod: item.codprod,
                    descprod: item.descprod,
                    marca: item.marca,
                    controle: item.controle,
                    codigoBarrasCadastro: item.codigoBarrasCadastro,
                    codgrupoprod: 999,
                    saldoEspelho: item.saldo,
                    custoEspelho: item.custo,
                    valorEstoque: item.saldo * item.custo,
                    unidade: 'UN',
                },
            });

            await prisma.filaContagem.upsert({
                where: {
                    codprod_codlocal_codemp: {
                        codprod: item.codprod,
                        codlocal: 10010000,
                        codemp: 1,
                    },
                },
                update: {
                    descprod: item.descprod,
                    marca: item.marca,
                    controle: item.controle,
                    codigoBarrasCadastro: item.codigoBarrasCadastro,
                    status: FilaStatus.PENDENTE,
                    prioridadeManual: 9999,
                    motivoPriorizacao: 'VALIDACAO_LOCAL_INVENTARIO',
                    lockedBy: null,
                    lockedAt: null,
                    unidade: 'UN',
                },
                create: {
                    codprod: item.codprod,
                    codlocal: 10010000,
                    codemp: 1,
                    descprod: item.descprod,
                    marca: item.marca,
                    controle: item.controle,
                    codigoBarrasCadastro: item.codigoBarrasCadastro,
                    prioridadeBase: 100,
                    prioridadeManual: 9999,
                    motivoPriorizacao: 'VALIDACAO_LOCAL_INVENTARIO',
                    status: FilaStatus.PENDENTE,
                    unidade: 'UN',
                },
            });
        }
        console.log('✅ Itens de validação local do inventário criados');
    }

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
