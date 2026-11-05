"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/cliente-api";

/** O estado do envio é isolado por telefone (key no formulário pai). */
export function CodigoCadastro({ telefone, codigo, mudar, disponivel, ocupado }: {
  telefone: string; codigo: string; mudar: (codigo: string) => void; disponivel: boolean; ocupado: boolean;
}) {
  const [enviado, setEnviado] = useState(false), [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(""), [teste, setTeste] = useState("");
  const trava = useRef(false);
  async function pedir() {
    if (trava.current) return;
    trava.current = true; setEnviando(true); setErro("");
    try {
      const r = await api<{ codigoTeste?: string }>("/api/auth/cadastro/codigo", { method: "POST", body: { telefone } });
      setEnviado(true); setTeste(r.codigoTeste ?? "");
    } catch (e) { setErro((e as Error).message); }
    finally { trava.current = false; setEnviando(false); }
  }
  return <div className="space-y-3 rounded-xl border border-ouro/30 p-4">
    <p className="text-sm text-zinc-500">Confirme seu celular para proteger seu cadastro.</p>
    {disponivel ? <>
      <button type="button" className="btn w-full" disabled={ocupado || enviando || telefone.replace(/\D/g, "").length < 10} onClick={pedir}>
        {enviando ? "Enviando..." : enviado ? "Reenviar código" : "Receber código no WhatsApp"}
      </button>
      {enviado && <p role="status" className="text-sm text-zinc-500">Digite o último código enviado para {telefone}.</p>}
      {teste && <p className="text-sm text-ouro">Modo de teste: <b>{teste}</b> <button type="button" className="underline" onClick={() => mudar(teste)}>Usar código</button></p>}
      <label className="rotulo" htmlFor="codigo-cadastro">Código de confirmação</label>
      <input id="codigo-cadastro" className="campo-linha" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={codigo} onChange={(e) => mudar(e.target.value.replace(/\D/g, "").slice(0, 6))} />
    </> : <p role="status" className="text-sm text-amber-600">A confirmação pelo celular ainda não está disponível. Fale com a recepção para criar seu acesso.</p>}
    {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
  </div>;
}
