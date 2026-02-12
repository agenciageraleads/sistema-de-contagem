# Guia: Ajustar TOP 1121 para Não Exigir Preço de Tabela

## Contexto

O TOP 1121 (Ajuste de Estoque Manual - Saída) está configurado para exigir preço de tabela, o que bloqueia a criação de notas de ajuste via API.

## Opção 1: Via Interface Sankhya (Mais Seguro)

### Passo a Passo

1. **Login no Sankhya** com usuário administrador
2. **Menu:** Cadastros → Tipos de Negociação → Tipos de Operação
3. **Buscar:** TOP 1121 ou "AJUSTE DE ESTOQUE MANUAL - SAÍDA"
4. **Abrir para Edição** (duplo clique ou botão Editar)
5. **Localizar Configurações de Preço:**
   - Aba "Geral" ou "Validações"
   - Campos possíveis:
     - "Exigir Tabela de Preço"
     - "Controlar Preço de Venda"
     - "Validar Preço Mínimo"
     - "Bloquear sem Preço"
6. **Desmarcar/Desabilitar** as validações de preço
7. **Salvar** as alterações

### Campos Comuns na TGFTOP

- `USAPRECOBASE`: Controla se usa preço base
- `VALIDAPRECO`: Valida preço na inclusão
- `BLOQPRECOZERADO`: Bloqueia se preço for zero
- `EXIGETABPRECO`: Exige tabela de preço (provável culpado)

## Opção 2: Via SQL (Avançado)

### ⚠️ ATENÇÃO

- Requer acesso direto ao banco Oracle
- Fazer backup antes de executar
- Testar em ambiente de homologação primeiro

### Passo 1: Investigar Configuração Atual

Execute via Super Agent ou DbExplorerSP:

\`\`\`sql
SELECT
    CODTIPOPER,
    DESCROPER,
    TIPMOV,
    USAPRECOBASE,
    VALIDAPRECO,
    BLOQPRECOZERADO,
    EXIGETABPRECO,
    ATIVO
FROM TGFTOP
WHERE CODTIPOPER = 1121;
\`\`\`

### Passo 2: Comparar com TOP 221 (Entrada)

\`\`\`sql
SELECT
    CODTIPOPER,
    DESCROPER,
    USAPRECOBASE,
    VALIDAPRECO,
    BLOQPRECOZERADO,
    EXIGETABPRECO
FROM TGFTOP
WHERE CODTIPOPER IN (221, 1121);
\`\`\`

### Passo 3: Ajustar Configuração (CUIDADO!)

**Antes de executar, confirme os nomes das colunas no Passo 1!**

\`\`\`sql
-- Desabilitar validações de preço para TOP 1121
UPDATE TGFTOP
SET
    USAPRECOBASE = 'N',      -- Não usar preço base
    VALIDAPRECO = 'N',        -- Não validar preço
    BLOQPRECOZERADO = 'N',    -- Não bloquear preço zero
    EXIGETABPRECO = 'N'       -- Não exigir tabela de preço
WHERE CODTIPOPER = 1121;

COMMIT;
\`\`\`

### Passo 4: Validar Alteração

\`\`\`sql
SELECT
    CODTIPOPER,
    DESCROPER,
    USAPRECOBASE,
    VALIDAPRECO,
    BLOQPRECOZERADO,
    EXIGETABPRECO
FROM TGFTOP
WHERE CODTIPOPER = 1121;
\`\`\`

## Opção 3: Usar TOP Alternativo

Se não puder alterar o TOP 1121, identifique outro TOP de saída sem validação:

\`\`\`sql
-- Buscar TOPs de saída sem validação de preço
SELECT
    CODTIPOPER,
    DESCROPER,
    TIPMOV,
    USAPRECOBASE,
    VALIDAPRECO,
    EXIGETABPRECO
FROM TGFTOP
WHERE TIPMOV = 'V'
  AND ATIVO = 'S'
  AND (EXIGETABPRECO = 'N' OR VALIDAPRECO = 'N')
  AND DESCROPER LIKE '%AJUSTE%';
\`\`\`

## Após Ajuste

1. **Remover `.skip` do teste:**
   - Arquivo: `backend/test/sankhya-note-sim.e2e-spec.ts`
   - Linha: ~109
   - Alterar `it.skip(...)` para `it(...)`

2. **Executar teste:**
   \`\`\`bash
   npm run test:e2e -- sankhya-note-sim.e2e-spec.ts
   \`\`\`

3. **Validar no Sankhya:**
   - Verificar se a nota foi criada
   - Confirmar que o estoque foi baixado

## Troubleshooting

### Erro Persiste Após Ajuste

- Limpar cache do Sankhya (se aplicável)
- Reiniciar serviço do Sankhya
- Verificar se há outras validações em triggers ou procedures

### Não Encontra Colunas Mencionadas

- Consultar documentação específica da versão do Sankhya
- Usar Super Agent para investigar estrutura da TGFTOP
- Contatar suporte Sankhya para orientação

## Contato com Suporte Sankhya

Se precisar de ajuda oficial:

- **Pergunta:** "Como desabilitar validação de preço de tabela para TOP 1121?"
- **Contexto:** "Preciso criar notas de ajuste de estoque via API sem exigir preço cadastrado"
- **Versão:** [Informar versão do Sankhya em uso]
