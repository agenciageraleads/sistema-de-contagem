-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OPERADOR', 'SUPERVISOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "FilaStatus" AS ENUM ('PENDENTE', 'EM_CONTAGEM', 'BLOQUEADO_AUDITORIA');

-- CreateEnum
CREATE TYPE "ContagemTipo" AS ENUM ('CONTAGEM', 'RECONTAGEM', 'NAO_ACHOU');

-- CreateEnum
CREATE TYPE "StatusAnalise" AS ENUM ('OK_AUTOMATICO', 'DIVERGENCIA_PENDENTE', 'RESOLVIDO');

-- CreateEnum
CREATE TYPE "Severidade" AS ENUM ('BAIXA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "Decisao" AS ENUM ('AJUSTAR', 'RECONTAR', 'VOLTAR_FILA', 'IGNORAR');

-- CreateEnum
CREATE TYPE "AjusteTipo" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "DivergenciaStatus" AS ENUM ('PENDENTE', 'ACEITO', 'EM_PROCESSAMENTO', 'CONCLUIDO', 'ERRO');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERADOR',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metas_user" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "meta_diaria" INTEGER NOT NULL DEFAULT 30,
    "meta_mensal" INTEGER NOT NULL DEFAULT 1000,
    "vigencia_inicio" TIMESTAMP(3) NOT NULL,
    "vigencia_fim" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metas_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_estoque" (
    "id" SERIAL NOT NULL,
    "data_ref" DATE NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codlocal" INTEGER NOT NULL,
    "codprod" INTEGER NOT NULL,
    "descprod" TEXT NOT NULL,
    "marca" TEXT,
    "controle" TEXT,
    "codgrupoprod" INTEGER,
    "saldo_espelho" DECIMAL(15,4) NOT NULL,
    "custo_espelho" DECIMAL(15,4) NOT NULL,
    "valor_estoque" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshot_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fila_contagem" (
    "id" SERIAL NOT NULL,
    "codprod" INTEGER NOT NULL,
    "codlocal" INTEGER NOT NULL,
    "codemp" INTEGER NOT NULL,
    "descprod" TEXT NOT NULL,
    "marca" TEXT,
    "controle" TEXT,
    "prioridade_base" INTEGER NOT NULL DEFAULT 0,
    "prioridade_manual" INTEGER NOT NULL DEFAULT 0,
    "motivo_priorizacao" TEXT,
    "priorizado_por" INTEGER,
    "status" "FilaStatus" NOT NULL DEFAULT 'PENDENTE',
    "ultimo_evento" TIMESTAMP(3),
    "contagens_ok" INTEGER NOT NULL DEFAULT 0,
    "nao_achou_count" INTEGER NOT NULL DEFAULT 0,
    "ultima_contagem_em" TIMESTAMP(3),
    "locked_by" INTEGER,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fila_contagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contagens" (
    "id" SERIAL NOT NULL,
    "codprod" INTEGER NOT NULL,
    "codlocal" INTEGER NOT NULL,
    "codemp" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "fila_id" INTEGER NOT NULL,
    "tipo" "ContagemTipo" NOT NULL,
    "qtd_contada" DECIMAL(15,4),
    "ts_inicio" TIMESTAMP(3) NOT NULL,
    "ts_fim" TIMESTAMP(3),
    "snapshot_id" INTEGER,
    "esperado_no_momento" DECIMAL(15,4),
    "divergencia" DECIMAL(15,4),
    "divergencia_percent" DECIMAL(8,4),
    "status_analise" "StatusAnalise" NOT NULL DEFAULT 'DIVERGENCIA_PENDENTE',
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "divergencias" (
    "id" SERIAL NOT NULL,
    "contagem_id" INTEGER NOT NULL,
    "severidade" "Severidade" NOT NULL DEFAULT 'BAIXA',
    "decisao" "Decisao",
    "aprovado_por" INTEGER,
    "aprovado_em" TIMESTAMP(3),
    "ajuste_tipo" "AjusteTipo",
    "ajuste_qtd" DECIMAL(15,4),
    "sankhya_doc_id" TEXT,
    "status" "DivergenciaStatus" NOT NULL DEFAULT 'PENDENTE',
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "divergencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_logs" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "data_execucao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "produtos_processados" INTEGER,
    "duracao_segundos" INTEGER,
    "detalhe" TEXT,
    "erro" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes" (
    "id" SERIAL NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "descricao" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_key" ON "users"("login");

-- CreateIndex
CREATE INDEX "snapshot_estoque_data_ref_idx" ON "snapshot_estoque"("data_ref");

-- CreateIndex
CREATE INDEX "snapshot_estoque_codprod_idx" ON "snapshot_estoque"("codprod");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_estoque_data_ref_codemp_codlocal_codprod_key" ON "snapshot_estoque"("data_ref", "codemp", "codlocal", "codprod");

-- CreateIndex
CREATE INDEX "fila_contagem_status_prioridade_manual_prioridade_base_idx" ON "fila_contagem"("status", "prioridade_manual", "prioridade_base");

-- CreateIndex
CREATE UNIQUE INDEX "fila_contagem_codprod_codlocal_codemp_key" ON "fila_contagem"("codprod", "codlocal", "codemp");

-- CreateIndex
CREATE INDEX "contagens_user_id_idx" ON "contagens"("user_id");

-- CreateIndex
CREATE INDEX "contagens_codprod_idx" ON "contagens"("codprod");

-- CreateIndex
CREATE INDEX "contagens_status_analise_idx" ON "contagens"("status_analise");

-- CreateIndex
CREATE INDEX "contagens_created_at_idx" ON "contagens"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "divergencias_contagem_id_key" ON "divergencias"("contagem_id");

-- CreateIndex
CREATE INDEX "divergencias_status_idx" ON "divergencias"("status");

-- CreateIndex
CREATE INDEX "divergencias_severidade_idx" ON "divergencias"("severidade");

-- CreateIndex
CREATE INDEX "job_logs_tipo_data_execucao_idx" ON "job_logs"("tipo", "data_execucao");

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_chave_key" ON "configuracoes"("chave");

-- AddForeignKey
ALTER TABLE "metas_user" ADD CONSTRAINT "metas_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fila_contagem" ADD CONSTRAINT "fila_contagem_priorizado_por_fkey" FOREIGN KEY ("priorizado_por") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fila_contagem" ADD CONSTRAINT "fila_contagem_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagens" ADD CONSTRAINT "contagens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagens" ADD CONSTRAINT "contagens_fila_id_fkey" FOREIGN KEY ("fila_id") REFERENCES "fila_contagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagens" ADD CONSTRAINT "contagens_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshot_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divergencias" ADD CONSTRAINT "divergencias_contagem_id_fkey" FOREIGN KEY ("contagem_id") REFERENCES "contagens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divergencias" ADD CONSTRAINT "divergencias_aprovado_por_fkey" FOREIGN KEY ("aprovado_por") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
