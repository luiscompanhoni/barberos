-- Uma reserva ativa por cliente impede dois envios ao mudar o intervalo ou os servicos elegiveis.
CREATE UNIQUE INDEX "recompra_avisos_cliente_reserva_unica"
ON "recompra_avisos" ("clienteId")
WHERE "estado" IN ('PENDENTE', 'FALHOU', 'PROCESSANDO', 'INCERTO');
