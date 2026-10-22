import { AgendaTela } from "@/components/agenda/AgendaTela";
import { GavetaCaixa } from "@/components/financeiro/GavetaCaixa";
import { BALCAO, sessaoAtual } from "@/lib/auth/sessao";

export default async function Recepcao() {
  const s = (await sessaoAtual())!;
  return (
    <>
      <header className="cabecalho-gestao mb-5">
        <div><p className="eyebrow">Opera��o da Black</p><h1 className="titulo-marca mt-1 text-3xl">Recep��o</h1>
          <p className="mt-2 text-sm text-zinc-600">Agenda, chegada e atendimento em um s� lugar.</p></div>
      </header>
      <AgendaTela modoInicial="dia" papel={s.papel} meuBarbeiroId={s.barbeiroId} />
      {BALCAO.includes(s.papel) && <GavetaCaixa />}
    </>
  );
}
