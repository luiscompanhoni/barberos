import { AgendaTela } from "@/components/agenda/AgendaTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Semana() {
  const s = (await sessaoAtual())!;
  return <AgendaTela modoInicial="semana" escolherBarbeiro papel={s.papel} meuBarbeiroId={s.barbeiroId} />;
}
