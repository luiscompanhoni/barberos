-- CHECK com expressão nula não deve aceitar piloto ativo sem destinatário.
ALTER TABLE "recrutamento_whatsapp_piloto" ADD CONSTRAINT "piloto_telefone_obrigatorio" CHECK (NOT ativo OR telefone IS NOT NULL);
