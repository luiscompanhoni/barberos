"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { rotuloEntrevista, type AcaoEntrevista } from "@/lib/recrutamento/entrevistas-regras";
type Vista = { selecaoEncerrada: boolean; podeCancelar: boolean; estado: string; versao: number; local: string; duracaoMin: number; inicio: string | null; propostaInicio: string | null; propostaExpiraEm: string | null; horarios: string[] };
const lerHash = () => window.location.hash.slice(1);
const assinarHash = (fn: () => void) => { window.addEventListener("hashchange", fn); return () => window.removeEventListener("hashchange", fn); };
export function ConfirmarEntrevista() {
  const token = useSyncExternalStore(assinarHash, lerHash, () => "");
  return <ConviteEntrevista key={token} token={token} />;
}
function ConviteEntrevista({ token }: { token: string }) {
  const [vista, setVista] = useState<Vista | null>(null); const [erro, setErro] = useState(""); const [ocupado, setOcupado] = useState(true);
  async function pedir(t: string, pedido: AcaoEntrevista) {
    setOcupado(true); setErro("");
    try { const r = await fetch("/api/recrutamento/entrevistas/confirmacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t, pedido }), cache: "no-store", referrerPolicy: "no-referrer" }); const b = await r.json(); if (!r.ok) {
        if (r.status === 409 && pedido.acao !== "CONSULTAR") {
          const atual = await fetch("/api/recrutamento/entrevistas/confirmacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t, pedido: { acao: "CONSULTAR" } }), cache: "no-store", referrerPolicy: "no-referrer" });
          if (atual.ok) setVista(await atual.json());
        }
        throw Error(b.erro ?? "Não foi possível consultar a entrevista.");
      } setVista(b); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const controlador = new AbortController();
    fetch("/api/recrutamento/entrevistas/confirmacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, pedido: { acao: "CONSULTAR" } }), cache: "no-store", referrerPolicy: "no-referrer", signal: controlador.signal })
      .then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.erro ?? "Convite indisponível."); return b; })
      .then(b => { setVista(b); setOcupado(false); })
      .catch(e => { if (!controlador.signal.aborted) { setErro((e as Error).message); setOcupado(false); } });
    return () => controlador.abort();
  }, [token]);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return <main className="crm-public-card mx-auto my-8 w-full max-w-2xl space-y-4 p-8"><h1 className="titulo-marca text-3xl">Entrevista presencial</h1><p role="alert">Use o link privado fornecido pela Black para consultar seu convite.</p></main>;

  const proposta = vista?.estado === "AGUARDA_CONFIRMACAO" && vista.propostaInicio;
  return <main className="mx-auto w-full max-w-2xl px-4 py-8 space-y-5 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-4 [&_button]:focus-visible:outline-ouro"><header><p className="eyebrow">Black Barber</p><h1 className="titulo-marca text-3xl">Sua entrevista presencial</h1></header>
    <section className="cartao space-y-3"><p>Olá! Vou ajudar você a escolher e confirmar sua entrevista com o dono da Black.</p><p>Segundas-feiras, das 14h às 16h, no horário de São Paulo. A escolha só vira reserva após sua confirmação e a conferência de disponibilidade.</p><p className="text-sm text-zinc-500">Não compartilhe este link. A entrevista não garante contratação.</p></section>
    {erro && <p className="cartao text-red-500" role="alert">{erro}</p>}{ocupado && <p role="status">Conferindo a agenda…</p>}
    {!vista && !ocupado && <button className="btn" onClick={() => pedir(token, { acao: "CONSULTAR" })}>Tentar consultar novamente</button>}
    {vista && <section className="cartao space-y-4"><p className="font-semibold">Local: {vista.local}</p><p>Duração: {vista.duracaoMin} minutos.</p>
      {vista.estado === "CONFIRMADA" && vista.inicio ? <div role="status"><h2 className="text-xl text-ouro">Entrevista confirmada</h2><p>{rotuloEntrevista(vista.inicio, vista.duracaoMin)}</p><p>Esperamos você no endereço acima.</p></div> : vista.estado === "CANCELADA" ? <p role="status">Entrevista cancelada. Para outro convite, fale com a Black.</p> : vista.selecaoEncerrada ? <p role="status">Esta seleção foi encerrada. Entre em contato com a Black.</p> : <>
        {proposta && <section className="rounded-xl border border-ouro/40 p-4 space-y-3"><h2 className="font-semibold">Confira sua escolha</h2><p>{rotuloEntrevista(proposta, vista.duracaoMin)}</p><p>Presencial em {vista.local}. A escolha vale por até 10 minutos e ainda não reserva o horário.</p><button className="btn-primario w-full" disabled={ocupado} onClick={() => pedir(token, { acao: "CONFIRMAR", versao: vista.versao })}>Confirmar entrevista presencial</button></section>}
        <h2 className="text-xl">{proposta ? "Ou escolha outro horário" : "Escolha um horário"}</h2>
        {!vista.horarios.length && <p>Não há opções nas próximas quatro semanas. Fale com a Black.</p>}
        <div className="grid gap-2">{vista.horarios.map(inicio => <button className="btn text-left" disabled={ocupado} key={inicio} onClick={() => pedir(token, { acao: "ESCOLHER", inicio, versao: vista.versao })}>{rotuloEntrevista(inicio, vista.duracaoMin)}</button>)}</div>
      </>}
      <div className="flex flex-wrap gap-2"><button className="btn" disabled={ocupado} onClick={() => pedir(token, { acao: "CONSULTAR" })}>Atualizar disponibilidade</button>{vista.podeCancelar && <button className="btn-perigo" disabled={ocupado} onClick={() => { if (confirm("Cancelar seu convite ou entrevista com a Black?")) void pedir(token, { acao: "CANCELAR", versao: vista.versao }); }}>Cancelar minha entrevista</button>}</div>
    </section>}
  </main>;
}
