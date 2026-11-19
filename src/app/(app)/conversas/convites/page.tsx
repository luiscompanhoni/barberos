import Link from "next/link";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { relatorioConvites, type RotaConvite } from "@/lib/convites/relatorio";

const data = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const etapas = [
  ["aberturas", "Aberturas enviadas"], ["entregues","Entrega confirmada"], ["lidos","Abertura lida"],
  ["respostas","Responderam"], ["links","Links enviados"], ["linksLidos","Link lido"], ["cliques","Links acessados"],
  ["login","Chegaram ao login"], ["acessos","Acessaram a conta"], ["instalacoes","Instalação ou uso como app observado"],
  ["agenda","Abriram a agenda"], ["pedidos","Pediram um horário"], ["reservas","Marcaram"],
  ["confirmacoes","Confirmaram ou chegaram"], ["presencas","Compareceram"],
] as const;

function ultimaEtapa(j: RotaConvite) {
  if (j.compareceu) return "Compareceu";
  if (j.confirmou) return "Horário confirmado";
  if (j.marcou) return "Horário marcado após o convite";
  if (j.pediu) return "Pedido de horário registrado";
  if (j.agendaEm) return "Abriu a agenda";
  if (j.entrouEm) return "Entrou na conta";
  if (j.loginEm) return "Chegou ao login";
  if (j.clicouEm) return "Acessou o link";
  if (j.linkLidoEm) return "Leu o link";
  if (j.linkEm) return "Link enviado";
  if (j.respostaEm) return "Respondeu à abertura";
  if (j.lidaEm) return "Leu a abertura";
  if (j.entregueEm) return "Entregue · leitura não confirmada";
  return j.aberturaEm ? "Enviado · entrega não confirmada" : "Abertura incompleta";
}

export default async function Convites({ searchParams }: PageProps<"/conversas/convites">) {
  await exigirSessao(GESTAO);
  const n = Number((await searchParams).pagina);
  const pagina = Number.isSafeInteger(n) && n >= 1 && n <= 1000000 ? n : 1;
  const { totais, linhas } = await relatorioConvites(pagina);
  return <main className="space-y-5"><Link href="/conversas">← Conversas</Link><h1 className="text-2xl font-bold">Convites ao aplicativo</h1>
    <p>{totais.cliques} de {totais.links} links enviados tiveram acesso registrado no navegador. Cada convite conta uma vez.</p>
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">{etapas.map(([k, titulo]) => <div className="cartao p-3" key={k}>
      <dt className="text-sm">{titulo}</dt><dd className="text-xl font-semibold">{totais[k]}</dd></div>)}</dl>
    <p className="text-sm">A leitura depende do recibo do WhatsApp. Um link encaminhado pode ser aberto por outra pessoa. O acesso à conta exige o login do cliente convidado. A agenda considera reservas criadas nos 30 dias após o envio do link.</p>
    <div className="overflow-auto"><table className="w-full text-left"><thead><tr>{["Cliente","Abertura","Última etapa observada","Retomadas reservadas","Próxima ajuda"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
    <tbody>{linhas.map(j => <tr key={j.conversaId} className="border-t"><td className="p-2">{j.nome}</td><td>{data(j.inicioEm)}</td>
      <td>{ultimaEtapa(j)}</td><td>{j.retomadas} de 3</td><td>{j.parouEm ? "Encerrada" : j.proximaEm ? data(j.proximaEm) : "—"}</td></tr>)}</tbody></table>
    {!linhas.length && <p className="p-3">Nenhum convite nesta página.</p>}</div>
    <nav className="flex gap-3">{pagina > 1 && <Link href={`?pagina=${pagina-1}`}>Anterior</Link>}
    {pagina*50 < totais.total && <Link href={`?pagina=${pagina+1}`}>Próxima</Link>}</nav></main>;
}
