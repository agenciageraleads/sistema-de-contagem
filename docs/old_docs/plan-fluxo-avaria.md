# Plano de Implantação: Fluxo de Avarias (Local 10090000)

Este documento descreve a estratégia para separar e gerenciar a contagem de produtos com defeito, garantindo que o saldo de avaria seja auditado sem interferir no estoque disponível para venda.

## 1. Visão Geral

Produtos no local `10090000` possuem um ciclo de vida diferente. A prioridade de contagem e o tratamento de divergência devem ser segregados para facilitar baixas contábeis ou processos de garantia.

## 2. Mudanças no Banco de Dados (Prisma)

- **FilaContagem**: Adicionar um campo booleano `isAvaria` ou usar o `codlocal` como filtro primário.
- **Divergencia**: Adicionar um tipo específico de tratamento para avarias (Ex: `BAIXA_POR_DEFEITO`).

## 3. Backend (NestJS)

### a. Filtro de Fila

- Modificar o `buscaProximo` para aceitar um parâmetro opcional `modo`.
- Criar um "Modo Avaria" onde o operador só recebe itens do local `10090000`.

### b. Sincronização Sankhya

- Ajustar o `SankhyaService` para mapear corretamente o saldo desse local específico, garantindo que o `SnapshotEstoque` reflita a realidade das avarias.

## 4. Frontend (Next.js)

### a. Interface do Operador

- Quando um item do local `10090000` for carregado, exibir um **Alerta Visual Amarelo**: "ATENÇÃO: PRODUTO EM SETOR DE AVARIA".
- Adicionar um campo opcional de "Observação de Defeito" (Ex: Embalagem rasgada, produto quebrado).

### b. Dashboard do Supervisor

- **Filtro de Local**: Adicionar um seletor no Dashboard para ver Divergências de Venda vs. Divergências de Avaria.
- **KPI de Perda**: Card exclusivo mostrando o valor total acumulado no setor de avarias.

## 5. Fluxo de Trabalho (Workflow)

1. **Identificação**: O sistema identifica itens no local `10090000`.
2. **Segregação**: Esses itens entram em uma "Fila de Auditoria de Avarias".
3. **Contagem**: O operador conta validando não apenas a quantidade, mas o estado (opcional).
4. **Decisão**: O Supervisor decide se o item volta para o fornecedor ou se é dada a baixa definitiva.

---

## Próximos Passos (Task Slug: `implementar-fluxo-avaria`)

- [ ] Criar migração no Prisma para marcar itens de avaria.
- [ ] Implementar seletor de "Modo de Trabalho" no login (Contagem Normal vs. Auditoria de Avaria).
- [ ] Desenvolver visual de alerta no frontend para itens defeituosos.
