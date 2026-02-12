import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🧪 Iniciando Teste E2E de Fluxo de Divergência (DADOS REAIS)...');
    const BASE_URL = 'http://localhost:3001/api';

    // Helper Login
    const login = async (user: string, pass: string) => {
        const res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: user, senha: pass })
        });
        if (!res.ok) throw new Error(`Falha no login: ${res.statusText}`);
        const data = await res.json() as { token: string };
        return data.token;
    };

    // Helper Registrar
    const registrar = async (token: string, filaId: number, qtd: number) => {
        const res = await fetch(`${BASE_URL}/contagem/registrar`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ filaId, qtd_contada: qtd })
        });
        return await res.json();
    };

    // Helper Proximo
    const proximo = async (token: string) => {
        const res = await fetch(`${BASE_URL}/contagem/proximo`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            console.error(`❌ [proximo] Falha HTTP: ${res.status} ${res.statusText}`);
            const text = await res.text();
            console.error(`   Body: ${text}`);
            return null;
        }
        return await res.json();
    };

    // 1. Setup Operadores de Teste
    console.log('👥 Preparando Operadores de Teste...');
    // Pegar hash válido de um operador existente
    const modelo = await prisma.user.findFirst({ where: { login: 'operador1' } });
    if (!modelo) throw new Error('Operador1 não encontrado para copiar hash.');

    // Criar/Atualizar op_test_1 e op_test_2
    const ops = [
        { id: 901, nome: 'Op Teste 1', login: 'op_test_1' },
        { id: 902, nome: 'Op Teste 2', login: 'op_test_2' }
    ];

    for (const op of ops) {
        await prisma.user.upsert({
            where: { id: op.id },
            update: { senhaHash: modelo.senhaHash, ativo: true },
            create: { id: op.id, nome: op.nome, login: op.login, senhaHash: modelo.senhaHash, ativo: true }
        });
        // Limpar histórico recente desses ops para garantir que não tenham posse de marcas
        await prisma.divergencia.deleteMany({ where: { contagem: { userId: op.id } } });
        await prisma.contagem.deleteMany({ where: { userId: op.id } });
        await prisma.filaContagem.updateMany({
            where: { lockedBy: op.id },
            data: { lockedBy: null, status: 'PENDENTE' }
        });
    }

    // 2. Login Op 1
    console.log('🔵 Testando Login com Operador 1...');
    const token1 = await login('op_test_1', 'oper123'); // Senha do operador1
    console.log('✅ Login Op Teste 1 OK');

    // Decode Token manually
    try {
        const payloadBase64 = token1.split('.')[1];
        const payloadJson = Buffer.from(payloadBase64, 'base64').toString();
        console.log('   🔍 Token Payload:', payloadJson);
    } catch (e) {
        console.error('   ❌ Falha ao decodificar token:', e);
    }

    // 3. Pegar Produto REAL
    console.log('\n🔵 Buscando item REAL para Op 1...');
    const item1 = await proximo(token1);

    if (!item1) {
        console.error('❌ ERRO: Op Teste 1 não recebeu nenhum item. Fila vazia ou bloqueada.');
        return;
    }

    console.log(`   -> Item Selecionado: ${item1.descprod} (ID ${item1.id}) | Marca: ${item1.marca}`);

    // Guardar estado original para "Restore" se necessário (apenas log)
    const originalSnap = await prisma.snapshotEstoque.findFirst({ where: { codprod: item1.codprod } });
    console.log(`   -> Saldo Snapshot Atual: ${originalSnap?.saldoEspelho}`);

    // --- CENÁRIO 1: Recontagem Automática (>2%) ---
    console.log('\n🔵 CENÁRIO 1: Contagem Divergente (Op 1)');
    // Divergência forçada: Contar 0.1
    const qtdDivergente = 0.1;
    const res1 = await registrar(token1, item1.id, qtdDivergente);
    console.log(`   -> Resultado API:`, res1);

    // Validar Recontagem
    const filaApos1 = await prisma.filaContagem.findUnique({ where: { id: item1.id } });
    if (filaApos1?.status === 'PENDENTE' && (filaApos1.recontagens > 0 || filaApos1.prioridadeManual > 0)) {
        console.log(`   ✅ SUCESSO: Item voltou para fila. Recontagens: ${filaApos1.recontagens}`);
    } else {
        console.error('   ❌ FALHA: Item não foi para recontagem automática.', filaApos1);
        return;
    }

    // --- CENÁRIO 2: Confirmar Divergência (Op 2) ---
    console.log('\n🔵 CENÁRIO 2: Confirmação por Op 2');

    const token2 = await login('op_test_2', 'oper123');
    console.log('   ✅ Login Op Teste 2 OK');

    // Op 2 Pede Próximo
    // DEVE pegar o MESMO item (prioridade máxima)
    const item2 = await proximo(token2);

    if (!item2) {
        console.error('   ❌ ERRO: Op 2 não recebeu item.');
        return;
    }
    console.log(`   -> Op 2 Pegou: ${item2.descprod} (ID ${item2.id})`);

    if (item2.id !== item1.id) {
        console.warn(`   ⚠️ ALERTA: Op 2 pegou item diferente! (ID ${item2.id}). Prioridade falhou ou concorrência?`);
        // Se pegou diferente, não dá para validar Divergencia do fluxo.
    } else {
        // Registrar Divergência de Novo
        const res2 = await registrar(token2, item2.id, qtdDivergente);
        console.log(`   -> Resultado API:`, res2);

        // Validar Criação de Divergência
        const div = await prisma.divergencia.findFirst({
            where: { contagem: { filaId: item1.id } },
            orderBy: { createdAt: 'desc' }
        });

        if (div) {
            console.log(`   ✅ SUCESSO TOTAL: Divergência Criada! ID: ${div.id}`);
            console.log(`   📝 IDs Gerados para Limpeza:`);
            console.log(`      - FilaContagem ID: ${item1.id}`);
            console.log(`      - Divergencia ID: ${div.id}`);
            console.log(`      - Contagens (UserId 901, 902) no item ${item1.id}`);
        } else {
            // Pode ter ido para 'BLOQUEADO_AUDITORIA' se naoAchei? Nao, foi contagem.
            // Verificar status
            const finalFila = await prisma.filaContagem.findUnique({ where: { id: item1.id } });
            console.log(`      Status final Fila: ${finalFila?.status}`);
            console.error('   ❌ FALHA: Divergência não encontrada no banco.');
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
