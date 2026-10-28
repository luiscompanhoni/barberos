import { redirect } from "next/navigation";
import { AgendaTela } from "@/components/agenda/AgendaTela";
import { sessaoAtual } from "@/lib/auth/sessao";
import { entradaAgenda, queryEntradaAgenda } from "@/lib/agenda/entrada";

export default async function MinhaAgenda({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = (await sessaoAtual())!;
  const query = await searchParams;
  if (!s.barbeiroId) redirect(`/recepcao?${queryEntradaAgenda(entradaAgenda(query, s))}`);
  const entrada = entradaAgenda(query, s, true);
  return (
    <AgendaTela key={JSON.stringify(entrada)} {...entrada} modoInicial="dia" permitirTrocarModo barbeiroFixo={s.barbeiroId} papel={s.papel} meuBarbeiroId={s.barbeiroId} />
  );
}
