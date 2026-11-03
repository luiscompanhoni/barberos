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
    <div className="space-y-5">
      <header className="crm-page-header"><p className="eyebrow">Seu atendimento</p><h1 className="titulo-marca text-3xl">Minha agenda</h1></header>
      <AgendaTela key={JSON.stringify(entrada)} {...entrada} modoInicial="dia" permitirTrocarModo barbeiroFixo={s.barbeiroId} papel={s.papel} meuBarbeiroId={s.barbeiroId} />
    </div>
  );
}
