import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth/sessao";
import { reais } from "@/lib/cliente-api";
import { db } from "@/lib/db";
import { ofertaDezembroEmHomologacao } from "@/lib/oferta-dezembro/config";
import {
  consultarContratoDezembro, consultarInelegibilidadeDezembro, consultarOfertaPublicaDezembro,
} from "@/lib/oferta-dezembro/consulta";
import { CRONOGRAMA_DEZEMBRO } from "@/lib/oferta-dezembro/regras";
import { AdesaoDezembro, CancelamentoDezembro } from "./acoes";

const dataBr = (dia: string) => dia.split("-").reverse().join("/");
const fuso = "America/Sao_Paulo";
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: fuso, dateStyle: "short", timeStyle: "short" });

function Condicoes({ mensalidade }: { mensalidade: number }) {
  return (
    <dl className="grid grid-cols-2 gap-4 rounded-xl bg-zinc-100 p-4 text-sm">
      <div><dt className="text-zinc-700">Dezembro de 2026</dt><dd className="mt-1 text-xl font-bold">{reais(0)}</dd></div>
      <div><dt className="text-zinc-700">A partir de 1º de janeiro</dt><dd className="mt-1 text-xl font-bold">{reais(mensalidade)}<span className="text-sm font-normal">/mês</span></dd></div>
    </dl>
  );
}

export default async function DezembroGratis() {
  if (!ofertaDezembroEmHomologacao()) notFound();
  const sessao = await sessaoAtual();
  if (!sessao?.clienteId || sessao.papel !== "CLIENTE") redirect("/c/entrar?voltar=%2Fc%2Fdezembro-gratis&confirmar=1");
  const agora = new Date();
  const [contrato, oferta] = await Promise.all([
    consultarContratoDezembro(sessao.clienteId, agora),
    consultarOfertaPublicaDezembro(agora),
  ]);
  const inelegivel = oferta && !contrato ? await consultarInelegibilidadeDezembro(db, sessao.clienteId, agora) : null;
  const fimFidelidade = dataBr(CRONOGRAMA_DEZEMBRO.fimFidelidade);

  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <Link href="/c/planos" className="inline-flex min-h-11 items-center text-sm underline">Meus planos</Link>
        <h1 className="titulo-marca text-3xl sm:text-4xl">Dezembro Grátis</h1>
        {(oferta || contrato) && <p className="text-sm font-medium text-zinc-700">Homologação · cartão e cobranças simulados</p>}
      </header>
      {contrato ? (
        <>
          <div className="cartao space-y-4">
            <div>
              <h2 className="text-xl font-bold">{contrato.planoNome}</h2>
              <p className="mt-1 text-sm">
                {contrato.status === "CANCELADA" ? "Contrato cancelado" : contrato.encerraEm
                  ? `Encerramento agendado para ${dataBr(contrato.encerraEm)}` : "Adesão confirmada"}
              </p>
            </div>
            <Condicoes mensalidade={contrato.precoCentavos} />
            <p className="text-sm">{contrato.usados} de {contrato.limiteUsos} usos de dezembro reservados ou utilizados. Restam {contrato.restantes}.</p>
            <p className="text-sm">Fidelidade de janeiro a junho de 2027. A partir de {fimFidelidade}, o cancelamento tem multa de {reais(0)}.</p>
            <p className="text-xs text-zinc-600">Termo {contrato.termosVersao} aceito em {dataHora(contrato.aceitaEm)}.</p>
            {contrato.cancelamentoSolicitadoEm && contrato.multaSimuladaCentavos !== null && (
              <p className="text-sm">Pedido de cancelamento em {dataHora(contrato.cancelamentoSolicitadoEm)}. Multa simulada de {reais(contrato.multaSimuladaCentavos)}.</p>
            )}
            {contrato.recorrencia.ciclosSimulados.length > 0 && (
              <p className="text-sm">{contrato.recorrencia.ciclosSimulados.length} competências alcançadas no simulador.</p>
            )}
          </div>
          {contrato.status !== "CANCELADA" && <>
            <Link href="/c/agendar" className="btn-primario min-h-11 w-full">Agendar atendimento</Link>
            <CancelamentoDezembro key={contrato.cancelamentoSolicitadoEm ?? "novo"} multaCentavos={contrato.multaImediataCentavos} agendado={!!contrato.encerraEm} fimFidelidade={fimFidelidade} />
          </>}
        </>
      ) : !oferta ? (
        <p className="cartao text-sm">A oferta está indisponível.</p>
      ) : (
        <>
          <div className="cartao space-y-4">
            <h2 className="text-xl font-bold">{oferta.planoNome}</h2>
            <Condicoes mensalidade={oferta.precoCentavos} />
            <p className="text-sm">Até {oferta.limiteUsos} usos no total, em serviços cobertos pelo plano durante dezembro.</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {oferta.servicos.map(s => (
                <li key={s.id}>{s.nome}{s.usosPorCiclo === null ? "" : ` · até ${s.usosPorCiclo} por ciclo`}</li>
              ))}
            </ul>
          </div>
          {inelegivel || oferta.vagasRestantes === 0 ? (
            <p className="cartao text-sm">{inelegivel?.mensagem ?? "As vagas da oferta acabaram."}</p>
          ) : (
            <>
              <section className="cartao space-y-3 text-sm" aria-labelledby="termo-dezembro">
                <h2 id="termo-dezembro" className="text-lg font-bold">Termo de adesão</h2>
                <p>De 01/12/2026 a 31/12/2026, até {oferta.limiteUsos} usos cobertos pelo plano. Os limites do plano, os dias e os profissionais habilitados também se aplicam. Faltas consomem um uso. Serviços avulsos são pagos à parte.</p>
                <p>O contrato prevê cobrança recorrente de {reais(oferta.precoCentavos)} no cartão, todo dia 1 a partir de 01/01/2027. A fidelidade abrange seis competências, de janeiro a junho. A recorrência continua até o cancelamento, nas condições do termo.</p>
                <p>Para cancelar, acesse esta página. O simulador isenta os pedidos feitos nos primeiros sete dias e calcula, após esse prazo, uma multa de até uma mensalidade, proporcional aos ciclos de fidelidade ainda não concluídos. Você também pode agendar o fim do contrato em {fimFidelidade}, com multa de {reais(0)}.</p>
                <p>Registramos a versão do termo, a data e a hora, o endereço IP e as informações do navegador junto com seu aceite. <Link href="/privacidade" className="underline">Política de privacidade</Link></p>
                <p className="text-xs text-zinc-600">Versão {oferta.termosVersao}</p>
              </section>
              <AdesaoDezembro key={JSON.stringify([oferta.planoId, oferta.precoCentavos, oferta.limiteUsos, oferta.termosVersao])} proposta={{
                planoId: oferta.planoId, precoCentavos: oferta.precoCentavos, limiteUsos: oferta.limiteUsos, termosVersao: oferta.termosVersao,
              }} />
            </>
          )}
        </>
      )}
    </section>
  );
}
