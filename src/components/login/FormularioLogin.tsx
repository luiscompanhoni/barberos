"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ErroApi } from "@/lib/cliente-api";

type Props = { area: "equipe" | "cliente"; titulo: string; subtitulo: string; destinoPadrao: string };

function Formulario({ area, titulo, subtitulo, destinoPadrao }: Props) {
  const router = useRouter();
  const voltar = useSearchParams().get("voltar") ?? destinoPadrao;
  const [etapa, setEtapa] = useState<"telefone" | "codigo">("telefone");
  const [telefone, setTelefone] = useState("");
  const [codigo, setCodigo] = useState("");
  const [codigoTeste, setCodigoTeste] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function pedirCodigo(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (telefone.replace(/\D/g, "").length < 10) return setErro("Digite o celular com DDD.");
    setEnviando(true);
    try {
      const r = await api<{ codigoTeste?: string }>("/api/auth/codigo", { method: "POST", body: { telefone, area } });
      setCodigoTeste(r.codigoTeste ?? "");
      setEtapa("codigo");
    } catch (e) {
      // Codigo pedido ha menos de 1 min: ele ainda vale, entao segue para digitar.
      if (e instanceof ErroApi && e.codigo === "aguarde") {
        setEtapa("codigo");
        setErro("Já enviamos um código há pouco. Use o último que chegou.");
        return;
      }
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!/^\d{6}$/.test(codigo)) return setErro("O código tem 6 digitos.");
    setEnviando(true);
    try {
      await api("/api/auth/entrar", { method: "POST", body: { telefone, codigo, area } });
      router.replace(voltar.startsWith("/") && !voltar.startsWith("//") ? voltar : destinoPadrao);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="cartao w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">{titulo}</h1>
        <p className="mb-5 text-sm text-zinc-500">{subtitulo}</p>

        {etapa === "telefone" ? (
          <form onSubmit={pedirCodigo} className="space-y-3">
            <div>
              <label className="rotulo" htmlFor="tel">Celular</label>
              <input id="tel" className="campo" inputMode="tel" autoFocus placeholder="(11) 99999-8888"
                value={telefone} onChange={(e) => { setTelefone(e.target.value); setErro(""); }} />
            </div>
            <button className="btn-primario w-full py-2" disabled={enviando}>
              {enviando ? "Enviando..." : "Receber código no WhatsApp"}
            </button>
          </form>
        ) : (
          <form onSubmit={entrar} className="space-y-3">
            <p className="text-sm text-zinc-600">Enviamos um código de 6 digitos para <b>{telefone}</b>.</p>
            {codigoTeste && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span>
                  Modo de teste: seu código é <b className="font-mono text-base tracking-widest">{codigoTeste}</b>
                </span>
                <button type="button" className="btn" onClick={() => { setCodigo(codigoTeste); setErro(""); }}>Usar</button>
              </div>
            )}
            <div>
              <label className="rotulo" htmlFor="cod">Código</label>
              <input id="cod" className="campo text-center font-mono text-lg tracking-[0.4em]" inputMode="numeric"
                autoComplete="one-time-code" maxLength={6} autoFocus value={codigo}
                onChange={(e) => { setCodigo(e.target.value.replace(/\D/g, "")); setErro(""); }} />
            </div>
            <button className="btn-primario w-full py-2" disabled={enviando}>{enviando ? "Entrando..." : "Entrar"}</button>
            <button type="button" className="w-full text-sm text-zinc-500 underline" onClick={() => { setEtapa("telefone"); setCodigo(""); setCodigoTeste(""); }}>
              Trocar número
            </button>
          </form>
        )}
        {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
      </div>
    </main>
  );
}

/** Login por celular + codigo, usado pela equipe (/entrar) e pelos clientes (/c/entrar). */
export function FormularioLogin(props: Props) {
  return (
    <Suspense>
      <Formulario {...props} />
    </Suspense>
  );
}
