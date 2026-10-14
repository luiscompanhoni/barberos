-- Auditoria: IP e aparelho de quem fez, indices para a tela e log que nao se altera nem se apaga.
ALTER TABLE "auditoria" ADD COLUMN "ip" TEXT;
ALTER TABLE "auditoria" ADD COLUMN "dispositivo" TEXT;

CREATE INDEX "auditoria_criadoEm_idx" ON "auditoria"("criadoEm");
CREATE INDEX "auditoria_usuarioId_criadoEm_idx" ON "auditoria"("usuarioId", "criadoEm");

CREATE FUNCTION "auditoria_somente_inserir"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A auditoria não pode ser alterada nem apagada.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "auditoria_imutavel" BEFORE UPDATE OR DELETE ON "auditoria"
  FOR EACH ROW EXECUTE FUNCTION "auditoria_somente_inserir"();
CREATE TRIGGER "auditoria_sem_truncate" BEFORE TRUNCATE ON "auditoria"
  FOR EACH STATEMENT EXECUTE FUNCTION "auditoria_somente_inserir"();
