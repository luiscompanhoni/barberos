ALTER TABLE "conversas" ADD COLUMN "instagramIgsid" TEXT,
ADD COLUMN "instagramClienteId" TEXT;

CREATE UNIQUE INDEX "conversas_instagramIgsid_key" ON "conversas"("instagramIgsid");
CREATE INDEX "conversas_instagramClienteId_idx" ON "conversas"("instagramClienteId");

ALTER TABLE "conversas" ADD CONSTRAINT "conversas_instagramClienteId_fkey"
FOREIGN KEY ("instagramClienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
