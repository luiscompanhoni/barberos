-- Conexao com a API oficial do WhatsApp feita pelo cadastro incorporado (linha unica).
CREATE TABLE "whatsapp_oficial" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "numero" TEXT,
    "tokenCifrado" TEXT NOT NULL,
    "coexistencia" BOOLEAN NOT NULL DEFAULT false,
    "conectadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sincronizacaoEm" TIMESTAMPTZ(3),
    "sincronizacaoErro" TEXT,
    "desconectadoEm" TIMESTAMPTZ(3),
    "motivoDesconexao" TEXT,

    CONSTRAINT "whatsapp_oficial_pkey" PRIMARY KEY ("id")
);
