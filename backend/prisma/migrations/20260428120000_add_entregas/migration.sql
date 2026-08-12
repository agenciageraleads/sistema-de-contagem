-- CreateTable
CREATE TABLE "entregas" (
    "id" SERIAL NOT NULL,
    "numero_pedido" TEXT NOT NULL,
    "cliente_nome" TEXT NOT NULL,
    "telefone" TEXT,
    "endereco_texto" TEXT NOT NULL,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "google_maps_url" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "pagamento" TEXT,
    "observacoes" TEXT,
    "motorista_spoke_id" TEXT,
    "motorista_nome" TEXT,
    "plan_spoke_id" TEXT,
    "route_spoke_id" TEXT,
    "stop_spoke_id" TEXT,
    "tracking_link" TEXT,
    "web_app_link" TEXT,
    "spoke_operation_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "status_detalhe" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entregas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entregas_numero_pedido_idx" ON "entregas"("numero_pedido");

-- CreateIndex
CREATE INDEX "entregas_status_idx" ON "entregas"("status");

-- CreateIndex
CREATE INDEX "entregas_created_at_idx" ON "entregas"("created_at");

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
