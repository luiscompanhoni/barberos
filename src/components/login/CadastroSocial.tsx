"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/cliente-api";
import { CADASTRO_VAZIO, CamposCadastroCompleto, type DadosCadastroForm } from "@/components/cliente/CamposCadastroCompleto";

export function CadastroSocial({ entrarComSenha, voltarAoLogin, codigoDisponivel }: { entrarComSenha: () => void; voltarAoLogin: () => void; codigoDisponivel: boolean }) {
  const router = useRouter();
  const [f, setF] = useState<DadosCadastroForm>(CADASTRO_VAZIO), [aceite, setAceite] = useState(false);
  const [codigo, setCodigo] = useState(""), [telefoneEnviado, setTelefoneEnviado] = useState(""), [codigoTeste, setCodigoTeste] = useState("");
  const [carregando, setCarregando] = useState(true), [pendente, setPendente] = useState(false), [ocupado, setOcupado] = useState(false), [erro, setErro] = useState("");
  const trava = useRef(false);
  useEffect(() => {
    let ativo = true;
    api<{ pendente: boolean; nome?: string; email?: string }>("/api/auth/social/concluir").then((r) => {
      if (!ativo) return; setPendente(r.pendente);
      setF((f) => ({ ...f, nome: r.nome ?? "", email: r.email ?? "" }));
    }).catch((e) => { if (ativo) setErro(e.message); }).finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []);
  function mudar(k: keyof DadosCadastroForm, v: string) { setF((f) => ({ ...f, [k]: v })); if (k === "telefone") { setCodigo(""); setTelefoneEnviado(""); setCodigoTeste(""); } }
  async function pedir() {
    if (trava.current) return; trava.current = true; setOcupado(true); setErro("");
    try {
      const r = await api<{ codigoTeste?: string }>("/api/auth/social/codigo", { method: "POST", body: { telefone: f.telefone } });
      setTelefoneEnviado(f.telefone); setCodigoTeste(r.codigoTeste ?? "");
    } catch (e) { setErro((e as Error).message); } finally { trava.current = false; setOcupado(false); }
  }
  async function concluir(e: React.FormEvent) {
    e.preventDefault(); if (trava.current) return;
    if (!aceite || !codigo || telefoneEnviado !== f.telefone) { setErro("Aceite os termos e confirme seu celular com o código recebido."); return; }
    trava.current = true; setOcupado(true); setErro("");
    try {
      const r = await api<{ destino: string }>("/api/auth/social/concluir", { method: "POST", body: { ...f, codigo, aceiteTermos: true } });
      router.replace(r.destino); router.refresh();
    } catch (e) { setErro((e as Error).message); } finally { trava.current = false; setOcupado(false); }
  }
  return <div className="space-y-5">
    <p className="eyebrow">Último passo</p><h1 className="titulo-marca text-3xl">Complete seu cadastro</h1>
    <p className="text-sm text-zinc-500">Confirme seu celular para recuperar seu histórico ou criar sua conta. Não será necessário criar outra senha.</p>
    {carregando ? <p role="status">Carregando…</p> : !pendente ? <p role="alert">Esse acesso expirou. Volte ao login e tente novamente.</p> : codigoDisponivel ?
      <form className="space-y-4" onSubmit={concluir}>
        <CamposCadastroCompleto valor={f} mudar={mudar} />
        <p className="text-xs text-zinc-500">A foto é opcional e pode ser adicionada após concluir.</p>
        <button type="button" className="btn w-full" disabled={ocupado || !f.telefone} onClick={() => void pedir()}>{telefoneEnviado ? "Reenviar código" : "Confirmar celular por código"}</button>
        {telefoneEnviado && <div><label htmlFor="social-codigo" className="rotulo">Código recebido no WhatsApp</label>
          <input id="social-codigo" className="campo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} />
          {codigoTeste && <p className="mt-2 text-xs text-amber-700">Teste local: código {codigoTeste}</p>}</div>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
          <span>Li e aceito os <Link href="/termos" target="_blank" className="underline">Termos de uso</Link> e a <Link href="/privacidade" target="_blank" className="underline">Política de privacidade</Link>.</span></label>
        <button className="btn-primario w-full" disabled={ocupado || !telefoneEnviado}>{ocupado ? "Aguarde…" : "Confirmar e entrar"}</button>
      </form> : <p className="text-sm">A confirmação por celular está indisponível. Se já tem conta, entre com sua senha para conectar este acesso no perfil.</p>}
    {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
    <button type="button" className="btn w-full" disabled={ocupado} onClick={entrarComSenha}>Já tenho conta: entrar com senha</button>
    <button type="button" className="block w-full text-center text-sm underline" disabled={ocupado} onClick={voltarAoLogin}>Voltar ao login</button>
  </div>;
}
