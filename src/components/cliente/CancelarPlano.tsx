"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, MessageCircle, PauseCircle, Percent } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";

type Motivo = { codigo: string; rotulo: string };
type Oferta =
  | { tipo: "DESCONTO"; pct: number; meses: number }
  | { tipo: "PAUSA"; opcoesDias: number[] }
  | { tipo: "GERENTE" }
  | { tipo: "NENHUMA" };
type Previa = { oferta: Oferta; cancelamento: { imediato: boolean; ultimoDia: string | null; cashbarber: boolean }; mensalidadeCentavos: number };
type Plano = { nome: string; status: string; valeAte: string | null; pausada: boolean } | null;
type Etapa = "motivo" | "oferta" | "confirmar" | "feito";

const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const somarDias = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("pt-BR");
};

/** Cancelar plano em etapas: motivo, oferta de retencao, confirmacao. */
export function CancelarPlano() {
  const [plano, setPlano] = useState<Plano | undefined>(undefined);
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [etapa, setEtapa] = useState<Etapa>("motivo");
  const [motivo, setMotivo] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [dias, setDias] = useState<number | null>(null);
  const [resultado, setResultado] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<{ atual: (Omit<NonNullable<Plano>, "nome"> & { plano: { nome: string } }) | null }>("/api/cliente/assinatura")
      .then((r) => setPlano(r.atual && { ...r.atual, nome: r.atual.plano.nome }))
      .catch((e) => setErro(e.message));
    api<{ motivos: Motivo[] }>("/api/cliente/assinatura/cancelamento").then((r) => setMotivos(r.motivos)).catch(() => {});
  }, []);

  async function verOferta() {
    if (!motivo) return setErro("Escolha um motivo.");
    if (motivo === "OUTRO" && detalhe.trim().length < 3) return setErro("Conta pra gente o motivo.");
    setErro("");
    setEnviando(true);
    try {
      const r = await api<Previa>(`/api/cliente/assinatura/cancelamento?motivo=${motivo}`);
      setPrevia(r);
      if (r.oferta.tipo === "PAUSA") setDias(r.oferta.opcoesDias[0]);
      setEtapa(r.oferta.tipo === "NENHUMA" ? "confirmar" : "oferta");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function decidir(acao: "desconto" | "pausa" | "gerente" | "cancelar") {
    setErro("");
    setEnviando(true);
    try {
      const r = await api<{ ultimoDia?: string | null; imediato?: boolean; volta?: string; proximoVencimento?: string; valorCentavos?: number; meses?: number; pct?: number }>(
        "/api/cliente/assinatura/cancelamento",
        { method: "POST", body: { acao, motivo, detalhe: detalhe.trim() || undefined, ...(acao === "pausa" ? { dias } : {}) } },
      );
      if (acao === "desconto") setResultado(`Desconto aplicado! Suas próximas ${r.meses === 1 ? "mensalidade sai" : `${r.meses} mensalidades saem`} por ${reais(r.valorCentavos ?? 0)}.`);
      else if (acao === "pausa") setResultado(`Plano pausado. Ele volta sozinho em ${dataBr(r.volta ?? null)} e a próxima mensalidade passa para ${dataBr(r.proximoVencimento ?? null)}.`);
      else if (acao === "gerente") setResultado("Pronto! O gerente vai falar com você no WhatsApp em breve. Seu plano continua valendo normalmente.");
      else setResultado(r.ultimoDia ? `Plano cancelado. Ele continua valendo até ${dataBr(r.ultimoDia)} e não haverá novas cobranças.` : "Plano cancelado. Não haverá novas cobranças.");
      setEtapa("feito");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (plano === undefined) return <p className="text-sm text-zinc-500">{erro || "Carregando..."}</p>;

  const voltar = <Link href="/c/planos" className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-500"><ArrowLeft size={13} /> Meu plano</Link>;
  if (!plano || plano.valeAte) {
    return (
      <div className="entrar-suave space-y-4">
        {voltar}
        <p className="cartao text-sm text-zinc-600">
          {plano?.valeAte ? `Seu plano já está cancelado e vale até ${dataBr(plano.valeAte)}.` : "Você não tem plano para cancelar."}
        </p>
      </div>
    );
  }

  const o = previa?.oferta;
  return (
    <div className="entrar-suave space-y-6">
      {voltar}
      <div>
        <p className="eyebrow">Cancelar plano</p>
        <h1 className="titulo-marca mt-3 text-3xl">{plano.nome}</h1>
        {etapa !== "feito" && (
          <p className="mt-2 text-xs text-zinc-500">Etapa {etapa === "motivo" ? 1 : etapa === "oferta" ? 2 : 3} de 3</p>
        )}
      </div>
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {etapa === "motivo" && (
        <section className="cartao space-y-4">
          <p className="text-sm font-semibold">Por que você quer cancelar?</p>
          <div className="space-y-2">
            {motivos.map((m) => (
              <label key={m.codigo} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${motivo === m.codigo ? "border-ouro" : "border-zinc-200"}`}>
                <input type="radio" name="motivo" value={m.codigo} checked={motivo === m.codigo} onChange={() => setMotivo(m.codigo)} className="accent-[#d3ab45]" />
                {m.rotulo}
              </label>
            ))}
          </div>
          {motivo && (
            <div>
              <label className="rotulo" htmlFor="detalhe">{motivo === "OUTRO" ? "Qual é o motivo?" : "Quer contar mais? (opcional)"}</label>
              <textarea id="detalhe" className="campo mt-1" rows={2} maxLength={200} value={detalhe} onChange={(e) => setDetalhe(e.target.value)} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href="/c/planos" className="btn-primario">Continuar assinante</Link>
            <button className="btn" disabled={enviando} onClick={verOferta}>{enviando ? "Carregando..." : "Próximo"}</button>
          </div>
        </section>
      )}

      {etapa === "oferta" && o && (
        <section className="cartao-destaque space-y-4">
          {o.tipo === "DESCONTO" && (
            <>
              <Percent className="text-ouro" size={26} />
              <p className="text-lg font-bold">Que tal {o.pct}% de desconto?</p>
              <p className="text-sm text-zinc-600">
                {o.meses === 1 ? "Na próxima mensalidade" : `Nas próximas ${o.meses} mensalidades`} você paga{" "}
                <b>{reais(Math.round((previa!.mensalidadeCentavos * (100 - o.pct)) / 100))}</b> em vez de {reais(previa!.mensalidadeCentavos)}. Depois volta ao valor normal.
              </p>
              <button className="btn-primario w-full py-3" disabled={enviando} onClick={() => decidir("desconto")}>Quero o desconto e continuar</button>
            </>
          )}
          {o.tipo === "PAUSA" && (
            <>
              <PauseCircle className="text-ouro" size={26} />
              <p className="text-lg font-bold">Pause em vez de cancelar</p>
              <p className="text-sm text-zinc-600">Durante a pausa você não paga nada e o plano não é usado. Os dias que você já pagou ficam guardados para depois.</p>
              <div className="flex flex-wrap gap-2">
                {o.opcoesDias.map((d) => (
                  <button key={d} className={dias === d ? "btn-primario" : "btn"} onClick={() => setDias(d)}>{d} dias</button>
                ))}
              </div>
              {dias && <p className="text-xs text-zinc-500">Volta sozinho em {somarDias(dias)}.</p>}
              <button className="btn-primario w-full py-3" disabled={enviando || !dias} onClick={() => decidir("pausa")}>Pausar por {dias} dias</button>
            </>
          )}
          {o.tipo === "GERENTE" && (
            <>
              <MessageCircle className="text-ouro" size={26} />
              <p className="text-lg font-bold">Deixa a gente tentar resolver?</p>
              <p className="text-sm text-zinc-600">O gerente fala com você no WhatsApp para entender o que aconteceu. Seu plano continua valendo enquanto isso.</p>
              <button className="btn-primario w-full py-3" disabled={enviando} onClick={() => decidir("gerente")}>Falar com o gerente</button>
            </>
          )}
          <button className="w-full text-center text-xs font-semibold text-zinc-500 hover:text-zinc-900" onClick={() => setEtapa("confirmar")}>Não, quero cancelar</button>
        </section>
      )}

      {etapa === "confirmar" && previa && (
        <section className="cartao space-y-4">
          <CalendarClock className="text-zinc-500" size={26} />
          <p className="text-lg font-bold">Confirmar cancelamento</p>
          {previa.cancelamento.imediato ? (
            <p className="text-sm text-zinc-600">O plano é cancelado agora e não haverá novas cobranças.</p>
          ) : (
            <p className="text-sm text-zinc-600">
              Você já pagou o mês atual, então o plano continua valendo até <b>{dataBr(previa.cancelamento.ultimoDia)}</b>. Não haverá novas cobranças.
            </p>
          )}
          <p className="text-sm text-zinc-600">Horários marcados depois disso continuam, como avulsos (preço normal).</p>
          {previa.cancelamento.cashbarber && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Sua cobrança ainda é feita pelo sistema antigo: a equipe confirma o cancelamento por lá e te avisa.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href="/c/planos" className="btn-primario">Voltar, quero continuar</Link>
            <button className="btn-perigo" disabled={enviando} onClick={() => decidir("cancelar")}>{enviando ? "Cancelando..." : "Confirmar cancelamento"}</button>
          </div>
        </section>
      )}

      {etapa === "feito" && (
        <section className="cartao space-y-4">
          <p className="text-sm">{resultado}</p>
          <p className="text-xs text-zinc-500">Enviamos a confirmação no seu WhatsApp.</p>
          <Link href="/c" className="btn-primario">Voltar ao início</Link>
        </section>
      )}
    </div>
  );
}
