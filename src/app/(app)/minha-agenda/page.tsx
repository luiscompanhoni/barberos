import { redirect } from "next/navigation";
import { AgendaTela } from "@/components/agenda/AgendaTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function MinhaAgenda() {
  const s = (await sessaoAtual())!;
  if (!s.barbeiroId) redirect("/recepcao");
  return (
    <AgendaTela modoInicial="dia" permitirTrocarModo barbeiroFixo={s.barbeiroId} papel={s.papel} meuBarbeiroId={s.barbeiroId} />
  );
}
