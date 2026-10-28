import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, proibido } from "@/lib/erros";
import type { Sessao } from "@/lib/auth/sessao";
export async function reconciliarAviso(s: Sessao, d: { id: string; estado: "ENVIADO" | "CANCELADO"; motivo: string }) {
  if (s.papel !== "DONO") throw proibido();
  return db.$transaction(async tx => {
    const aviso = await tx.recompraAviso.findUniqueOrThrow({ where: { id: d.id } });
    if (!["INCERTO", "PROCESSANDO"].includes(aviso.estado)) throw new ErroNegocio("Este aviso não precisa de conferência.");
    if (aviso.estado === "PROCESSANDO" && Date.now() - +aviso.criadoEm < 10 * 60_000) throw new ErroNegocio("O envio ainda está sendo processado. Aguarde a conclusão.");
    const r = await tx.recompraAviso.update({ where: { id: d.id }, data: { estado: d.estado, enviadoEm: d.estado === "ENVIADO" ? new Date() : null, erro: d.motivo } });
    await auditar(tx, s.usuarioId, "recompra_conferir_envio", "recompra_aviso", d.id, { antes: aviso.estado, depois: d.estado, motivo: d.motivo });
    return r;
  });
}
