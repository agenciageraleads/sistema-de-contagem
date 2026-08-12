# Release 2026-08-12 - Contagem com EAN obrigatorio e fila operacional real

## Objetivo

Levar para producao a versao validada localmente do modulo de Contagem, com foco em reduzir erro operacional do estoquista e organizar o fluxo de contagem direcionada.

## Escopo da release

- Obrigar a validacao do EAN/codigo de barras antes de liberar o campo `Quantidade contada`.
- Aceitar entrada de EAN por bipagem, digitacao manual ou leitura pela camera do celular.
- Manter o teclado fisico funcionando para a quantidade.
- Mostrar o teclado numerico virtual apenas quando o operador tocar no campo de quantidade.
- Permitir ao operador visualizar a fila direcionada e selecionar um produto especifico para contar primeiro.
- Normalizar EANs retornados pelo Sankhya quando o campo vier duplicado ou concatenado.
- Manter a fila local de validacao com produtos reais do Sankhya, sem movimentar estoque real no modo local.

## Fora do escopo

- Ajuste automatico retroativo do saldo de 503 unidades que ficou em `CODLOCAL=10820000` no teste de producao.
- Rotacao de senhas ou tokens de producao.
- Mudanca de URL publica.
- Migracao manual de historico de contagens antigas.

## Arquivos principais

- `backend/src/contagem/contagem.service.ts`
- `backend/src/sankhya/sankhya.service.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260810130000_add_contagem_barcode/migration.sql`
- `frontend/src/app/page.tsx`
- `frontend/src/app/page.module.css`
- `frontend/src/app/error.tsx`
- `frontend/src/app/global-error.tsx`
- `frontend/src/components/ErrorRecovery.tsx`
- `docker-compose.nova-vps.yml`

## Regras de negocio confirmadas

- O operador so consegue preencher quantidade depois que o EAN informado bater com o cadastro do produto no Sankhya.
- Se o EAN vier duplicado ou concatenado pelo Sankhya, a aplicacao extrai o GTIN valido antes de comparar.
- Contagem local usa fila real para simular operacao, mas nao deve criar movimentacoes no Sankhya.
- Producao pode executar movimentacoes reais conforme flags de ambiente configuradas no servidor.

## Configuracao esperada em producao

- `INVENTARIO_LOCAL_VALIDATION` deve estar ausente ou `false`.
- `INVENTARIO_SANKHYA_RESSALVA_ENABLED` deve ficar `true` para permitir movimentacoes reais de ressalva.
- `INVENTARIO_DIRECIONADA_SANKHYA_ENABLED` deve ficar `true` para buscar copia de estoque real do Sankhya.
- O arquivo de ambiente real deve continuar somente na VPS, fora do Git. Na VPS atual, o arquivo usado no deploy e `contagem-nova.env`.

## Validacao local executada

- Backend: `npm test -- --runInBand` passou com 31 testes.
- Backend: `npm run build` passou.
- Frontend: `npm run build` passou.
- Frontend local respondeu em `http://localhost:3030`.
- API local respondeu em `http://localhost:3031/api`.
- Fila local foi carregada com 5000 produtos reais do Sankhya para validacao, sem movimentos reais.

## Checklist antes do merge

- Revisar se nenhum arquivo `.env`, log, build, banco local ou `node_modules` entrou no PR.
- Conferir diff de `backend/src/contagem/contagem.service.ts`.
- Conferir diff de `backend/src/sankhya/sankhya.service.ts`.
- Conferir diff de `frontend/src/app/page.tsx` e `frontend/src/app/page.module.css`.
- Confirmar que a migration `20260810130000_add_contagem_barcode` esta incluida.
- Confirmar que o workflow de build de imagens do GitHub passou.

## Checklist de deploy na VPS

1. Confirmar merge na branch `main`.
2. Entrar na VPS e confirmar que o app atual esta em `/opt/sistema-de-contagem-nova`.
3. Criar backup da pasta atual.
4. Criar dump do Postgres antes de recriar containers.
5. Preservar `contagem-nova.env` existente.
6. Atualizar fonte da aplicacao.
7. Executar build e subida dos containers com `docker-compose.nova-vps.yml`.
8. Confirmar que frontend e backend voltaram saudaveis.
9. Validar login, inicio de contagem, validacao de EAN e bloqueio da quantidade com EAN incorreto.
10. Validar no Sankhya que nenhuma compensacao indevida foi feita automaticamente para o saldo antigo de `10820000`.

## Rollback

Rollback de aplicacao:

1. Voltar a pasta `/opt/sistema-de-contagem-nova` para o backup anterior.
2. Subir novamente os containers com o compose anterior.
3. Validar dominio e API.

Rollback de banco:

- Restaurar dump somente se houver corrupcao causada pelo deploy.
- Nao restaurar banco apenas para desfazer contagens operacionais, pois isso pode apagar eventos validos feitos apos o backup.

## Risco conhecido

O teste de producao deixou saldo excedente em `CODLOCAL=10820000`. A correcao desse saldo deve ser feita por processo operacional no Sankhya, depois de confirmar o saldo atual. O deploy desta release nao deve tentar transferir esse saldo para o Portal, pois isso somaria disponibilidade novamente.
