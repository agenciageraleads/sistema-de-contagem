# Relatório de Correção: Nota de Ajuste Sankhya (TOP 221)

**Status:** Concluído ✅
**Data:** 10/02/2026

## Resumo do Problema

O sistema falhava ao tentar criar notas de ajuste no Sankhya via API (`CACSP.incluirNota`), retornando erros como "Tipo de Movimento inválido" e falhas de domínio.

## Solução Implementada

1. **Descoberta de Configuração (TOP 221):**
   - Utilizando queries de debug no ambiente real, descobrimos que o **TOP 221** (Ajuste de Estoque Manual - Entrada) está configurado para utilizar o `TIPMOV = 'C'` (Compra/Entrada), desviando da convenção de 'L' (Lançamento).
   - O `TIPMOV` para saída (TOP 1221) foi configurado para **'V'** (Venda/Saída) como contrapartida.

2. **Ajustes no Código (`SankhyaClient`):**
   - **Correção do TIPMOV:**

     ```typescript
     TIPMOV: { "$": top === 221 ? 'C' : 'V' }
     ```

   - **Campo Obrigatório Adicionado:** O campo `PERCDESC` (Percentual de Desconto) foi adicionado com valor 0, pois é obrigatório para este TOP.
   - **Tratamento de Retorno:** A extração do `NUNOTA` foi corrigida para lidar com o formato de objeto do Sankhya (`{ "$": "123" }` -> `123`).

3. **Validação:**
   - O teste `test/sankhya-note-sim.e2e-spec.ts` foi executado com sucesso, criando a nota **198552** no Sankhya e atualizando o status da divergência para `SYNCED`.

## Próximos Passos

- Monitorar a criação de notas de saída (TOP 1221) para garantir qque `TIPMOV='V'` é o correto (ainda não testado em cenário real, mas inferido).
- **Importante:** Excluir manualmente as notas de teste criadas no Sankhya (NUNOTAs 198551, 198552) para não impactar o estoque real.
