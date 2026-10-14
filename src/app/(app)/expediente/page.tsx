import { redirect } from "next/navigation";
import { ExpedienteTela } from "@/components/expediente/ExpedienteTela";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";
import { db } from "@/lib/db";

export default async function Expediente() {
  const s = (await sessaoAtual())!;
  if (s.papel === "RECEPCAO") redirect("/recepcao");
  const barbeiros =
    GESTAO.includes(s.papel)
      ? await db.barbeiro.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } })
      : await db.barbeiro.findMany({ where: { id: s.barbeiroId ?? "" }, select: { id: true, nome: true } });
  if (!barbeiros.length) {
    return <p className="cartao text-sm text-zinc-500">Nenhum barbeiro cadastrado ainda.</p>;
  }
  return <ExpedienteTela barbeiros={barbeiros} inicial={barbeiros[0].id} />;
}
