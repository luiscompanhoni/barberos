-- Bonus da campanha da equipe ligado ao lancamento BONUS da folha do vendedor (vazio nos sorteados antes disso).
ALTER TABLE "bonus_equipe" ADD COLUMN "folhaLancamentoId" TEXT;

CREATE UNIQUE INDEX "bonus_equipe_folhaLancamentoId_key" ON "bonus_equipe"("folhaLancamentoId");
