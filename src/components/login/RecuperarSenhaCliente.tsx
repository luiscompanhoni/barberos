"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/cliente-api";

export function RecuperarSenhaCliente({ voltar, concluir }: { voltar: () => void; concluir: () => void }) {
  const [telefone, setTelefone] = useState("");
  const [codigo, setCodigo] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [codigoTeste, setCodigoTeste] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const trava = useRef(false);

  async function executar(fn: () => Promise<void>) {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErro("");
    try { await fn(); } catch (e) { setErro((e as Error).message); }
    finally { trava.current = false; setOcupado(false); }
  }
  return <section>
    <h1 className="titulo-marca text-3xl">Recuperar senha</h1>
    <p className="mt-3 text-sm text-zinc-500">Confirme seu celular e escolha uma nova senha. Suas outras sessões serão encerradas.</p>
    <form className="mt-6 space-y-5" onSubmit={(e) => { e.preventDefault(); void executar(async () => {
      if (!enviado) {
        const r = await api<{ codigoTeste?: string }>("/api/auth/recuperar-senha", { method: "POST", body: { acao: "codigo", telefone } });
        setCodigoTeste(r.codigoTeste ?? ""); setEnviado(true); return;
      }
      if (senha !== confirmacao) throw new Error("As senhas precisam ser iguais.");
      await api("/api/auth/recuperar-senha", { method: "POST", body: { acao: "redefinir", telefone, codigo, senha } });
      concluir();
    }); }}>
      <div><label className="rotulo" htmlFor="recuperar-tel">Celular com DDD</label>
        <input id="recuperar-tel" className="campo-linha" autoComplete="tel" inputMode="tel" required disabled={ocupado} value={telefone}
          onChange={(e) => { setTelefone(e.target.value); setEnviado(false); setCodigo(""); setCodigoTeste(""); setErro(""); }} /></div>
      {enviado && <>
        <p role="status" className="text-sm text-zinc-500">Se este celular tiver uma conta, o código foi enviado. Use o último código de recuperação recebido.</p>
        {codigoTeste && <p className="text-sm text-amber-600">Modo de teste: código <b>{codigoTeste}</b></p>}
        <div><label className="rotulo" htmlFor="recuperar-codigo">Código de 6 dígitos</label><input id="recuperar-codigo" className="campo-linha" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="[0-9]{6}" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} /></div>
        <div><label className="rotulo" htmlFor="recuperar-senha">Nova senha</label><input id="recuperar-senha" className="campo-linha" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={senha} onChange={(e) => setSenha(e.target.value)} /></div>
        <div><label className="rotulo" htmlFor="recuperar-confirmacao">Confirmar nova senha</label><input id="recuperar-confirmacao" className="campo-linha" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} /></div>
      </>}
      {erro && <p role="alert" className="text-sm text-red-500">{erro}</p>}
      <button className="btn-primario w-full" disabled={ocupado}>{ocupado ? "Aguarde..." : enviado ? "Salvar nova senha e entrar" : "Receber código de recuperação"}</button>
      {enviado && <button type="button" className="btn w-full" disabled={ocupado} onClick={() => { setEnviado(false); setCodigo(""); setCodigoTeste(""); }}>Pedir outro código</button>}
      <button type="button" className="btn w-full" disabled={ocupado} onClick={voltar}>Voltar para o login</button>
    </form>
  </section>;
}
