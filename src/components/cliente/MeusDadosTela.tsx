"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Situacao = { termosVersao: string | null; termosAceitosEm: string | null; aceitaMensagens: boolean; versaoAtual: string; precisaAceitar: boolean; impedimentos: string[] };

/** LGPD na area do cliente: termos aceitos, mensagens de divulgacao, copia dos dados e exclusao da conta. */
export function MeusDadosTela() {
  const router = useRouter();
  const [s, setS] = useState<Situacao | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");

  useEffect(() => { api<Situacao>("/api/cliente/privacidade").then(setS).catch((e) => setErro(e.message)); }, []);

  async function enviar(body: Record<string, unknown>) {
    setErro(""); setSalvando(true);
    try {
      const r = await api<Situacao & { excluida?: boolean }>("/api/cliente/privacidade", { method: "POST", body });
      if (r.excluida) { router.replace("/c/entrar?excluida=1"); router.refresh(); return; }
      setS(r);
    } catch (e) { setErro((e as Error).message); } finally { setSalvando(false); }
  }

  if (!s) return <p className="text-sm text-zinc-500">{erro || "Carregando..."}</p>;
  const aceitoEm = s.termosAceitosEm ? new Date(s.termosAceitosEm).toLocaleDateString("pt-BR") : null;

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Privacidade</p>
        <h1 className="titulo-marca mt-1 text-2xl">Meus dados</h1>
        <p className="mt-1 text-sm text-zinc-500">Seus direitos pela LGPD, direto no aplicativo.</p>
      </header>

      <section className="cartao space-y-3">
        <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-ouro" /> Termos e privacidade</h2>
        <p className="text-sm text-zinc-500">
          {s.precisaAceitar ? "Você ainda não aceitou a versão atual." : `Você aceitou a versão atual em ${aceitoEm}.`}{" "}
          Leia a <Link href="/privacidade" className="text-ouro underline">Política de privacidade</Link> e os <Link href="/termos" className="text-ouro underline">Termos de uso</Link>.
        </p>
        {s.precisaAceitar && <button className="btn-primario" disabled={salvando} onClick={() => enviar({ acao: "aceitar" })}>Li e aceito</button>}
      </section>

      <section className="cartao space-y-3">
        <h2 className="font-semibold">Mensagens de divulgação</h2>
        <label className="flex items-start gap-3 text-sm text-zinc-600">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-ouro" checked={s.aceitaMensagens} disabled={salvando}
            onChange={(e) => enviar({ acao: "mensagens", aceita: e.target.checked })} />
          <span>Quero receber promoções, campanhas e convites pelo WhatsApp. Lembretes dos meus horários e avisos de pagamento continuam chegando.</span>
        </label>
      </section>

      <section className="cartao space-y-3">
        <h2 className="flex items-center gap-2 font-semibold"><Download size={18} className="text-ouro" /> Baixar meus dados</h2>
        <p className="text-sm text-zinc-500">Arquivo com seu cadastro, horários, comandas, pagamentos, plano, saldo, prêmios e conversas no WhatsApp.</p>
        <a className="btn" href="/api/cliente/privacidade/dados" download>Baixar arquivo</a>
      </section>

      <section className="cartao space-y-3 border-red-600/30">
        <h2 className="flex items-center gap-2 font-semibold"><Trash2 size={18} className="text-red-700" /> Excluir minha conta</h2>
        <p className="text-sm text-zinc-500">
          Apaga na hora seu nome, celular, e-mail, CPF, nascimento, preferências e conversas. Seus atendimentos e pagamentos
          ficam no histórico da barbearia sem identificar você (obrigação fiscal). Saldo e prêmios são perdidos. Não dá para desfazer.
        </p>
        {s.impedimentos.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800" role="status">{s.impedimentos.map((i) => <li key={i}>{i}</li>)}</ul>
        ) : !excluir ? (
          <button className="btn-perigo" onClick={() => setExcluir(true)}>Quero excluir minha conta</button>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); enviar({ acao: "excluir", confirmacao }); }}>
            <label className="rotulo" htmlFor="confirmar-exclusao">Digite EXCLUIR para confirmar</label>
            <input id="confirmar-exclusao" className="campo" autoComplete="off" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-perigo" disabled={salvando || confirmacao.trim().toUpperCase() !== "EXCLUIR"}>Excluir definitivamente</button>
              <button type="button" className="btn" onClick={() => { setExcluir(false); setConfirmacao(""); }}>Voltar</button>
            </div>
          </form>
        )}
      </section>
      {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
    </div>
  );
}
