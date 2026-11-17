import { EQUIPE } from "@/lib/auth/sessao";
import { db } from "@/lib/db";

export async function equipeVerificadaPeloWhatsApp(telefone: string) {
  const u = await db.usuario.findUnique({ where: { telefone }, select: {
    id: true, papel: true, ativo: true, telefoneVerificadoEm: true, barbeiro: { select: { id: true, ativo: true } },
  } });
  return u?.ativo && u.telefoneVerificadoEm && EQUIPE.includes(u.papel) ? u : null;
}
