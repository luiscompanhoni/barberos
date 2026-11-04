-- A conversa guarda a escolha de quem ainda não tem cadastro de cliente.
ALTER TABLE "conversas" ADD COLUMN "recusaAutomaticas" BOOLEAN NOT NULL DEFAULT false;

-- Preserva recusas já registradas em clientes existentes.
UPDATE "conversas" AS c SET "recusaAutomaticas" = true
FROM "clientes" AS p WHERE (c."clienteId" = p.id OR c.telefone = p.telefone) AND p."aceitaMensagens" = false;

-- Há vários caminhos de cadastro. A mesma trava usada pelo processamento de
-- PARAR serializa inserção e troca de telefone com a decisão do titular.
CREATE FUNCTION aplicar_recusa_automatica_cliente() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Atualizações de telefone travam ambos em ordem estável para evitar deadlock.
  IF TG_OP = 'UPDATE' AND OLD.telefone <> NEW.telefone THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-optout:' || LEAST(OLD.telefone, NEW.telefone), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-optout:' || GREATEST(OLD.telefone, NEW.telefone), 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-optout:' || NEW.telefone, 0));
  END IF;
  IF EXISTS (SELECT 1 FROM conversas WHERE telefone = NEW.telefone AND "recusaAutomaticas" = true) THEN
    NEW."aceitaMensagens" := false;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cliente_respeita_recusa_contato
  BEFORE INSERT OR UPDATE OF telefone ON clientes
  FOR EACH ROW EXECUTE FUNCTION aplicar_recusa_automatica_cliente();
