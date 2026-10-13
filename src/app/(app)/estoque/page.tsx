import { redirect } from "next/navigation";
import { EstoqueTela } from "@/components/comandas/EstoqueTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Estoque() {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO" && s.papel !== "RECEPCAO") redirect("/");
  return <EstoqueTela dono={s.papel === "DONO"} />;
}
