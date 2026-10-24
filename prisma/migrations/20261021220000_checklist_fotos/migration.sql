CREATE TABLE "checklist_fotos" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "dados" BYTEA NOT NULL,
    "tipo" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "checklist_fotos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "checklist_fotos_itemId_idx" ON "checklist_fotos"("itemId");
ALTER TABLE "checklist_fotos" ADD CONSTRAINT "checklist_fotos_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "checklist_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
