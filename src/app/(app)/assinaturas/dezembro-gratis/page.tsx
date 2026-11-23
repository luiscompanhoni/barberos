import Link from "next/link";
import { redirect } from "next/navigation";
import { BALCAO, sessaoAtual } from "@/lib/auth/sessao";
import { reais } from "@/lib/cliente-api";
import { consultarPainelDezembro } from "@/lib/oferta-dezembro/consulta";

const dataHora = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default async function GestaoDezembroGratis() {
  const sessao = await sessaoAtual();
  if (!sessao || !BALCAO.includes(sessao.papel)) redirect("/");
  const painel = await consultarPainelDezembro();
  const restantes = painel?.restantesCampanha;
  const disponiveis = restantes == null ? null : Math.min(restantes, painel?.restantesPlano ?? restantes);

  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <Link href="/assinaturas" className="inline-flex min-h-11 items-center text-sm underline">Assinaturas</Link>
        <h1 className="titulo-marca text-3xl">Dezembro Grátis</h1>
        <p className="text-sm">{painel ? "Homologação · contratos simulados" : "A oferta está indisponível."}</p>
      </header>
      {painel && <>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="cartao"><dt>Vagas usadas na oferta</dt><dd className="text-2xl font-bold">{painel.usadas}</dd></div>
          <div className="cartao"><dt>Vagas restantes na oferta</dt><dd className="text-2xl font-bold">{painel.restantesCampanha ?? "Sem configuração"}</dd></div>
          <div className="cartao"><dt>Vagas abertas para adesão</dt><dd className="text-2xl font-bold">{painel.recebendoAdesoes ? disponiveis : 0}</dd></div>
        </dl>
        <div className="cartao space-y-3 overflow-x-auto">
          <h2 className="text-lg font-bold">Adesões mais recentes</h2>
          {painel.adesoes.length ? (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200"><tr>
                <th scope="col" className="p-2">Cliente</th>
                <th scope="col" className="p-2">Aceite</th>
                <th scope="col" className="p-2">Limite de usos</th>
                <th scope="col" className="p-2">Mensalidade prevista</th>
                <th scope="col" className="p-2">Estado</th>
              </tr></thead>
              <tbody>{painel.adesoes.map(a => (
                <tr key={a.assinaturaId} className="border-b border-zinc-200">
                  <td className="p-2">{a.assinatura.cliente.nome}<span className="block text-xs text-zinc-600">{a.assinatura.plano.nome}</span></td>
                  <td className="p-2">{dataHora(a.aceitaEm)}</td>
                  <td className="p-2">{a.limiteUsos}</td>
                  <td className="p-2">{reais(a.precoCentavos)}</td>
                  <td className="p-2">{a.assinatura.status === "CANCELADA" ? "Cancelado" : a.assinatura.encerraEm ? "Encerramento agendado" : "Adesão confirmada"}
                    {a.multaSimuladaCentavos !== null && <span className="block text-xs">Multa simulada de {reais(a.multaSimuladaCentavos)}</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="text-sm">Nenhuma adesão registrada.</p>}
        </div>
      </>}
    </section>
  );
}
