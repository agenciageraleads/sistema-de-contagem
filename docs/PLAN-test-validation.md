# 🧪 Plano de Testes: Validação de Fluxos e Design (Release 1.2)

Este documento descreve os passos para validar o que já foi construído, garantindo que a base está sólida antes de avançarmos.

---

## 1. 🛠️ Backend: Fluxos Críticos

Validaremos o ciclo de vida de uma contagem através de testes de integração.

### 🔄 Fluxo A: Fila -> Contagem -> Divergência

- **Passo 1**: Inserir item na `fila_contagem` via Prisma.
- **Passo 2**: Chamar endpoint `GET /contagem/proximo` (Simular Operador).
- **Passo 3**: Chamar endpoint `POST /contagem/registrar` com valor divergente.
- **Passo 4**: Verificar se registro foi criado na tabela `divergencias` com status `PENDENTE`.

### 🔄 Fluxo B: Auditoria -> Nota de Ajuste (Mock Sankhya)

- **Passo 1**: Simular aprovação de divergência pelo supervisor.
- **Passo 2**: Validar se o payload gerado para o Sankhya segue a TOP 221/1221.
- **Passo 3**: Testar tratamento de erro quando o Sankhya retorna erro de estoque.

---

## 2. 🎨 Frontend: Design e UI/UX (Playwright)

Validaremos o visual "Premium" e a navegação básica.

### ✅ Checklist Visual

- [ ] Validar Tema Dark: Verificar se o background é `#0f172a` ou similar.
- [ ] Validar Responsividade: Testar visualização em 375px (Mobile).
- [ ] Validar KPIs: Verificar se os cards de "Sobra", "Falta" e "Assertividade" carregam.

---

## 📅 Roadmap de Execução de Testes

1. [ ] **Fase 1**: Instalar Playwright no `frontend/`.
2. [ ] **Fase 2**: Implementar `backend/test/contagem-flow.e2e-spec.ts`.
3. [ ] **Fase 3**: Criar primeiro teste Playwright: `frontend/tests/smoke-ui.spec.ts`.
4. [ ] **Fase 4**: Executar `npm test` em ambos e gerar relatório.

---
Última atualização: 10 de Fevereiro de 2026.
