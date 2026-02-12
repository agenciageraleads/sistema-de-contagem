-- AlterEnum
ALTER TYPE "ContagemTipo" ADD VALUE 'PROBLEMA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FilaStatus" ADD VALUE 'REPORTADO';
ALTER TYPE "FilaStatus" ADD VALUE 'CONCLUIDO';

-- AlterTable
ALTER TABLE "divergencias" ADD COLUMN     "adjust_date" TIMESTAMP(3),
ADD COLUMN     "adjust_note_id" INTEGER,
ADD COLUMN     "adjust_status" TEXT;

-- AlterTable
ALTER TABLE "fila_contagem" ADD COLUMN     "unidade" TEXT;

-- AlterTable
ALTER TABLE "snapshot_estoque" ADD COLUMN     "unidade" TEXT;

-- CreateIndex
CREATE INDEX "divergencias_adjust_status_idx" ON "divergencias"("adjust_status");
