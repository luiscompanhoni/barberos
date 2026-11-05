"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Smartphone, UserRound } from "lucide-react";
import { api, ErroApi } from "@/lib/cliente-api";
import { destinoAposLogin } from "@/lib/auth/destino";
import { Marca } from "@/components/Marca";
import { AcessosSociais } from "./AcessosSociais";
import { CadastroSocial } from "./CadastroSocial";
import { CodigoCadastro } from "./CodigoCadastro";
import { CaixasCodigo } from "./CaixasCodigo";
import { RecuperarSenhaCliente } from "./RecuperarSenhaCliente";
import { CADASTRO_VAZIO, CamposCadastroCompleto, type DadosCadastroForm } from "@/components/cliente/CamposCadastroCompleto";

type Props = {
  area: "equipe" | "cliente";
  titulo: string;
  subtitulo: string;
  destinoPadrao: string;
  /** O codigo consegue chegar ate a pessoa (WhatsApp ligado ou teste local)? */
  codigoDisponivel: boolean;
  provedoresSociais?: { id: "google" | "facebook" | "apple"; disponivel: boolean }[];
};
type Modo = "senha" | "cadastro" | "codigo-tel" | "codigo";
type RespostaLogin = { definirSenha?: boolean; precisaNome?: boolean; completarCadastro?: boolean };

function Formulario({ area, titulo, subtitulo, destinoPadrao, codigoDisponivel, provedoresSociais = [] }: Props) {
  const router = useRouter();
  const busca = useSearchParams();
  const voltar = busca.get("voltar") ?? destinoPadrao;
  const contaExcluida = area === "cliente" && busca.get("excluida") === "1";
  const [modo, setModo] = useState<Modo>(area === "cliente" && busca.get("confirmar") === "1" ? "codigo-tel" : "senha");
  const [identificador, setIdentificador] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [aceite, setAceite] = useState(false);
  const [verSenha, setVerSenha] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [codigoTeste, setCodigoTeste] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [dadosCadastro, setDadosCadastro] = useState<DadosCadastroForm>(CADASTRO_VAZIO);
  const [socialCadastro, setSocialCadastro] = useState(area === "cliente" && busca.get("social") === "pendente");
  const [recuperando, setRecuperando] = useState(false);
  const trava = useRef(false);

  const trocar = (m: Modo) => { setModo(m); setErro(""); setCodigo(""); setCodigoTeste(""); };

  function voltarDoSocial() {
    setSocialCadastro(false); setRecuperando(false); trocar("senha");
    const destino = destinoAposLogin(voltar, destinoPadrao);
    router.replace(destino === destinoPadrao ? "/c/entrar" : `/c/entrar?voltar=${encodeURIComponent(destino)}`);
  }

  /** Depois de entrar: cria a senha (quem entrou por codigo ou com senha temporaria) ou segue. */
  function seguir(r: RespostaLogin) {
    const destino = destinoAposLogin(voltar, destinoPadrao);
    router.replace(area === "cliente" && busca.get("social") === "pendente" ? "/c/perfil?social=pendente" : r.completarCadastro ? "/c/perfil?foto=1" : r.definirSenha ? (area === "cliente" ? "/c/perfil#senha" : "/conta") : destino);
    router.refresh();
  }

  async function executar(fn: () => Promise<void>) {
    if (trava.current) return;
    trava.current = true;
    setErro("");
    setEnviando(true);
    try {
      await fn();
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    } finally { trava.current = false; }
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
    if (!/^\d{6}$/.test(codigo)) return setErro("Confirme seu celular com o código de 6 dígitos.");
    if (!aceite) return setErro("Aceite os Termos de uso e a Política de privacidade para criar a conta.");
    executar(async () => {
      try {
        seguir(await api<RespostaLogin>("/api/auth/cadastro", { method: "POST", body: { ...dadosCadastro, nome, telefone: identificador, senha, codigo, aceiteTermos: true } }));
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
    executar(async () => {
      try { seguir(await api<RespostaLogin>("/api/auth/entrar", { method: "POST", body: { telefone: identificador, codigo, area } })); }
      catch (e) {
        if (area === "cliente" && e instanceof ErroApi && e.codigo === "cadastro_necessario") trocar("cadastro");
        throw e;
      }
    });
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
          value={identificador} onChange={(e) => { setIdentificador(e.target.value); setCodigo(""); setErro(""); }} />
      </div>
    </div>
  );

  if (recuperando) return <main className="black-app black-login flex flex-1 items-center justify-center px-5 py-12"><div className="w-full max-w-md">
    <RecuperarSenhaCliente voltar={() => setRecuperando(false)} concluir={() => seguir({})} />
  </div></main>;
  if (socialCadastro) return <main className="black-app black-login flex flex-1 items-center justify-center px-5 py-12"><div className="w-full max-w-md">
    <CadastroSocial codigoDisponivel={codigoDisponivel} entrarComSenha={() => setSocialCadastro(false)} voltarAoLogin={voltarDoSocial} />
  </div></main>;

  return (
    <main className="black-app black-login flex flex-1 items-center justify-center px-5 py-16">
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
                <button type="button" className="text-zinc-500 hover:text-zinc-900" onClick={() => trocar("codigo-tel")}>{area === "cliente" ? "Entrar com código" : "Primeiro acesso ou esqueci a senha"}</button>
              ) : (
                <span className="text-zinc-500">Esqueceu a senha? Fale com a recepção.</span>
              )}
            </div>
            {area === "cliente" && codigoDisponivel && <button type="button" className="text-sm text-zinc-500 hover:text-zinc-900" onClick={() => setRecuperando(true)}>Esqueci a senha</button>}
          </form>
        )}

        {modo === "cadastro" && (
          <form onSubmit={cadastrar} className="mt-10 space-y-6">
            <div>
              <label className="rotulo" htmlFor="nome">Seu nome</label>
              <input id="nome" className="campo-linha text-lg" autoFocus autoComplete="name" value={nome} onChange={(e) => { setNome(e.target.value); setErro(""); }} />
            </div>
            {campoCelular("Celular", false)}
            <CamposCadastroCompleto identidade={false} valor={dadosCadastro} mudar={(k, v) => setDadosCadastro((f) => ({ ...f, [k]: v }))} />
            <p className="text-xs text-zinc-500">A foto é opcional e pode ser adicionada após criar a conta.</p>
            {campoSenha}
            <CodigoCadastro key={identificador} telefone={identificador} codigo={codigo} mudar={setCodigo} disponivel={codigoDisponivel} ocupado={enviando} />
            <label className="flex items-start gap-3 text-sm leading-6 text-zinc-600">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-ouro" checked={aceite} onChange={(e) => { setAceite(e.target.checked); setErro(""); }} />
              <span>Li e aceito os <Link href="/termos" target="_blank" className="font-semibold text-ouro underline">Termos de uso</Link> e a <Link href="/privacidade" target="_blank" className="font-semibold text-ouro underline">Política de privacidade</Link>.</span>
            </label>
            <button className="btn-primario w-full py-3" disabled={enviando || !codigoDisponivel}>{enviando ? "Criando..." : <>Criar conta e entrar <ArrowRight size={16} /></>}</button>
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
                : "Enviamos um código no seu WhatsApp para entrar na conta."}
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
        {erro && <p role="alert" className="mt-4 text-sm text-red-600">{erro}</p>}
        {busca.get("social") === "erro" && <p role="alert" className="mt-4 text-sm text-red-600">Não foi possível concluir o acesso social. Tente novamente ou entre com sua senha.</p>}
        {area === "cliente" && modo === "senha" && provedoresSociais.length > 0 && <AcessosSociais provedores={provedoresSociais} />}
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

/** Login por celular (ou usuario) + senha, usado pela equipe (/entrar) e pelos clientes (/c/entrar). */
export function FormularioLogin(props: Props) {
  return (
    <Suspense>
      <Formulario {...props} />
    </Suspense>
  );
}
