ALTER TABLE "solicitacoes_horario" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'SEMANA';
ALTER TABLE "solicitacoes_horario" ADD CONSTRAINT "solicitacoes_horario_tipo_valido" CHECK ("tipo" IN ('SEMANA', 'FOLGA', 'BLOQUEIO'));
