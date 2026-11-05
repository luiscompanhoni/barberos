-- A prova do telefone é registrada após OTP; não presume verificação dos cadastros anteriores.
ALTER TABLE "usuarios" ADD COLUMN "telefoneVerificadoEm" TIMESTAMPTZ(3);
