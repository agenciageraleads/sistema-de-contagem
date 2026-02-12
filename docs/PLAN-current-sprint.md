# 🎯 Plano de Ação - Release 1.2: Conectividade Real

Este documento detalha as tarefas imediatas para substituir os mocks pela integração real com o banco de dados do Sankhya, priorizando a confiabilidade dos dados de estoque.

---

## 🏗️ Tarefas Prioritárias

### 1. 🔌 Integração Real Sankhya (ALTA PRIORIDADE)

- [x] **Infra**: Configurar um novo Datasource no backend (ou usar raw queries) para conectar ao Oracle/SQL Server do Sankhya.
- [x] **Integração Gateway**: Configurado `SankhyaClient` para usar apenas ClientID, Secret e Token. (OK)
- [x] **Super Query de Inteligência**: Validada e implementada (Popularidade + Estoque + Custos `TGFCUS/DHALTER`). (OK)
- [x] **Carga Inicial da Fila**: Povoada a fila com 4.952 produtos prioritários. (OK)
- [x] **Job de Snapshot (Cron)**: Implementado e otimizado em lote para rodar às 03:00 AM. (OK)
- [ ] **Sincronização Manual**: Validar o botão "Sincronizar" no Dashboard para forçar atualização de um item específico.
- **Critério de Aceite**: O sistema deve exibir o saldo real do Sankhya e o custo correto, sem valores aleatórios (mocks).

### 2. 🛡️ Fluxo de Avarias (Setor 10090000)

- [ ] **Backend**: Alterar `ContagemService` para permitir agrupamento por marca quando for contagem de avaria.
- [ ] **Frontend**: Criar visualização de "Fila de Avarias" separada no dashboard do supervisor.
- [ ] **KPIs**: Adicionar contador de "Itens em Avaria" no grid principal de KPIs.
- **Critério de Aceite**: O operador deve conseguir selecionar uma marca e contar todos os itens daquela marca sem precisar de uma fila pré-definida de códigos.

### 3. 📑 Histórico de Decisões

- [ ] **Banco**: Criar tabela `HistoricoTratamento` para guardar quem aprovou/recontou e porquê.
- [ ] **UI**: Criar aba "Histórico" no dashboard do supervisor com filtros por data.
- **Critério de Aceite**: O supervisor deve conseguir ver o que foi decidido sobre uma divergência ocorrida há 2 dias.

---

## 🛠️ Guia de Implementação (Para Agentes)

- **Backend**: No `SankhyaService`, utilize Raw Queries do Prisma para acessar o banco legado do Sankhya de forma Performática.
- **Segurança**: Nunca exponha as credenciais do Sankhya no frontend. O backend age como um Proxy/Buffer.
- **Estabilidade**: Implementar um circuit breaker para que, se o banco do Sankhya ficar offline, os operadores ainda consigam contar os itens que já estão no snapshot local.

---
Última atualização: 10 de Fevereiro de 2026
