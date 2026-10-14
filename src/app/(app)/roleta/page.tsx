import { redirect } from "next/navigation";
import { RoletaPainel } from "@/components/roleta/RoletaPainel";
import { pode } from "@/lib/auth/permissoes";
import { BALCAO, GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** Roleta de premios: dono e gerente configuram; a recepcao entrega os brindes. */
export default async function Roleta() {
  const s = (await sessaoAtual())!;
  if (!BALCAO.includes(s.papel)) redirect("/");
  return <RoletaPainel podeConfigurar={GESTAO.includes(s.papel)} verResultado={await pode(s, "resultado")} />;
}
