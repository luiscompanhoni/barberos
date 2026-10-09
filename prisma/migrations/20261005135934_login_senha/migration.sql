-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "bloqueadoAte" TIMESTAMPTZ(3),
ADD COLUMN     "login" TEXT,
ADD COLUMN     "senhaFalhas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "senhaHash" TEXT,
ADD COLUMN     "trocarSenha" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_login_key" ON "usuarios"("login");

