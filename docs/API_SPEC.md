# 📖 Especificação da API - Sistema de Contagem Cíclica

Esta documentação descreve todos os endpoints disponíveis na API, seus parâmetros e permissões necessárias.

---

## 🔐 Autenticação (`/api/auth`)

### 1. Login

- **Endpoint**: `POST /login`
- **Acesso**: Público
- **Body**:

  ```json
  {
    "login": "login_usuario",
    "senha": "senha_plana"
  }
  ```

- **Sucesso (200 OK)**: Retorna `token` (JWT) e objeto `user`.

### 2. Criar Usuário

- **Endpoint**: `POST /register`
- **Acesso**: Admin
- **Body**:

  ```json
  {
    "nome": "Nome Completo",
    "login": "login",
    "senha": "senha",
    "role": "OPERADOR | SUPERVISOR | ADMIN"
  }
  ```

### 3. Meu Perfil

- **Endpoint**: `GET /me`
- **Acesso**: Qualquer usuário logado (Bearer Token)
- **Sucesso**: Retorna dados básicos do usuário atual.

---

## 📦 Contagem e Operação (`/api/contagem`)

### 1. Próximo Item (Fila)

- **Endpoint**: `GET /proximo`
- **Acesso**: Operador / Admin
- **Finalidade**: Busca o item de maior prioridade na fila para o operador atual.

### 2. Estatísticas do Operador

- **Endpoint**: `GET /stats`
- **Acesso**: Operador / Admin
- **Finalidade**: Retorna progresso do dia, assertividade e meta individual calculada.

### 3. Registrar Contagem

- **Endpoint**: `POST /registrar`
- **Acesso**: Operador / Admin
- **Body**:

  ```json
  {
    "filaId": 123,
    "qtd_contada": 50.5
  }
  ```

### 4. Marcar como "Não Achei"

- **Endpoint**: `POST /nao-achei/:id`
- **Acesso**: Operador / Admin
- **Params**: `id` da fila.

---

## 👔 Gestão e Supervisão (`/api/contagem`)

### 1. Lista de Divergências

- **Endpoint**: `GET /divergencias`
- **Acesso**: Supervisor / Admin
- **Finalidade**: Lista contagens com divergência aguardando auditoria.

### 2. Tratar Divergência

- **Endpoint**: `POST /divergencias/:id/tratar`
- **Acesso**: Supervisor / Admin
- **Body**:

  ```json
  {
    "acao": "APROVAR | RECONTAR",
    "observacao": "Motivo opcional"
  }
  ```

### 3. Estatísticas de Supervisão

- **Endpoint**: `GET /supervisor/stats`
- **Acesso**: Supervisor / Admin
- **Finalidade**: Retorna KPIs financeiros (falta/sobra), progresso global e ranking de operadores.

### 4. Meta Global

- **Endpoint**: `POST /meta-global`
- **Acesso**: Supervisor / Admin
- **Body**:

  ```json
  {
    "valor": 200
  }
  ```

---
*Base URL: <http://localhost:3001/api> (Desenvolvimento)*
