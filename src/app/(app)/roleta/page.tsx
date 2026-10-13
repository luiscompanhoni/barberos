import { redirect } from "next/navigation";
import { RoletaPainel } from "@/components/roleta/RoletaPainel";
import { sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** Roleta de premios: o dono configura; a recepcao entrega os brindes. */
export default async function Roleta() {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO" && s.papel !== "RECEPCAO") redirect("/");
  return <RoletaPainel dono={s.papel === "DONO"} />;
}
