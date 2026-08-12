# 📦 Sistema de Contagem Cíclica Cega

Sistema de auditoria e contagem cíclica para inventário contínuo, focado em precisão logística e integração segura.

---

## 🧭 Documentação Estratégica

- **[ROADMAP.md](./ROADMAP.md)**: Status atual do projeto e visão de longo prazo.
- **[PLANO_DE_ACAO.md](./PLANO_DE_ACAO.md)**: Tarefas imediatas e guia técnico.
- **[API_SPEC.md](./API_SPEC.md)**: Documentação técnica dos endpoints da API.
- **[ARCHITECTURE.md](./.agent/ARCHITECTURE.md)**: Detalhes da stack e infraestrutura.
- **[SECURITY_DEPLOY_VPS.md](./docs/SECURITY_DEPLOY_VPS.md)**: Guia de deploy seguro em VPS.
- **[CHANGELOG.md](./CHANGELOG.md)**: Histórico de releases e mudanças publicadas.
- **[Release 2026-08-12](./docs/releases/2026-08-12-contagem-ean-fila-real.md)**: EAN obrigatório, fila real e checklist de deploy.

---

## 🚀 Quick Start

### 1. Infraestrutura (Postgres + Redis)

```bash
docker compose up -d
```

### 2. Backend (NestJS)

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npx ts-node prisma/seed_gestao.ts  # Carga inicial premium
npm run start:dev
```

### 3. Frontend (Next.js 14)

```bash
cd frontend
npm install
npm run dev
```

---

## 📋 Credenciais de Desenvolvimento (v1.1)

| Papel | Login | Senha | Destaque |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `admin123` | Controle total e logs. |
| **Supervisor** | `supervisor` | `super123` | Dashboard real-time e metas. |
| **Operador** | `operador1` | `123` | Interface mobile-first. |

---

## 🏗️ Stack Tecnológica

- **Core**: NestJS (Back) & Next.js 14 (Front)
- **Dados**: Prisma ORM + PostgreSQL + Redis
- **Design**: CSS Modules + Variáveis Globais (Dark Premium)
- **Testes**: Playwright (E2E)

---

## 🔌 Portas e Acessos

- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:3001/api](http://localhost:3001/api)
- **Banco de Dados**: `5434` (PostgreSQL)

---
*Este projeto utiliza Agentes de IA para evolução contínua. Consulte o ROADMAP antes de iniciar grandes mudanças.*
