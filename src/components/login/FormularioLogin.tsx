"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Smartphone, UserRound } from "lucide-react";
import { api, ErroApi } from "@/lib/cliente-api";
import { Marca } from "@/components/Marca";

type Props = {
  area: "equipe" | "cliente";
  titulo: string;
  subtitulo: string;
  destinoPadrao: string;
  /** O codigo consegue chegar ate a pessoa (WhatsApp ligado ou teste local)? */
  codigoDisponivel: boolean;
};
type Modo = "senha" | "cadastro" | "codigo-tel" | "codigo";
type RespostaLogin = { definirSenha?: boolean; precisaNome?: boolean };

function Formulario({ area, titulo, subtitulo, destinoPadrao, codigoDisponivel }: Props) {
  const router = useRouter();
  const busca = useSearchParams();
  const voltar = busca.get("voltar") ?? destinoPadrao;
  const contaExcluida = area === "cliente" && busca.get("excluida") === "1";
  const [modo, setModo] = useState<Modo>("senha");
  const [identificador, setIdentificador] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [aceite, setAceite] = useState(false);
  const [verSenha, setVerSenha] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [codigoTeste, setCodigoTeste] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const trocar = (m: Modo) => { setModo(m); setErro(""); setCodigo(""); setCodigoTeste(""); };

  /** Depois de entrar: cria a senha (quem entrou por codigo ou com senha temporaria) ou segue. */
  function seguir(r: RespostaLogin) {
    const destino = voltar.startsWith("/") && !voltar.startsWith("//") ? voltar : destinoPadrao;
    router.replace(r.definirSenha ? (area === "cliente" ? "/c/perfil#senha" : "/conta") : destino);
    router.refresh();
  }

  async function executar(fn: () => Promise<void>) {
    setErro("");
    setEnviando(true);
    try {
      await fn();
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    }
  }

  const entrar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identificador.trim() || !senha) return setErro(area === "cliente" ? "Digite o celular e a senha." : "Digite o celular (ou usuário) e a senha.");
    executar(async () => seguir(await api<RespostaLogin>("/api/auth/senha", { method: "POST", body: { identificador, senha, area } })));
  };

  const cadastrar = (e: React.FormEvent) => {
    e.preventDefault();
    if (nome.trim().length < 2) return setErro("Digite seu nome.");
    if (identificador.replace(/\D/g, "").length < 10) return setErro("Digite o celular com DDD.");
    if (senha.length < 8) return setErro("A senha precisa de pelo menos 8 caracteres.");
    if (!aceite) return setErro("Aceite os Termos de uso e a Política de privacidade para criar a conta.");
    executar(async () => {
      try {
        seguir(await api<RespostaLogin>("/api/auth/cadastro", { method: "POST", body: { nome, telefone: identificador, senha, aceiteTermos: true } }));
      } catch (e) {
        if (e instanceof ErroApi && e.codigo === "ja_tem_conta") { setModo("senha"); setSenha(""); }
        throw e;
      }
    });
  };

  const pedirCodigo = (e: React.FormEvent) => {
    e.preventDefault();
    if (identificador.replace(/\D/g, "").length < 10) return setErro("Digite o celular com DDD.");
    executar(async () => {
      try {
        const r = await api<{ codigoTeste?: string }>("/api/auth/codigo", { method: "POST", body: { telefone: identificador, area } });
        setCodigoTeste(r.codigoTeste ?? "");
        setModo("codigo");
      } catch (e) {
        // Codigo pedido ha menos de 1 min: ele ainda vale, entao segue para digitar.
        if (e instanceof ErroApi && e.codigo === "aguarde") { setModo("codigo"); throw new Error("Já enviamos um código há pouco. Use o último que chegou."); }
        throw e;
      }
      setEnviando(false);
    });
  };

  const entrarComCodigo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(codigo)) return setErro("O código tem 6 dígitos.");
    executar(async () => seguir(await api<RespostaLogin>("/api/auth/entrar", { method: "POST", body: { telefone: identificador, codigo, area } })));
  };

  const frase = modo === "cadastro" ? ["Crie sua", "conta."] : area === "cliente" ? ["Seu horário.", "Na sua mão."] : ["Sua agenda.", "Em ordem."];
  const campoSenha = (
    <div>
      <label className="rotulo" htmlFor="senha">Senha</label>
      <div className="relative">
        <KeyRound className="absolute top-3 left-0 text-zinc-500" size={18} />
        <input id="senha" type={verSenha ? "text" : "password"} className="campo-linha pr-9 pl-7 text-lg"
          autoComplete={modo === "cadastro" ? "new-password" : "current-password"} placeholder={modo === "cadastro" ? "mínimo 8 caracteres" : ""}
          value={senha} onChange={(e) => { setSenha(e.target.value); setErro(""); }} />
        <button type="button" className="absolute top-2.5 right-0 p-1 text-zinc-500" aria-label={verSenha ? "Esconder senha" : "Mostrar senha"} onClick={() => setVerSenha(!verSenha)}>
          {verSenha ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </div>
  );
  const campoCelular = (rotulo: string, autoFoco = true) => (
    <div>
      <label className="rotulo" htmlFor="tel">{rotulo}</label>
      <div className="relative">
        {area === "equipe" && modo === "senha" ? <UserRound className="absolute top-3 left-0 text-zinc-500" size={18} /> : <Smartphone className="absolute top-3 left-0 text-zinc-500" size={18} />}
        <input id="tel" className="campo-linha pl-7 text-lg" inputMode={area === "equipe" && modo === "senha" ? "text" : "tel"} autoFocus={autoFoco}
          autoComplete="username" placeholder={area === "equipe" && modo === "senha" ? "(11) 99999-8888 ou usuário" : "(11) 99999-8888"}
          value={identificador} onChange={(e) => { setIdentificador(e.target.value); setErro(""); }} />
      </div>
    </div>
  );

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
        </div>

        {modo === "senha" && (
          <form onSubmit={entrar} className="mt-10 space-y-6">
            {campoCelular(area === "cliente" ? "Celular" : "Celular ou usuário")}
            {campoSenha}
            <button className="btn-primario w-full py-3" disabled={enviando}>{enviando ? "Entrando..." : <>Entrar <ArrowRight size={16} /></>}</button>
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              {area === "cliente" && <button type="button" className="font-semibold text-ouro" onClick={() => trocar("cadastro")}>Criar conta</button>}
              {(codigoDisponivel || area === "equipe") ? (
                <button type="button" className="text-zinc-500 hover:text-zinc-900" onClick={() => trocar("codigo-tel")}>Primeiro acesso ou esqueci a senha</button>
              ) : (
                <span className="text-zinc-500">Esqueceu a senha? Fale com a recepção.</span>
              )}
            </div>
          </form>
        )}

        {modo === "cadastro" && (
          <form onSubmit={cadastrar} className="mt-10 space-y-6">
            <div>
              <label className="rotulo" htmlFor="nome">Seu nome</label>
              <input id="nome" className="campo-linha text-lg" autoFocus autoComplete="name" value={nome} onChange={(e) => { setNome(e.target.value); setErro(""); }} />
            </div>
            {campoCelular("Celular", false)}
            {campoSenha}
            <label className="flex items-start gap-3 text-sm leading-6 text-zinc-600">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-ouro" checked={aceite} onChange={(e) => { setAceite(e.target.checked); setErro(""); }} />
              <span>Li e aceito os <Link href="/termos" target="_blank" className="font-semibold text-ouro underline">Termos de uso</Link> e a <Link href="/privacidade" target="_blank" className="font-semibold text-ouro underline">Política de privacidade</Link>.</span>
            </label>
            <button className="btn-primario w-full py-3" disabled={enviando}>{enviando ? "Criando..." : <>Criar conta e entrar <ArrowRight size={16} /></>}</button>
            <button type="button" className="flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-zinc-900" onClick={() => trocar("senha")}>
              <ArrowLeft size={15} /> Já tenho conta
            </button>
          </form>
        )}

        {modo === "codigo-tel" && (
          <form onSubmit={pedirCodigo} className="mt-10 space-y-6">
            <p className="text-sm leading-6 text-zinc-500">
              {area === "equipe" && !codigoDisponivel
                ? "Enviamos um código de acesso. Enquanto o WhatsApp oficial não está ligado, peça o código ao dono (ele aparece no servidor)."
                : "Enviamos um código no seu WhatsApp. Depois de entrar, você cria uma senha nova."}
            </p>
            {campoCelular("Celular")}
            <button className="btn-primario w-full py-3" disabled={enviando}>{enviando ? "Enviando..." : <>Receber código <ArrowRight size={16} /></>}</button>
            <button type="button" className="flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-zinc-900" onClick={() => trocar("senha")}>
              <ArrowLeft size={15} /> Entrar com senha
            </button>
          </form>
        )}

        {modo === "codigo" && (
          <form onSubmit={entrarComCodigo} className="mt-10">
            <p className="mb-5 text-sm text-zinc-500">Código de 6 dígitos para <b className="text-zinc-900">{identificador}</b>.</p>
            {codigoTeste && (
              <div className="mb-5 flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span>Modo de teste: código <b className="font-mono text-base tracking-widest">{codigoTeste}</b></span>
                <button type="button" className="btn" onClick={() => { setCodigo(codigoTeste); setErro(""); }}>Usar</button>
              </div>
            )}
            <CaixasCodigo valor={codigo} onChange={(v) => { setCodigo(v); setErro(""); }} />
            <button className="btn-primario mt-8 w-full py-3" disabled={enviando}>{enviando ? "Entrando..." : <>Entrar <ArrowRight size={16} /></>}</button>
            <button type="button" className="mt-6 flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-zinc-900" onClick={() => trocar("codigo-tel")}>
              <ArrowLeft size={15} /> Corrigir celular
            </button>
          </form>
        )}

        {contaExcluida && <p role="status" className="mt-4 text-sm text-emerald-700">Sua conta foi excluída e seus dados pessoais foram apagados.</p>}
        {erro && <p className="mt-4 text-sm text-red-600">{erro}</p>}
        {area === "cliente" && modo === "senha" && (
          <Link href="/assine" className="mt-10 flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-zinc-900">
            Ainda não é assinante? <span className="text-ouro">Conheça os planos</span> <ArrowRight size={14} className="text-ouro" />
          </Link>
        )}
        {area === "cliente" && (
          <p className="mt-8 flex gap-4 text-xs text-zinc-500">
            <Link href="/privacidade" className="underline hover:text-zinc-900">Política de privacidade</Link>
            <Link href="/termos" className="underline hover:text-zinc-900">Termos de uso</Link>
          </p>
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

/** Login por celular (ou usuario) + senha, usado pela equipe (/entrar) e pelos clientes (/c/entrar). */
export function FormularioLogin(props: Props) {
  return (
    <Suspense>
      <Formulario {...props} />
    </Suspense>
  );
}
