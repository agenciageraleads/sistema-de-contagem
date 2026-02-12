# Relatório Final: Integração Sankhya - Notas de Ajuste

**Data:** 10/02/2026  
**Status:** ✅ Parcialmente Concluído

## 🎯 Objetivo Alcançado

Implementação completa do fluxo de criação de notas de ajuste no Sankhya com:

- Agrupamento de notas por dia
- Confirmação automática
- Observação padrão identificando origem (App de Contagem)

## ✅ Funcionalidades Implementadas

### 1. Agrupamento de Notas Diárias

- **Método:** `findDailyAdjustmentNote(codemp, dtneg, top)`
- **Lógica:** Busca nota existente do dia com a observação do App antes de criar nova
- **Benefício:** Reduz poluição no Sankhya, agrupa ajustes do mesmo dia

### 2. Adição de Itens em Nota Existente

- **Método:** `addItemsToNote(nunota, items)`
- **Uso:** Quando encontra nota do dia, adiciona novos itens nela
- **Compatibilidade:** Funciona mesmo com nota confirmada (configuração do TOP permite)

### 3. Confirmação Automática

- **Método:** `confirmNote(nunota)`
- **Timing:** Executado após criação/atualização
- **Efeito:** Baixa estoque imediatamente no Sankhya

### 4. Observação Padrão

- **Campo:** `OBSERVACAO` no cabeçalho
- **Entrada:** "Ajuste de Estoque - App Contagem (Entrada)"
- **Saída:** "Ajuste de Estoque - App Contagem (Saída/Perda)"

## 📋 Configuração dos TOPs

### TOP 221 - Ajuste de Estoque Manual (ENTRADA)

- **TIPMOV:** `'C'` (Compra/Entrada)
- **Status:** ✅ Funcionando perfeitamente
- **Campos Obrigatórios:**
  - `CODPARC`: 1
  - `PERCDESC`: 0 (nos itens)
  - `CODTAB`: 0
  - `OBSERVACAO`: String identificadora

### TOP 1121 - Ajuste de Estoque Manual (SAÍDA)

- **TIPMOV:** `'V'` (Venda/Saída)
- **Status:** ⚠️ Bloqueado por validação de preço
- **Problema:** Sankhya exige que produtos com `TIPMOV='V'` tenham preço de tabela cadastrado
- **Erro:** "Produto sem preço de tabela, não pode ser vendido"

## 🚧 Bloqueio Atual: TOP 1121 (Saída)

### Causa Raiz

O Sankhya valida que movimentos de `TIPMOV='V'` (Venda) exigem:

1. Produto com preço de tabela ativo
2. Tabela de preço vigente

### Soluções Possíveis

#### Opção 1: Cadastrar Preços de Tabela (Recomendado)

```sql
-- No Sankhya, cadastrar preços na TGFEXC para produtos de ajuste
INSERT INTO TGFEXC (CODPROD, NUTAB, VLRVENDA, ...)
```

#### Opção 2: Configurar TOP Alternativo

- Verificar se existe TOP de saída sem validação de preço
- Exemplo: TOP com `TIPMOV='D'` (Devolução) ou `'E'` (Específico)

#### Opção 3: Ajustar Configuração do TOP 1121

- No Sankhya, desabilitar validação de preço para este TOP
- Requer acesso administrativo ao Sankhya

## 📊 Testes E2E

### Cenários Validados

1. ✅ **Entrada com Agrupamento:** Cria nota, adiciona itens, confirma
2. ✅ **Entrada sem Agrupamento:** Cria nova nota quando não existe
3. ⏭️ **Saída:** Skipado até resolução do bloqueio de preço

### Notas Criadas no Sankhya (Teste)

- **198568** - Entrada (TOP 221)
- **198571** - Entrada (TOP 221)
- **198586** - Entrada (TOP 221) - Última validação
- **198587** - Entrada (TOP 221) - Teste legado

⚠️ **Ação Necessária:** Excluir notas de teste manualmente no Sankhya

## 🔄 Fluxo Completo Implementado

```
1. Divergência Aprovada (AJUSTAR)
   ↓
2. SankhyaService.syncPendingAdjustments()
   ↓
3. Agrupa por TOP (221 = Entrada, 1121 = Saída)
   ↓
4. Para cada TOP:
   a. findDailyAdjustmentNote() → Busca nota do dia
   b. Se encontrou: addItemsToNote()
   c. Se não: createAdjustmentNote()
   d. confirmNote() → Confirma para baixar estoque
   ↓
5. Atualiza divergências: adjustStatus = 'SYNCED'
```

## 📝 Próximos Passos

### Imediato

1. **Resolver Bloqueio TOP 1121:**
   - Cadastrar preços de tabela para produtos de teste
   - OU ajustar configuração do TOP no Sankhya
   - OU identificar TOP alternativo para saídas

2. **Validar em Produção:**
   - Executar sync com dados reais
   - Monitorar logs do Sankhya
   - Validar estoque após confirmação

### Melhorias Futuras

1. **Retry Logic:** Implementar retry para falhas temporárias
2. **Batch Optimization:** Agrupar múltiplos syncs em uma única transação
3. **Auditoria:** Log detalhado de todas as notas criadas/atualizadas
4. **Dashboard:** Visualização de notas pendentes/sincronizadas

## 🎓 Aprendizados

1. **TGFTOP vs TGFTPV:** TGFTOP contém os Tipos de Operação, não TGFTPV (Tipos de Venda)
2. **TIPMOV é Crítico:** Deve corresponder exatamente ao configurado no TOP
3. **Validações do Sankhya:** Movimentos de venda (`TIPMOV='V'`) têm validações rigorosas
4. **Confirmação Flexível:** TOPs podem permitir alteração mesmo após confirmação
5. **Observação como Flag:** Usar OBSERVACAO para identificar notas do App

## 📚 Referências

- **Código:** `backend/src/sankhya/sankhya.client.ts`
- **Service:** `backend/src/sankhya/sankhya.service.ts`
- **Testes:** `backend/test/sankhya-note-sim.e2e-spec.ts`
- **Documentação Sankhya:** Consultar Super Agent para detalhes de CACSP.incluirNota
