import { AgendaTela } from "@/components/agenda/AgendaTela";
import Link from "next/link";
import { GavetaCaixa } from "@/components/financeiro/GavetaCaixa";
import { BALCAO, sessaoAtual } from "@/lib/auth/sessao";

export default async function Recepcao() {
  const s = (await sessaoAtual())!;
  return (
    <>
      <header className="cabecalho-gestao mb-5">
        <div><p className="eyebrow">Operação da Black</p><h1 className="titulo-marca mt-1 text-3xl">Recepção</h1>
          <p className="mt-2 text-sm text-zinc-600">Agenda, chegada e atendimento em um só lugar.</p></div>
        <div className="flex gap-2"><Link href="/comandas" className="btn">Comandas</Link>
          {BALCAO.includes(s.papel) && <Link href="/caixa" className="btn-primario">Abrir caixa →</Link>}</div>
      </header>
      <AgendaTela modoInicial="dia" papel={s.papel} meuBarbeiroId={s.barbeiroId} />
      {BALCAO.includes(s.papel) && <GavetaCaixa />}
    </>
  );
}
