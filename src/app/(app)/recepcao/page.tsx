import { AgendaTela } from "@/components/agenda/AgendaTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Recepcao() {
  const s = (await sessaoAtual())!;
  return <AgendaTela modoInicial="dia" papel={s.papel} meuBarbeiroId={s.barbeiroId} />;
}
