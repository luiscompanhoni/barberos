CREATE TYPE "EtapaConviteApp" AS ENUM ('ABRINDO', 'AGUARDANDO', 'ENCERRADO');
ALTER TABLE "conversas" ADD COLUMN "conviteApp" "EtapaConviteApp";

-- Uma transferência ou recusa encerra o convite mesmo se a conversa voltar ao bot.
CREATE FUNCTION encerrar_convite_app() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."conviteApp" IS NOT NULL AND (NEW.estado = 'HUMANO' OR NEW."recusaAutomaticas") THEN
    NEW."conviteApp" := 'ENCERRADO';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversa_encerra_convite_app BEFORE UPDATE OF estado, "recusaAutomaticas" ON "conversas"
FOR EACH ROW EXECUTE FUNCTION encerrar_convite_app();
