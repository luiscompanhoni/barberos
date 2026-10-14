import { redirect } from "next/navigation";
import { JogosAdmin } from "@/components/jogos/admin/JogosAdmin";
import { pode } from "@/lib/auth/permissoes";
import { BALCAO, GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** Jogos de recompensa: dono e gerente configuram; a recepcao confere codigos e entrega premios. */
export default async function Jogos() {
  const s = (await sessaoAtual())!;
  if (!BALCAO.includes(s.papel)) redirect("/");
  return <JogosAdmin podeConfigurar={GESTAO.includes(s.papel)} verResultado={await pode(s, "resultado")} />;
}
