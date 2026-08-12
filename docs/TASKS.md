# 🗂️ Controle de Tarefas e Status do Projeto

Este arquivo é a fonte de verdade para todos os agentes. **LEIA SEMPRE ANTES DE COMEÇAR.**

## 🟢 Tarefas Disponíveis (To-Do)

### 🧱 Infra & Organização

- [ ] Implementar script de limpeza automática de logs antigos (se necessário).
- [ ] Criar ferramenta de CLI interna para visualização rápida do status da fila.

### 🧪 Validação de Fluxos (Prioridade Máxima)

- [x] Criar Testes de Integração para `ContagemService`: (OK)
  - [x] Validar concorrência na `buscaProximo`.
  - [x] Validar reset de `contagensOk` em caso de divergência. (Validado via `test/contagem-integration.e2e-spec.ts`)
- [x] Criar Testes para `SankhyaService`:
  - [x] Validar geração do JSON de inclusão de nota (TOP 221/1121) e integração REAL. (Validado via `test/sankhya-note-sim.e2e-spec.ts`)
  - [ ] Criar mock de resposta de erro do Sankhya e validar tratamento.

### 💰 Financeiro & Ajustes

- [ ] Implementar rota de "Simulação de Fechamento" (Dry Run).
- [ ] Criar dashboard de conferência de notas geradas (Status 200 vs Erro).

---

## 🟡 Em Andamento (Doing)

- [x] Reorganização de diretórios e docs. (Finalizado)
- [x] Criação do Protocolo Multi-Agente. (Finalizado)
- [x] Instalação e Configuração da infraestrutura de testes (Playwright + Jest E2E). (Finalizado)

---

## 🔴 Bloqueado (Blocked)

- *Nenhuma tarefa bloqueada no momento.*

---

## 📑 Histórico de Artefatos Gerados

- `docs/PLAN-master-sync.md`: Plano mestre de sincronização.
- `docs/ROADMAP.md`: Visão macro do projeto.
- `docs/PLAN-current-sprint.md`: Detalhes técnicos da etapa atual.
