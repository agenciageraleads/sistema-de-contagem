# 🗺️ Roadmap Universal - Sistema de Contagem Cíclica

Este documento é a fonte única de verdade para o progresso do projeto, detalhando cada fase desde a fundação até o polimento final.

---

## 🏗️ Status Atual: **Ciclo 4 - Reconciliação Inteligente (v1.1)**

---

## 🚀 Ciclos de Desenvolvimento

### ✅ Ciclo 1: Fundação e Infraestrutura (Concluído)

- [x] **Setup Inicial**: Estrutura NestJS (Back) + Next.js 14 (Front).
- [x] **Infra**: Docker Compose (Postgres/Redis).
- [x] **Banco de Dados**: Tabelas centrais (`users`, `snapshot_estoque`, `fila_contagem`, `contagens`, `divergencias`).
- [x] **Autenticação**: JWT com Guards por Role (Operador/Supervisor/Admin).
- [x] **Design Base**: Tema Dark Premium com variáveis CSS globais.

### ✅ Ciclo 2: Gestão e Auditoria Estendida (Concluído)

- [x] **Dashboard do Supervisor**: KPIs de divergência (sobra/falta) e valor financeiro de estoque.
- [x] **Ranking de Operadores**: Assertividade e produtividade em tempo real.
- [x] **Meta Global Dinâmica**: Divisão automática do objetivo diário entre a equipe ativa.
- [x] **Upgrade Visual**: Tipografia técnica e UI premium polida.
- [x] **Auditoria de Produtos**: Visualização de descrição de produto, marca e controle nas divergências.
- [ ] **Ergonomia do Operador**: Testes de usabilidade e feedback tátil no mobile.

### ✅ Ciclo 3: Fila Dinâmica e Integração Sankhya (Concluído)

- [x] **Job de Sincronização Noturna**: Criação automática de snapshot diário às 03:00.
- [x] **Algoritmo de Priorização**: Fórmula baseada em `valor estoque / (1 + contagens_ok * 0.5)`.
- [x] **Integração Real (Leitura)**: Consulta SQL direta em `TGFPRO`, `TGFEST` e `TGFITE`.
- [x] **Fila Dinâmica**: Sistema de locks para evitar contagens duplicadas.

### 🔄 Ciclo 4: Reconciliação Inteligente (Em Andamento)

- [x] **Busca de Movimentações**: Verificação automática de entradas/saídas/reservas(TOP 1000/1150) do Sankhya em caso de divergência. ✅ *11/fev*
- [x] **Lógica de Recontagem**: Disparo automático de nova contagem para divergências > 5%. ✅ *11/fev*
- [x] **Regra de "Não Achei"**: Guarda anti-duplicação + envio para auditoria após 2 operadores. ✅ *11/fev*
- [ ] **Painel do Supervisor**: Exibir movimentações, saldo ajustado e ação "Finalizar Análise" no frontend.

> **Avarias (Local 10090000)** → Movido para **v1.2** (fluxo separado do inventário cíclico).

### 🔄 Ciclo 5: Geração de Ajustes e Admin (Parcial)

- [x] **Ajuste em Lote no Sankhya**: Criação automática de notas (TOP 221/1121) via API Sankhya. ✅ *11/fev*
- [x] **Custo de Reposição (CUSREP)**: Busca automática da TGFCUS para notas de saída. ✅ *11/fev*
- [ ] **CRUD Admin**: Gestão completa de usuários, metas manuais e parâmetros do sistema.
- [ ] **Logs de Integração**: Painel de monitoramento de jobs e erros de API externa.

### 📅 Ciclo 6: Finalização e Deploy (Produção)

- [ ] **Deploy em VPS**: Configuração de Docker Swarm, Nginx e SSL (Let's Encrypt).
- [ ] **Backup Automático**: Rotinas de dump do PostgreSQL e persistência de snapshots.
- [ ] **Polimento Final**: Animações de loading, Error Boundaries e otimização de queries (Redis).

---

## 📑 Documentação de Referência

- **[PLANO_DE_ACAO.md](./PLANO_DE_ACAO.md)**: Tarefas técnicas detalhadas do ciclo atual.
- **[API_SPEC.md](./API_SPEC.md)**: Documentação técnica dos endpoints.
- **[ARCHITECTURE.md](./.agent/ARCHITECTURE.md)**: Stack e fluxos de dados.

---
Última atualização: 11 de Fevereiro de 2026 - 14:54
