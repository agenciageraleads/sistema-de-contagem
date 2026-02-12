-- AlterEnum
ALTER TYPE "Decisao" ADD VALUE 'FINALIZAR_ANALISE';

-- AlterTable
ALTER TABLE "divergencias" ADD COLUMN     "movimentacoes" JSONB,
ADD COLUMN     "saldo_ajustado" DECIMAL(15,4);

-- AlterTable
ALTER TABLE "fila_contagem" ADD COLUMN     "recontagens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultimo_nao_achou_por" INTEGER;
