-- AlterTable
ALTER TABLE "presenca_ajustes" ADD COLUMN     "pessoaId" TEXT,
ADD COLUMN     "tipo" TEXT,
ALTER COLUMN "marcacaoId" DROP NOT NULL;

-- Preserva ajustes que ja estivessem ligados a uma marcacao.
UPDATE "presenca_ajustes" AS a SET "pessoaId" = m."pessoaId" FROM "presenca_marcacoes" AS m WHERE a."marcacaoId" = m.id;
ALTER TABLE "presenca_ajustes" ALTER COLUMN "pessoaId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "presenca_ajustes" ADD CONSTRAINT "presenca_ajustes_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "checklist_pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
