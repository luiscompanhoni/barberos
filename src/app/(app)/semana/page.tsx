import { AgendaTela } from "@/components/agenda/AgendaTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Semana() {
  const s = (await sessaoAtual())!;
  return <div className="space-y-5">
    <header className="crm-page-header"><p className="eyebrow">Agenda da equipe</p><h1 className="titulo-marca text-3xl">Sua semana</h1></header>
    <AgendaTela modoInicial="semana" escolherBarbeiro papel={s.papel} meuBarbeiroId={s.barbeiroId} />
  </div>;
}
