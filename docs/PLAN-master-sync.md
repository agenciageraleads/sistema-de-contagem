# 📋 Plano: Sincronização e Validação de Fluxo (Master Sync)

Este plano define como organizaremos o diretório, validaremos os fluxos críticos (Contagem e Notas de Ajuste) e estabeleceremos um protocolo para que múltiplos agentes trabalhem sem se perderem.

---

## 🏗️ Fase 1: Organização do Diretório e "Source of Truth"

Moveremos os documentos de planejamento para uma estrutura centralizada em `docs/` para limpar a raiz e facilitar a leitura pelos agentes.

- **Ação 1**: Mover `ROADMAP.md` -> `docs/ROADMAP.md`.
- **Ação 2**: Mover `PLANO_DE_ACAO.md` -> `docs/PLAN-current-sprint.md`.
- **Ação 3**: Mover `API_SPEC.md` -> `docs/API_SPEC.md`.
- **Ação 4**: Criar `docs/AGENT_LOGS.md` (Registro de atividades dos agentes).

---

## 🧪 Fase 2: Validação do Fluxo de Contagem e Fila

A prioridade é garantir que o que foi feito até agora está sólido antes de novas features.

1. **Teste de Stress da Fila**:
   - Validar se o `ContagemService.buscaProximo` respeita corretamente os Locks e não entrega o mesmo item para dois operadores.
   - Verificar resiliência em caso de desconexão (item travado deve expirar?).
2. **Validação de Registro de Contagem**:
   - Testar cenários de Divergência vs. OK Automático com dados reais do Snapshot.

---

## 💰 Fase 3: Validação de Lançamento de Notas (Sankhya)

O fluxo de fechamento é o ponto mais crítico do sistema.

1. **Simulação de Ajuste (Dry Run)**:
   - Implementar/Testar uma função de "Pré-visualização de Nota" que mostre o que seria enviado ao Sankhya (TOP 221/1121) sem efetivar a nota.
2. **Teste de API Sankhya**:
   - Validar o envio do JSON para o serviço `CACSP.incluirNota` com itens reais.
   - Tratar erros de "Estoque Insuficiente" no Sankhya durante a baixa de faltas.

---

## 🤖 Fase 4: Protocolo Multi-Agente (Para não se perder)

Para atender à regra de `context-window.md`, usaremos o arquivo `docs/TASKS.md` como Painel de Controle.

### Regras para os Agentes:
1. **Leitura Obrigatória**: Todo agente deve ler `docs/TASKS.md` ao iniciar.
2. **Atualização Atômica**: Ao terminar uma tarefa, o agente DEVE atualizar o status no `docs/TASKS.md`.
3. **Registro de Contexto**: O relatório de contexto final deve ser anexado ao arquivo `docs/AGENT_LOGS.md` com o ID da conversa.

---

## 📅 Cronograma Imediato

1. [ ] **Tarefa 1**: Executar a limpeza e movimentação de arquivos.
2. [ ] **Tarefa 2**: Criar `docs/TASKS.md` com o inventário real de pendências técnicas.
3. [ ] **Tarefa 3**: Criar suíte de testes de integração para o fluxo Fila -> Contagem -> Divergência.
4. [ ] **Tarefa 4**: Implementar logger de auditoria para chamadas da API Sankhya.

---

## ✅ Critérios de Aceite
- Raiz do projeto limpa (apenas dotfiles, diretórios core e configs).
- `docs/TASKS.md` refletindo exatamente o que manque para o Ciclo 2 e 5.
- Um teste automatizado cobrindo o fluxo completo de uma contagem até a geração do objeto da Nota de Ajuste.
