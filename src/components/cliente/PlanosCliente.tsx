"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { itensDoPlano, planoEmDestaque, porDia } from "@/lib/assinaturas/itens";
import { TrocarPlano, type AlteracaoPlano } from "@/components/assinaturas/TrocarPlano";
import { CancelarOperacaoInicial } from "@/components/assinaturas/CancelarOperacaoInicial";
import { ContinuarPagamentoInicial } from "@/components/assinaturas/ContinuarPagamentoInicial";

type Plano = {
  id: string; nome: string; descricao: string | null; precoCentavos: number;
  intervaloMinDias: number | null; diasSemana: number[]; descontoExtrasPct: number;
  formasPagamento: string[]; servicos: { nome: string; usosPorCiclo: number | null }[];
  vagasRestantes: number | null; naListaDeEspera: boolean;
  etiquetas: string[]; compravel: boolean;
};
type Atual = {
  id: string; status: string; valida: boolean; plano: { id: string; nome: string }; precoCentavos: number;
  formaPagamento: string; proximoVencimento: string | null; registroManual: boolean;
  linkPendente: string | null;
  ofertaDezembro?: boolean;
  alteracaoPlano: AlteracaoPlano; operacaoEmConferencia: boolean;
  pausada: boolean; pausadaAte: string | null; valeAte: string | null; desconto: { pct: number; ate: string } | null;
  cobrancaEmAberto: { valorCentavos: number; vencimento: string; status: string; link: string | null } | null;
} | null;
type Dados = { atual: Atual; planos: Plano[]; cpfCadastrado: string | null; emailCadastrado: string | null; whatsappContato: string | null; cobrancasBloqueadas: boolean; checkoutLeonelPlanoId: string | null };

const FORMAS: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão de crédito", BOLETO: "Boleto" };
const FORMAS_CURTAS: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão", BOLETO: "Boleto" };
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

/** Planos para o cliente: assinar, pagar mensalidade em aberto, lista de espera e cancelar. */
export function PlanosCliente({ planoId, conviteLeonel = null, mostrarOfertaDezembro = false }: {
  planoId: string | null; conviteLeonel?: string | null; mostrarOfertaDezembro?: boolean;
}) {
  const [d, setD] = useState<Dados | null>(null);
  const [formaPreferida, setForma] = useState("PIX");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const escolhido = planoId ? d?.planos.find((p) => p.id === planoId) : undefined;
  const checkoutLeonel = !!conviteLeonel && !!planoId && d?.checkoutLeonelPlanoId === planoId;
  const bloqueado = conviteLeonel ? !checkoutLeonel : d?.cobrancasBloqueadas;
  const formas = checkoutLeonel ? ["CARTAO"] : escolhido?.formasPagamento ?? [];
  const forma = formas.includes(formaPreferida) ? formaPreferida : formas[0];
  const carregar = useCallback(() => {
    const busca = conviteLeonel && planoId ? "?" + new URLSearchParams({ plano: planoId, leonel: conviteLeonel }) : "";
    return api<Dados>("/api/cliente/assinatura" + busca).then(setD).catch((e) => setMsg({ texto: e.message, erro: true }));
  }, [conviteLeonel, planoId]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function assinar(e: React.FormEvent) {
    e.preventDefault();
    if (!d || bloqueado || d.atual || !escolhido?.compravel || escolhido.vagasRestantes === 0 || !forma || enviando) return;
    setMsg(null);
    setEnviando(true);
    try {
      const r = await api<{ link: string | null }>("/api/cliente/assinatura", {
        method: "POST",
        body: { planoId: escolhido.id, forma, cpf: cpf || undefined, email: email || undefined, ...(checkoutLeonel ? { leonel: conviteLeonel } : {}) },
      });
      if (r.link) window.location.assign(r.link);
      else await carregar();
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    } finally {
      setEnviando(false);
    }
  }

  async function listaDeEspera(p: Plano) {
    try {
      const r = await api<{ posicao: number }>("/api/cliente/assinatura", { method: "POST", body: { planoId: p.id, listaDeEspera: true } });
      setMsg({ texto: `Você entrou na lista de espera (posição ${r.posicao}). Avisamos no WhatsApp quando abrir vaga.` });
      carregar();
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  if (!d) return <p className="text-sm text-zinc-500">{msg?.texto ?? "Carregando..."}</p>;
  const { atual } = d;
  const destaque = planoEmDestaque(d.planos);
  const planosExibidos = planoId ? (escolhido ? [escolhido] : []) : d.planos;
  const adesaoDisponivel = !!escolhido?.compravel && escolhido.vagasRestantes !== 0 && !atual;

  return (
    <div className="entrar-suave space-y-8">
      <div>
        {planoId && <Link href="/c/planos" className="mb-3 inline-block text-sm font-semibold text-zinc-500 underline">Voltar para todos os planos</Link>}
        <p className="eyebrow">Planos</p>
        <h1 className="titulo-marca mt-3 text-4xl">
          {adesaoDisponivel ? <>Pagamento da <span className="text-ouro">assinatura.</span></>
            : atual && !planoId && atual.status !== "PENDENTE" ? <>Sua <span className="text-ouro">assinatura.</span></>
            : planoId ? <>Plano <span className="text-ouro">escolhido.</span></> : <>Escolha sua <span className="text-ouro">rotina.</span></>}
        </h1>
      </div>
      {mostrarOfertaDezembro && !planoId && !atual?.ofertaDezembro && (
        <Link href="/c/dezembro-gratis" className="btn w-full">Dezembro Grátis <ArrowRight size={16} aria-hidden /></Link>
      )}
      {msg && <p role={msg.erro ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.texto}</p>}
      {planoId && !escolhido && <p className="cartao text-sm">Este plano não está disponível. Volte para ver as opções atuais.</p>}

      {atual?.ofertaDezembro && (
        <section className="cartao space-y-3">
          <h2 className="text-xl font-bold">Dezembro Grátis</h2>
          <p className="text-sm">Contrato de homologação</p>
          <Link href="/c/dezembro-gratis" className="btn w-full">Ver contrato Dezembro Grátis <ArrowRight size={16} aria-hidden /></Link>
        </section>
      )}
      {atual && !atual.ofertaDezembro && (
        <section className={atual.valida || atual.pausada ? "cartao-destaque space-y-3" : "cartao space-y-3 border-red-200"}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-zinc-500">Sua assinatura</p>
              <p className="mt-1 text-xl font-bold">{atual.plano.nome}</p>
              <p className="text-sm text-zinc-500">{reais(atual.precoCentavos)}/mês · {FORMAS[atual.formaPagamento] ?? atual.formaPagamento}</p>
            </div>
            <span className={atual.valida && atual.status !== "PENDENTE" ? "selo-ouro" : "rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800 uppercase"}>
              {atual.status === "PENDENTE" ? "Aguardando pagamento" : atual.pausada ? "Pausado" : atual.valeAte ? "Cancelado" : atual.valida ? "Ativo" : "Suspenso"}
            </span>
          </div>
          <div className="h-px bg-zinc-200" />
          {atual.status === "PENDENTE" ? (
            <p className="text-sm text-zinc-500">Assim que o primeiro pagamento cair, o plano ativa sozinho.</p>
          ) : atual.valida && !atual.valeAte ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">{atual.registroManual ? "Período registrado até" : "Próxima mensalidade"}{atual.status === "ATRASADA" && " (atrasada)"}</span>
              <strong>{dataBr(atual.proximoVencimento) || "—"}</strong>
            </div>
          ) : atual.pausada || atual.valeAte ? null : (
            <p className="text-sm text-red-700">{atual.registroManual ? "O período registrado terminou." : "Mensalidade atrasada: o plano fica suspenso até o pagamento."}</p>
          )}
          {atual.operacaoEmConferencia && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Operação em conferência. Aguarde a confirmação antes de pagar ou escolher outra forma de pagamento.</p>}
          {!atual.operacaoEmConferencia && atual.cobrancaEmAberto?.link && (
            <a className="btn-primario w-full py-3" href={atual.cobrancaEmAberto.link}>
              Pagar {reais(atual.cobrancaEmAberto.valorCentavos)} · venc. {dataBr(atual.cobrancaEmAberto.vencimento)}
            </a>
          )}
          {!atual.operacaoEmConferencia && !atual.cobrancaEmAberto?.link && atual.status === "PENDENTE" && atual.linkPendente && <a className="btn-primario w-full py-3" href={atual.linkPendente}>Continuar pagamento da assinatura</a>}
          {atual.status === "PENDENTE" && <CancelarOperacaoInicial key={atual.id} endpoint="/api/cliente/assinatura" assinaturaId={atual.id} emConferencia={atual.operacaoEmConferencia} continuar={<ContinuarPagamentoInicial forma={atual.formaPagamento} emConferencia={atual.operacaoEmConferencia} link={atual.cobrancaEmAberto?.link ?? atual.linkPendente} />} onAlterado={carregar} />}
          {atual.status === "ATIVA" && !atual.operacaoEmConferencia && !atual.registroManual && !atual.pausada && !atual.valeAte && <TrocarPlano key={atual.id} endpoint="/api/cliente/assinatura" assinaturaId={atual.id} planoAtualId={atual.plano.id}
            valorAtual={atual.precoCentavos} renovacao={atual.proximoVencimento} pedido={atual.alteracaoPlano}
            planos={d.planos.filter(p => p.compravel && p.formasPagamento.includes(atual.formaPagamento))} onAlterado={carregar} />}
          {atual.pausada && atual.pausadaAte && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Plano pausado até {dataBr(atual.pausadaAte)}. Ele volta sozinho e nada é cobrado durante a pausa.</p>
          )}
          {atual.valeAte && (
            <p className="rounded-xl bg-zinc-100 p-3 text-sm text-zinc-700">Cancelado: o plano vale até {dataBr(atual.valeAte)} e não haverá novas cobranças.</p>
          )}
          {atual.desconto && !atual.valeAte && (
            <p className="text-xs text-ouro">Desconto de {atual.desconto.pct}% nas mensalidades até {dataBr(atual.desconto.ate)}.</p>
          )}
          {atual.registroManual && <p className="text-xs text-zinc-500">Fale com a recepção para renovar, alterar ou cancelar o plano.</p>}
          {!atual.registroManual && !atual.valeAte && atual.status !== "PENDENTE" && (
            <Link href="/c/planos/cancelar" className="inline-block text-xs font-semibold text-zinc-500 hover:text-zinc-900">Cancelar plano</Link>
          )}
          {escolhido?.id === atual.plano.id && atual.status === "ATIVA" && atual.valida && !atual.pausada && !atual.valeAte && (
            <Link href="/c/agendar" className="btn-primario w-full py-3">Agendar meu atendimento <ArrowRight size={16} /></Link>
          )}
        </section>
      )}

      {(
        <section className="space-y-5 pt-2">
          {planosExibidos.map((p) => {
            const aberto = adesaoDisponivel;
            const itens = itensDoPlano(p);
            return (
              <article key={p.id} id={`plano-${p.id}`} style={{ scrollMarginTop: 80 }}
                className={`relative rounded-2xl border bg-white p-6 ${p.id === destaque || aberto ? "border-ouro shadow-[0_10px_32px_rgba(211,171,69,0.2)]" : "border-zinc-200"}`}>
                {(p.etiquetas.length > 0 || p.id === destaque) && <div className="mb-3 flex flex-wrap gap-1">{(p.etiquetas.length ? p.etiquetas : ["Destaque"]).map(etiqueta => <span key={etiqueta} className="max-w-full break-words rounded-full bg-ouro px-3 py-1 text-[10px] font-black text-fundo uppercase">{etiqueta}</span>)}</div>}
                <p className="text-sm font-bold">{p.nome}</p>
                <div className="mt-4 flex items-end gap-2">
                  <span className="text-4xl font-black">{reais(p.precoCentavos)}</span>
                  <span className="pb-1 text-sm text-zinc-500">/mês</span>
                </div>
                <p className="mt-1 text-xs text-ouro">{reais(porDia(p.precoCentavos))}/dia</p>
                {p.descricao && <p className="mt-3 text-sm text-zinc-500">{p.descricao}</p>}
                {!aberto && <>
                  <div className="my-5 h-px bg-zinc-200" />
                  <ul className="space-y-2.5">
                    {itens.map((i) => (
                      <li key={i} className="flex gap-3 text-sm text-zinc-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ouro" />{i}</li>
                    ))}
                  </ul>
                </>}

                {!p.compravel ? (
                  d.whatsappContato ? <a href={`https://wa.me/${d.whatsappContato}?text=${encodeURIComponent(`Olá! Quero consultar as condições do plano ${p.nome}.`)}`} target="_blank" rel="noreferrer" className="btn mt-6 w-full py-2.5">Consultar condições</a>
                    : <p className="mt-6 rounded-xl bg-zinc-100 p-3 text-sm">Consulte as condições deste plano com a recepção.</p>
                ) : atual && atual.status === "PENDENTE" ? (
                  <p className="mt-6 rounded-xl bg-amber-50 p-3 text-sm">{atual.operacaoEmConferencia
                    ? `O pagamento do ${atual.plano.nome} está em conferência. Aguarde a confirmação da equipe para continuar.`
                    : `Você já tem um pagamento em aberto para o ${atual.plano.nome}. Confira a assinatura acima antes de solicitar outra.`}</p>
                ) : atual && atual.status !== "PENDENTE" ? (
                  <p className="mt-6 rounded-xl bg-zinc-100 p-3 text-sm">{atual.status === "ATIVA" && !atual.registroManual && !atual.pausada && !atual.valeAte ? "Use a opção de upgrade ou downgrade na sua assinatura acima." : "Confira a assinatura com a recepção antes de trocar de plano."}</p>
                ) : p.vagasRestantes === 0 ? (
                  p.naListaDeEspera
                    ? <p className="mt-6 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Você está na lista de espera.</p>
                    : <button className="btn mt-6 w-full py-2.5" onClick={() => listaDeEspera(p)}>Esgotado: entrar na lista de espera</button>
                ) : aberto ? (
                  <form onSubmit={assinar} className="entrar-suave mt-6 space-y-5 border-t border-zinc-200 pt-5">
                    <fieldset>
                      <legend className="rotulo">Forma de pagamento</legend>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {formas.map((f) => (
                          <button type="button" key={f} aria-pressed={forma === f} onClick={() => setForma(f)}
                            className={forma === f ? "btn-primario px-3 py-2" : "btn px-3 py-2"}>{FORMAS_CURTAS[f] ?? f}</button>
                        ))}
                      </div>
                    </fieldset>
                    {bloqueado ? <p role="status" className="text-sm text-zinc-500">{conviteLeonel
                      ? "Entre com o número que recebeu o convite ou peça um link atualizado ao Leonel."
                      : "Os pagamentos online estão temporariamente indisponíveis. Fale com a equipe da Black para saber como assinar."}</p>
                      : !forma ? <p role="status" className="text-sm text-zinc-500">Este plano está sem formas de pagamento online. Consulte a equipe.</p>
                      : <><div>
                      <label className="rotulo" htmlFor={`cpf-${p.id}`}>CPF {d.cpfCadastrado && `(cadastrado: ${d.cpfCadastrado})`}</label>
                      <input id={`cpf-${p.id}`} className="campo-linha" inputMode="numeric" placeholder={d.cpfCadastrado ? "manter o cadastrado" : "000.000.000-00"}
                        value={cpf} onChange={(e) => setCpf(e.target.value)} />
                    </div>
                    <div>
                      <label className="rotulo" htmlFor={`email-${p.id}`}>E-mail {d.emailCadastrado && `(cadastrado: ${d.emailCadastrado})`}</label>
                      <input id={`email-${p.id}`} className="campo-linha" type="email" inputMode="email" placeholder={d.emailCadastrado ? "manter o cadastrado" : "voce@email.com"}
                        value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                    <button className="btn-primario w-full py-3" disabled={enviando}>
                      {enviando ? "Gerando pagamento..." : <>Continuar para pagamento <ArrowRight size={16} /></>}
                    </button>
                    <p className="flex items-center justify-center gap-2 text-[11px] text-zinc-500">
                      <ShieldCheck size={14} /> Cobrança mensal automática. Cancele quando quiser.
                    </p>
                    </>}
                  </form>
                ) : (
                  <Link href={`/c/planos?plano=${encodeURIComponent(p.id)}`} className={`${p.id === destaque ? "btn-primario" : "btn"} mt-6 w-full py-2.5`}>
                    Assinar plano{p.vagasRestantes !== null && p.vagasRestantes <= 5 ? ` · últimas ${p.vagasRestantes} vagas` : ""}
                  </Link>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
