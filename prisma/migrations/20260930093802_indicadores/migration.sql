-- CreateEnum
CREATE TYPE "OrigemCliente" AS ENUM ('INDICACAO', 'INSTAGRAM', 'GOOGLE', 'FACHADA', 'WHATSAPP', 'OUTRO');

-- AlterEnum
ALTER TYPE "TipoAutomacao" ADD VALUE 'ANIVERSARIO';

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "dataNascimento" DATE,
ADD COLUMN     "origem" "OrigemCliente",
ADD COLUMN     "origemDetalhe" TEXT;

-- AlterTable
ALTER TABLE "configuracao" ADD COLUMN     "aniversario" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "presenteAniversario" TEXT;

