"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { itensDoPlano, planoEmDestaque, porDia } from "@/lib/assinaturas/itens";

type Plano = {
  id: string; nome: string; descricao: string | null; precoCentavos: number;
  intervaloMinDias: number | null; diasSemana: number[]; descontoExtrasPct: number;
  formasPagamento: string[]; servicos: { nome: string; usosPorCiclo: number | null }[];
  vagasRestantes: number | null; naListaDeEspera: boolean;
};
type Atual = {
  id: string; status: string; valida: boolean; plano: { id: string; nome: string }; precoCentavos: number;
  formaPagamento: string; proximoVencimento: string | null;
  cobrancaEmAberto: { valorCentavos: number; vencimento: string; status: string; link: string | null } | null;
} | null;
type Dados = { atual: Atual; planos: Plano[]; cpfCadastrado: string | null; emailCadastrado: string | null; motivosCancelamento: string[] };

const FORMAS: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão de crédito", BOLETO: "Boleto" };
const FORMAS_CURTAS: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão", BOLETO: "Boleto" };
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

/** Planos para o cliente: assinar, pagar mensalidade em aberto, lista de espera e cancelar. */
export function PlanosCliente() {
  const [d, setD] = useState<Dados | null>(null);
  const [escolhido, setEscolhido] = useState<Plano | null>(null);
  const [forma, setForma] = useState("PIX");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => api<Dados>("/api/cliente/assinatura").then(setD).catch((e) => setMsg({ texto: e.message, erro: true })), []);
  useEffect(() => {
    // Vindo da vitrine (/assine) com ?plano=: ja abre o formulario daquele plano.
    const alvo = new URLSearchParams(window.location.search).get("plano");
    api<Dados>("/api/cliente/assinatura")
      .then((r) => {
        setD(r);
        const p = alvo && (!r.atual || r.atual.status === "PENDENTE") ? r.planos.find((x) => x.id === alvo) : undefined;
        if (p && p.vagasRestantes !== 0) {
          setEscolhido(p);
          setForma(p.formasPagamento.includes("PIX") ? "PIX" : p.formasPagamento[0]);
          setTimeout(() => { document.getElementById(`plano-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 100);
        }
      })
      .catch((e) => setMsg({ texto: e.message, erro: true }));
  }, []);

  async function assinar(e: React.FormEvent) {
    e.preventDefault();
    if (!escolhido) return;
    setMsg(null);
    setEnviando(true);
    try {
      const r = await api<{ link: string | null }>("/api/cliente/assinatura", {
        method: "POST",
        body: { planoId: escolhido.id, forma, cpf: cpf || undefined, email: email || undefined },
      });
      if (r.link) window.location.href = r.link; // fatura do meio de pagamento
      else await carregar();
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
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

  async function cancelar() {
    if (!motivo) return setMsg({ texto: "Conta pra gente o motivo.", erro: true });
    try {
      await api("/api/cliente/assinatura", { method: "DELETE", body: { motivo, detalhe: detalhe || undefined } });
      setCancelando(false);
      setMsg({ texto: "Assinatura cancelada. Seus horários já marcados continuam, como avulsos." });
      carregar();
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  if (!d) return <p className="text-sm text-zinc-500">{msg?.texto ?? "Carregando..."}</p>;
  const { atual } = d;
  const destaque = planoEmDestaque(d.planos);

  return (
    <div className="entrar-suave space-y-8">
      <div>
        <p className="eyebrow">Planos</p>
        <h1 className="titulo-marca mt-3 text-4xl">
          {atual && atual.status !== "PENDENTE" ? <>Sua <span className="text-ouro">assinatura.</span></> : <>Escolha sua <span className="text-ouro">rotina.</span></>}
        </h1>
      </div>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.texto}</p>}

      {atual && (
        <section className={atual.valida ? "cartao-destaque space-y-3" : "cartao space-y-3 border-red-200"}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-zinc-500">Sua assinatura</p>
              <p className="mt-1 text-xl font-bold">{atual.plano.nome}</p>
              <p className="text-sm text-zinc-500">{reais(atual.precoCentavos)}/mês · {FORMAS[atual.formaPagamento] ?? atual.formaPagamento}</p>
            </div>
            <span className={atual.valida && atual.status !== "PENDENTE" ? "selo-ouro" : "rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800 uppercase"}>
              {atual.status === "PENDENTE" ? "Aguardando pagamento" : atual.valida ? "Ativo" : "Suspenso"}
            </span>
          </div>
          <div className="h-px bg-zinc-200" />
          {atual.status === "PENDENTE" ? (
            <p className="text-sm text-zinc-500">Assim que o primeiro pagamento cair, o plano ativa sozinho.</p>
          ) : atual.valida ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Próxima mensalidade{atual.status === "ATRASADA" && " (atrasada)"}</span>
              <strong>{dataBr(atual.proximoVencimento) || "—"}</strong>
            </div>
          ) : (
            <p className="text-sm text-red-700">Mensalidade atrasada: o plano fica suspenso até o pagamento.</p>
          )}
          {atual.cobrancaEmAberto?.link && (
            <a className="btn-primario w-full py-3" href={atual.cobrancaEmAberto.link}>
              Pagar {reais(atual.cobrancaEmAberto.valorCentavos)} · venc. {dataBr(atual.cobrancaEmAberto.vencimento)}
            </a>
          )}
          {atual.status !== "PENDENTE" && !cancelando && (
            <button className="text-xs font-semibold text-zinc-500 hover:text-zinc-900" onClick={() => setCancelando(true)}>Cancelar assinatura</button>
          )}
          {cancelando && (
            <div className="space-y-3 rounded-xl bg-zinc-50 p-4 text-sm">
              <p>Poxa! Antes de ir: se o problema for horário ou preço, fala com a gente no WhatsApp que a gente tenta resolver.</p>
              <label className="rotulo" htmlFor="motivo">Por que você quer cancelar?</label>
              <select id="motivo" className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                <option value="">Escolha...</option>
                {d.motivosCancelamento.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input className="campo" placeholder="Quer contar mais? (opcional)" value={detalhe} onChange={(e) => setDetalhe(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primario" onClick={() => setCancelando(false)}>Continuar assinante</button>
                <button className="btn-perigo" onClick={cancelar}>Cancelar assinatura</button>
              </div>
            </div>
          )}
        </section>
      )}

      {(!atual || atual.status === "PENDENTE") && (
        <section className="space-y-5 pt-2">
          {d.planos.map((p) => {
            const aberto = escolhido?.id === p.id;
            const itens = itensDoPlano(p);
            return (
              <article key={p.id} id={`plano-${p.id}`} style={{ scrollMarginTop: 80 }}
                className={`relative rounded-2xl border bg-white p-6 ${p.id === destaque || aberto ? "border-ouro shadow-[0_10px_32px_rgba(211,171,69,0.2)]" : "border-zinc-200"}`}>
                {p.id === destaque && (
                  <span className="absolute top-0 right-5 -translate-y-1/2 rounded-full bg-ouro px-3 py-1 text-[9px] font-black text-fundo uppercase">Destaque</span>
                )}
                <p className="text-sm font-bold">{p.nome}</p>
                <div className="mt-4 flex items-end gap-2">
                  <span className="text-4xl font-black">{reais(p.precoCentavos)}</span>
                  <span className="pb-1 text-sm text-zinc-500">/mês</span>
                </div>
                <p className="mt-1 text-xs text-ouro">{reais(porDia(p.precoCentavos))}/dia</p>
                {p.descricao && <p className="mt-3 text-sm text-zinc-500">{p.descricao}</p>}
                <div className="my-5 h-px bg-zinc-200" />
                <ul className="space-y-2.5">
                  {itens.map((i) => (
                    <li key={i} className="flex gap-3 text-sm text-zinc-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ouro" />{i}</li>
                  ))}
                </ul>

                {p.vagasRestantes === 0 ? (
                  p.naListaDeEspera
                    ? <p className="mt-6 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Você está na lista de espera.</p>
                    : <button className="btn mt-6 w-full py-2.5" onClick={() => listaDeEspera(p)}>Esgotado: entrar na lista de espera</button>
                ) : aberto ? (
                  <form onSubmit={assinar} className="entrar-suave mt-6 space-y-5 border-t border-zinc-200 pt-5">
                    <div>
                      <p className="rotulo">Forma de pagamento</p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {p.formasPagamento.map((f) => (
                          <button type="button" key={f} onClick={() => setForma(f)}
                            className={forma === f ? "btn-primario py-2" : "btn py-2"}>{FORMAS_CURTAS[f] ?? f}</button>
                        ))}
                      </div>
                    </div>
                    <div>
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
                  </form>
                ) : (
                  <button className={`${p.id === destaque ? "btn-primario" : "btn"} mt-6 w-full py-2.5`}
                    onClick={() => { setEscolhido(p); setForma(p.formasPagamento.includes("PIX") ? "PIX" : p.formasPagamento[0]); setMsg(null); }}>
                    Assinar plano{p.vagasRestantes !== null && p.vagasRestantes <= 5 ? ` · últimas ${p.vagasRestantes} vagas` : ""}
                  </button>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
