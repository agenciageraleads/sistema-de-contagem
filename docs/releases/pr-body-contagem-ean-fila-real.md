# PR: Contagem com EAN obrigatorio e fila operacional real

## Resumo

Esta PR prepara a versao de producao do modulo de Contagem com validacao obrigatoria de EAN/codigo de barras, melhoria de UX mobile para operadores e carregamento de fila operacional real.

## Principais mudancas

- Bloqueia `Quantidade contada` ate o EAN informado bater com o cadastro do produto.
- Aceita EAN por bipagem, digitacao manual e camera do celular.
- Mostra teclado numerico virtual somente ao tocar no campo de quantidade.
- Permite ao operador abrir a lista da fila e selecionar o item direcionado a contar primeiro.
- Normaliza EANs duplicados/concatenados vindos do Sankhya.
- Mantem validacao local com itens reais do Sankhya sem executar movimentacoes reais.
- Documenta release, checklist de deploy e rollback.

## Validacao feita

- `backend`: `npm test -- --runInBand`
- `backend`: `npm run build`
- `frontend`: `npm run build`
- Teste local em `http://localhost:3030`
- API local em `http://localhost:3031/api`

## Deploy

Deploy previsto na VPS em `/opt/sistema-de-contagem-nova`, preservando `contagem-nova.env`, com backup da pasta e dump do Postgres antes de recriar containers.

## Observacoes

- Esta PR nao corrige automaticamente o saldo residual de 503 unidades em `CODLOCAL=10820000`; esse ajuste deve ser operacional no Sankhya.
- Nenhum arquivo de ambiente real deve ser versionado.
