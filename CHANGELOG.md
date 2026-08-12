# Changelog

Todas as mudancas relevantes deste projeto devem ser registradas aqui.

## 2026-08-12 - Contagem com EAN obrigatorio e fila operacional real

### Adicionado
- Validacao obrigatoria do EAN/codigo de barras antes de liberar a quantidade contada.
- Normalizacao de GTIN/EAN retornado pelo Sankhya, incluindo campos duplicados ou concatenados.
- Lista operacional de itens da fila do operador, permitindo selecionar um item direcionado antes do proximo automatico.
- Fluxo mobile para contagem com campo de EAN, entrada por teclado fisico, digitacao na tela e suporte a leitura por camera.
- Documentacao de release, checklist de PR e runbook de deploy/rollback.

### Alterado
- O teclado virtual da quantidade passa a aparecer somente quando o operador toca no campo de quantidade.
- A quantidade fica bloqueada enquanto o EAN do produto atual nao for validado.
- O carregamento da fila local passa a usar itens reais do Sankhya no modo de validacao, sem movimentar estoque real.

### Corrigido
- Tratamento de EAN duplicado/concatenado vindo do cadastro do Sankhya, evitando falso erro de EAN invalido.
- Mensagem operacional quando nao houver item pendente para o operador.
- Baixa/retirada da Ressalva de Inventario passa a usar `TOP 1121`, o TOP correto para ajuste de saida.
- Divergencias com falha na finalizacao Sankhya permanecem pendentes e podem ser reprocessadas pelo supervisor.

### Observacao operacional
- A sobra de 503 unidades no `CODLOCAL=10820000` identificada no teste de producao deve ser eliminada por ajuste operacional controlado no Sankhya. Esta release corrige o comportamento da aplicacao, mas nao executa ajuste retroativo automatico nesse saldo.
