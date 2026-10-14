-- Funil das campanhas: entrega/leitura das mensagens do WhatsApp, link rastreado, giro de presente e app aberto.
-- AlterTable
ALTER TABLE "campanha_envios" ADD COLUMN     "appAbertoEm" TIMESTAMPTZ(3),
ADD COLUMN     "clicouEm" TIMESTAMPTZ(3),
ADD COLUMN     "giroId" TEXT,
ADD COLUMN     "mensagemId" TEXT,
ADD COLUMN     "token" TEXT;

-- AlterTable
ALTER TABLE "campanhas" ADD COLUMN     "roleta" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "mensagens" ADD COLUMN     "entregueEm" TIMESTAMPTZ(3),
ADD COLUMN     "lidaEm" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "campanha_envios_token_key" ON "campanha_envios"("token");

-- CreateIndex
CREATE UNIQUE INDEX "campanha_envios_giroId_key" ON "campanha_envios"("giroId");

-- AddForeignKey
ALTER TABLE "campanha_envios" ADD CONSTRAINT "campanha_envios_mensagemId_fkey" FOREIGN KEY ("mensagemId") REFERENCES "mensagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha_envios" ADD CONSTRAINT "campanha_envios_giroId_fkey" FOREIGN KEY ("giroId") REFERENCES "roleta_giros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

