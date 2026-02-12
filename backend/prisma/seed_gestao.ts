import { PrismaClient, DivergenciaStatus, ContagemTipo, StatusAnalise, UserRole, Severidade } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Iniciando Seed de Gestão Evoluída ---');

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // Hash padrão para a senha '123'
    const hash123 = await bcrypt.hash('123', 10);

    // 1. Garantir Usuários
    const op1 = await prisma.user.upsert({
        where: { login: 'operador1' },
        update: { senhaHash: hash123 },
        create: { login: 'operador1', senhaHash: hash123, nome: 'João Operador', role: UserRole.OPERADOR }
    });

    const op2 = await prisma.user.upsert({
        where: { login: 'operador2' },
        update: { senhaHash: hash123 },
        create: { login: 'operador2', senhaHash: hash123, nome: 'Maria Operadora', role: UserRole.OPERADOR }
    });

    const ricardo = await prisma.user.upsert({
        where: { login: 'ricardo' },
        update: { senhaHash: hash123 },
        create: { login: 'ricardo', senhaHash: hash123, nome: 'Ricardo Oliveira', role: UserRole.OPERADOR }
    });

    // 2. Limpar para teste limpo
    await prisma.divergencia.deleteMany({});
    await prisma.contagem.deleteMany({});
    await prisma.snapshotEstoque.deleteMany({ where: { dataRef: hoje } });

    // 3. Criar Snapshots do Dia
    const snap1 = await prisma.snapshotEstoque.create({
        data: {
            codprod: 1001,
            descprod: 'CABO FLEXIVEL 2.5MM PRETO 100M',
            marca: 'SIL',
            codlocal: 1,
            codemp: 1,
            saldoEspelho: 150,
            custoEspelho: 1.5,
            valorEstoque: 150 * 1.5,
            dataRef: hoje,
            controle: 'UNID'
        }
    });

    const snap2 = await prisma.snapshotEstoque.create({
        data: {
            codprod: 1004,
            descprod: 'REFLETOR LED 100W BIVOLT',
            marca: 'AVANT',
            codlocal: 1,
            codemp: 1,
            saldoEspelho: 25,
            custoEspelho: 45.9,
            valorEstoque: 25 * 45.9,
            dataRef: hoje,
            controle: 'UNID'
        }
    });

    const snap3 = await prisma.snapshotEstoque.create({
        data: {
            codprod: 1005,
            descprod: 'INTERRUPTOR SIMPLES BRANCO',
            marca: 'TRAMONTINA',
            codlocal: 1,
            codemp: 1,
            saldoEspelho: 100,
            custoEspelho: 8.5,
            valorEstoque: 100 * 8.5,
            dataRef: hoje,
            controle: 'UNID'
        }
    });

    // 4. Gerar Divergências
    const c1 = await prisma.contagem.create({
        data: {
            codprod: 1001, codlocal: 1, codemp: 1, userId: op1.id, filaId: 1,
            tipo: ContagemTipo.CONTAGEM, qtdContada: 160, esperadoNoMomento: 150,
            divergencia: 10, divergenciaPercent: 6.66, statusAnalise: StatusAnalise.DIVERGENCIA_PENDENTE,
            tsInicio: new Date(), tsFim: new Date(), snapshotId: snap1.id
        }
    });
    await prisma.divergencia.create({
        data: { contagemId: c1.id, severidade: Severidade.MEDIA, status: DivergenciaStatus.PENDENTE }
    });

    const c2 = await prisma.contagem.create({
        data: {
            codprod: 1004, codlocal: 1, codemp: 1, userId: op2.id, filaId: 4,
            tipo: ContagemTipo.CONTAGEM, qtdContada: 20, esperadoNoMomento: 25,
            divergencia: -5, divergenciaPercent: 20, statusAnalise: StatusAnalise.DIVERGENCIA_PENDENTE,
            tsInicio: new Date(), tsFim: new Date(), snapshotId: snap2.id
        }
    });
    await prisma.divergencia.create({
        data: { contagemId: c2.id, severidade: Severidade.ALTA, status: DivergenciaStatus.PENDENTE }
    });

    // 5. Gerar Acertos para o Ricardo (Sniper do time)
    for (let i = 0; i < 8; i++) {
        await prisma.contagem.create({
            data: {
                codprod: 1005, codlocal: 1, codemp: 1, userId: ricardo.id, filaId: 5,
                tipo: ContagemTipo.CONTAGEM, qtdContada: 100, esperadoNoMomento: 100,
                divergencia: 0, divergenciaPercent: 0, statusAnalise: StatusAnalise.OK_AUTOMATICO,
                tsInicio: new Date(), tsFim: new Date(), snapshotId: snap3.id
            }
        });
    }

    // 6. Configuração de Meta Global
    await prisma.configuracao.upsert({
        where: { chave: 'META_GLOBAL_DIARIA' },
        update: { valor: '200' },
        create: { chave: 'META_GLOBAL_DIARIA', valor: '200', descricao: 'Meta diária global da equipe' }
    });

    console.log('--- Seed de Gestão Finalizado com Sucesso! ---');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
