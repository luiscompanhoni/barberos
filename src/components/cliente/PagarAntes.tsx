"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, CreditCard, ExternalLink, Loader2, QrCode, RefreshCw } from "lucide-react";
import { api, ErroApi, reais } from "@/lib/cliente-api";

type Pagamento = { status: string; forma: "PIX" | "CARTAO"; valorCentavos: number; link: string | null; pixCopiaECola: string | null; pixQrUrl: string | null };

/**
 * Pagar um horario avulso antes de vir. Com checkout do BarberOS (Pagar.me) leva para a
 * pagina /c/pagar-horario/...; senao (Celcash) gera o Pix / abre o link do meio de pagamento aqui.
 */
export function PagarAntes({ agendamentoId, precoCentavos, status, checkout, aoPagar }: {
  agendamentoId: string; precoCentavos: number; status: string | null; checkout?: boolean; aoPagar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [pg, setPg] = useState<Pagamento | null>(null);
  const [pedir, setPedir] = useState<{ cpf: boolean; email: boolean }>({ cpf: false, email: false });
  const [dados, setDados] = useState({ cpf: "", email: "" });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);

  if (status === "PAGO") return <span className="selo-ouro mt-3"><Check size={11} /> Pago antes</span>;
  if (checkout) {
    return (
      <Link className="btn mt-3 w-full text-ouro" href={`/c/pagar-horario/${agendamentoId}`}>
        <CreditCard size={15} /> {status === "PENDENTE" ? "Continuar pagamento" : `Pagar agora · ${reais(precoCentavos)}`}
      </Link>
    );
  }

  async function gerar(forma: "PIX" | "CARTAO") {
    setErro("");
    setOcupado(true);
    try {
      const r = await api<{ pagamento: Pagamento }>(`/api/cliente/agendamentos/${agendamentoId}/pagar`, {
        method: "POST",
        body: { forma, ...(dados.cpf ? { cpf: dados.cpf } : {}), ...(dados.email ? { email: dados.email } : {}) },
      });
      setPg(r.pagamento);
      if (r.pagamento.forma === "CARTAO" && r.pagamento.link) window.open(r.pagamento.link, "_blank", "noopener");
    } catch (e) {
      const c = e instanceof ErroApi ? e.codigo : undefined;
      if (c === "cpf" || c === "email") setPedir((p) => ({ ...p, [c]: true }));
      if (c === "ja_pago") aoPagar();
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function conferir() {
    setOcupado(true);
    setErro("");
    try {
      const r = await api<{ pagamento: Pagamento | null }>(`/api/cliente/agendamentos/${agendamentoId}/pagar`);
      if (r.pagamento?.status === "PAGO") return aoPagar();
      setErro("Ainda não recebemos. Se já pagou, pode levar alguns minutos.");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function copiar() {
    if (!pg?.pixCopiaECola) return;
    await navigator.clipboard.writeText(pg.pixCopiaECola).catch(() => {});
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  if (!aberto) {
    return (
      <button className="btn mt-3 w-full text-ouro" onClick={() => setAberto(true)}>
        <QrCode size={15} /> {status === "PENDENTE" ? "Continuar pagamento" : `Pagar agora · ${reais(precoCentavos)}`}
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl bg-zinc-50 p-3 text-sm">
      {!pg && (
        <>
          <p className="text-zinc-600">Pague agora e chegue sem precisar passar no caixa. Se cancelar o horário, o valor fica como saldo.</p>
          {pedir.cpf && <input className="campo" inputMode="numeric" placeholder="Seu CPF" value={dados.cpf} onChange={(e) => setDados({ ...dados, cpf: e.target.value })} />}
          {pedir.email && <input className="campo" type="email" placeholder="Seu e-mail" value={dados.email} onChange={(e) => setDados({ ...dados, email: e.target.value })} />}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primario" disabled={ocupado} onClick={() => gerar("PIX")}>{ocupado ? <Loader2 className="animate-spin" size={15} /> : <QrCode size={15} />} Pix</button>
            <button className="btn" disabled={ocupado} onClick={() => gerar("CARTAO")}><CreditCard size={15} /> Cartão</button>
          </div>
        </>
      )}

      {pg?.forma === "PIX" && (
        <div className="space-y-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {pg.pixQrUrl && <img src={pg.pixQrUrl} alt="QR code do Pix" className="mx-auto w-44 rounded-lg bg-white p-2" />}
          {pg.pixCopiaECola && <button className="btn w-full" onClick={copiar}>{copiado ? <Check size={15} /> : <Copy size={15} />} {copiado ? "Copiado!" : "Copiar código Pix"}</button>}
          {pg.link && <a className="btn w-full" href={pg.link} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Abrir página do Pix</a>}
        </div>
      )}
      {pg?.forma === "CARTAO" && pg.link && (
        <a className="btn-primario w-full" href={pg.link} target="_blank" rel="noopener noreferrer"><CreditCard size={15} /> Pagar com cartão</a>
      )}
      {pg && (
        <button className="btn w-full" disabled={ocupado} onClick={conferir}>
          {ocupado ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Já paguei
        </button>
      )}
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      <button className="w-full text-xs text-zinc-500" onClick={() => { setAberto(false); setPg(null); setErro(""); }}>Fechar</button>
    </div>
  );
}
