import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { CancelarPlano } from "@/components/cliente/CancelarPlano";

export default async function Cancelar() {
  const s = await sessaoAtual();
  if (s?.papel === "CLIENTE" && s.clienteId && await db.assinatura.findFirst({
    where: { clienteId: s.clienteId, status: { not: "CANCELADA" }, ofertaDezembro: { isNot: null } },
    select: { id: true },
  })) redirect("/c/dezembro-gratis");
  return <CancelarPlano />;
}
