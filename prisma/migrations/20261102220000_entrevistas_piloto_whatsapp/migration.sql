-- CreateTable
CREATE TABLE "recrutamento_whatsapp_piloto" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "telefone" TEXT,
    "expiraEm" TIMESTAMPTZ(3),
    "usuarioId" TEXT,
    "conversaId" TEXT,
    "estadoAnterior" TEXT,
    "conviteChave" TEXT,
    "enviados" INTEGER NOT NULL DEFAULT 0,
    "versao" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recrutamento_whatsapp_piloto_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "recrutamento_whatsapp_piloto" ADD CONSTRAINT "piloto_unico" CHECK (id=1);
ALTER TABLE "recrutamento_whatsapp_piloto" ADD CONSTRAINT "piloto_limites" CHECK (enviados BETWEEN 0 AND 40 AND versao >= 0);
ALTER TABLE "recrutamento_whatsapp_piloto" ADD CONSTRAINT "piloto_destino" CHECK (NOT ativo OR (telefone ~ '^55[0-9]{10,11}$' AND "expiraEm" IS NOT NULL AND "usuarioId" IS NOT NULL));
