"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Smartphone } from "lucide-react";
import { api, ErroApi } from "@/lib/cliente-api";
import { Marca } from "@/components/Marca";

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
    if (!/^\d{6}$/.test(codigo)) return setErro("O código tem 6 dígitos.");
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

  const frase = area === "cliente" ? ["Seu horário.", "Na sua mão."] : ["Sua agenda.", "Em ordem."];

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="entrar-suave w-full max-w-md">
        <Marca nome={titulo} tamanho="lg" />
        <div className="mt-12">
          <p className="eyebrow">{subtitulo}</p>
          <h1 className="titulo-marca mt-4 text-4xl leading-[0.95] sm:text-5xl">
            {frase[0]}
            <br />
            <span className="text-ouro">{frase[1]}</span>
          </h1>
          <p className="mt-4 text-sm leading-6 text-zinc-500">
            {etapa === "telefone" ? (
              "Informe seu celular para receber um código de acesso no WhatsApp."
            ) : (
              <>Enviamos um código de 6 dígitos para <b className="text-zinc-900">{telefone}</b>.</>
            )}
          </p>
        </div>

        {etapa === "telefone" ? (
          <form onSubmit={pedirCodigo} className="mt-10">
            <label className="rotulo" htmlFor="tel">Celular</label>
            <div className="relative">
              <Smartphone className="absolute top-3 left-0 text-zinc-500" size={18} />
              <input id="tel" className="campo-linha pl-7 text-lg" inputMode="tel" autoFocus placeholder="(11) 99999-8888"
                value={telefone} onChange={(e) => { setTelefone(e.target.value); setErro(""); }} />
            </div>
            <button className="btn-primario mt-8 w-full py-3" disabled={enviando}>
              {enviando ? "Enviando..." : <>Receber código <ArrowRight size={16} /></>}
            </button>
          </form>
        ) : (
          <form onSubmit={entrar} className="mt-10">
            {codigoTeste && (
              <div className="mb-5 flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span>
                  Modo de teste: código <b className="font-mono text-base tracking-widest">{codigoTeste}</b>
                </span>
                <button type="button" className="btn" onClick={() => { setCodigo(codigoTeste); setErro(""); }}>Usar</button>
              </div>
            )}
            <CaixasCodigo valor={codigo} onChange={(v) => { setCodigo(v); setErro(""); }} />
            <button className="btn-primario mt-8 w-full py-3" disabled={enviando}>
              {enviando ? "Entrando..." : <>Entrar <ArrowRight size={16} /></>}
            </button>
            <button type="button" className="mt-6 flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-zinc-900"
              onClick={() => { setEtapa("telefone"); setCodigo(""); setCodigoTeste(""); }}>
              <ArrowLeft size={15} /> Corrigir celular
            </button>
          </form>
        )}
        {erro && <p className="mt-4 text-sm text-red-600">{erro}</p>}
        {area === "cliente" && etapa === "telefone" && (
          <Link href="/assine" className="mt-10 flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-zinc-900">
            Ainda não é assinante? <span className="text-ouro">Conheça os planos</span> <ArrowRight size={14} className="text-ouro" />
          </Link>
        )}
      </div>
    </main>
  );
}

/** Codigo em 6 caixas separadas; aceita colar o codigo inteiro e apagar voltando de caixa. */
function CaixasCodigo({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digitos = Array.from({ length: 6 }, (_, i) => valor[i] ?? "");

  function digitar(i: number, texto: string) {
    const novos = texto.replace(/\D/g, "");
    if (!novos) return;
    const v = (valor.slice(0, i) + novos).slice(0, 6);
    onChange(v);
    refs.current[Math.min(v.length, 5)]?.focus();
  }

  return (
    <div className="grid grid-cols-6 gap-2">
      {digitos.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          aria-label={`Dígito ${i + 1}`}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={i === 0}
          value={d}
          onChange={(e) => digitar(Math.min(i, valor.length), e.target.value.slice(-1))}
          onPaste={(e) => { e.preventDefault(); digitar(0, e.clipboardData.getData("text")); }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              const pos = d ? i : Math.max(i - 1, 0);
              onChange(valor.slice(0, pos));
              refs.current[pos]?.focus();
            }
          }}
          className="h-14 min-w-0 rounded-xl border border-zinc-300 bg-white text-center text-xl font-bold text-zinc-900 outline-none focus:border-ouro focus:ring-2 focus:ring-ouro/25"
        />
      ))}
    </div>
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
