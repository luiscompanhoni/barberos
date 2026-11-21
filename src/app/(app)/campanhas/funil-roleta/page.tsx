import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { configuracao } from "@/lib/agenda/carregar";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";
import { PERIODOS, resolverPeriodo, type ChavePeriodo } from "@/lib/indicadores/periodo";
import { funilRoleta } from "@/lib/jogos/funil-roleta";

const chaves = Object.keys(PERIODOS) as ChavePeriodo[];
const num = new Intl.NumberFormat("pt-BR");
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

type Etapas = Awaited<ReturnType<typeof funilRoleta>>["geral"];

function EtapasFunil({ titulo, etapas }: { titulo: string; etapas: Etapas }) {
  return (
    <section className="cartao space-y-3" aria-label={titulo}>
      <h2 className="font-semibold">{titulo}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-80 text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th scope="col" className="pb-2">Etapa</th>
              <th scope="col" className="px-2 pb-2 text-right">Avançaram</th>
              <th scope="col" className="px-2 pb-2 text-right">Conversão</th>
              <th scope="col" className="pb-2 text-right">Sem essa etapa</th>
            </tr>
          </thead>
          <tbody>
            {etapas.map(e => <tr key={e.rotulo} className="border-t border-zinc-500/20">
              <th scope="row" className="py-2 pr-2 font-medium">{e.rotulo}</th>
              <td className="px-2 text-right tabular-nums">{num.format(e.quantidade)} de {num.format(e.base)}</td>
              <td className="px-2 text-right tabular-nums">{e.conversao === null ? "—" : pct.format(e.conversao)}</td>
              <td className="text-right tabular-nums">{num.format(e.perdas)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function FunilRoletaPage({ searchParams }: PageProps<"/campanhas/funil-roleta">) {
  const sessao = await sessaoAtual();
  if (!sessao || !GESTAO.includes(sessao.papel)) redirect("/");
  const [{ periodo }, cfg] = await Promise.all([searchParams, configuracao()]);
  const { chave, de, ate } = resolverPeriodo(z.enum(chaves).catch("30d").parse(periodo), cfg.fuso);
  const funil = await funilRoleta(new Date(de), new Date(ate));
  return (
    <div className="space-y-5">
      <header className="crm-page-header space-y-2">
        <Link href="/campanhas" className="text-sm underline">Campanhas</Link>
        <h1 className="titulo-marca text-3xl">Funil da roleta</h1>
        <p className="text-sm text-zinc-500">O período usa a data do giro. O resultado inclui as etapas registradas depois dele.</p>
        <nav className="crm-subtabs flex flex-wrap gap-2" aria-label="Período do funil">
          {chaves.map(p => <Link key={p} href={`/campanhas/funil-roleta?periodo=${p}`} aria-current={p === chave ? "page" : undefined}>{PERIODOS[p]}</Link>)}
        </nav>
      </header>
      {funil.giros ? <>
        <p className="text-sm"><strong>{num.format(funil.giros)} {funil.giros === 1 ? "giro" : "giros"}</strong> de {num.format(funil.clientes)} {funil.clientes === 1 ? "cliente" : "clientes"}.</p>
        <EtapasFunil titulo="Da jogada ao pós-corte" etapas={funil.geral} />
        <EtapasFunil titulo="Agendamento direto" etapas={funil.direto} />
        <EtapasFunil titulo="Retomada pelo Leonel" etapas={funil.assistido} />
        <EtapasFunil titulo="Oferta pós-corte" etapas={funil.upsell} />
        <p className="text-xs text-zinc-500">As contas usam jogadas. Lembrete e oferta são opcionais. O aceite da oferta registra interesse e fica com a equipe.</p>
      </> : <p className="cartao text-sm text-zinc-500">Nenhum giro registrado neste período.</p>}
    </div>
  );
}
