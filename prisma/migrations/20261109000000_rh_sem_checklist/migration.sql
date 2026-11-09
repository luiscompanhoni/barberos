-- Expansão: preserva funções, vínculos, tarefas e remunerações existentes.
-- Criar fichas sem checklist somente após todos os processos usarem a nova versão.
ALTER TABLE "checklist_pessoas" ALTER COLUMN "funcao" DROP NOT NULL;
