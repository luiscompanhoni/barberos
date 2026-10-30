import { AgendaTela } from "@/components/agenda/AgendaTela";
import { GavetaCaixa } from "@/components/financeiro/GavetaCaixa";
import { BALCAO, sessaoAtual } from "@/lib/auth/sessao";
import { entradaAgenda } from "@/lib/agenda/entrada";
import { redirect } from "next/navigation";

export default async function Recepcao({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = (await sessaoAtual())!;
  if (s.papel === "BARBEIRO" && !s.barbeiroId) redirect("/painel");
  const entrada = entradaAgenda(await searchParams, s);
  return (
    <>
      <header className="cabecalho-gestao mb-5">
        <div><p className="eyebrow">Operação da Black</p><h1 className="titulo-marca mt-1 text-3xl">Recepção</h1>
          <p className="mt-2 text-sm text-zinc-600">Agenda, chegada e atendimento em um só lugar.</p></div>
      </header>
      <AgendaTela key={JSON.stringify(entrada)} {...entrada} modoInicial="dia" escolherBarbeiro barbeiroFixo={s.papel === "BARBEIRO" ? s.barbeiroId! : undefined} papel={s.papel} meuBarbeiroId={s.barbeiroId} />
      {BALCAO.includes(s.papel) && <GavetaCaixa />}
    </>
  );
}
