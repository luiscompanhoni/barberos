"use client";

/**
 * Resultado da jogada (igual em todos os jogos): "Você ganhou" com o(s) premio(s), codigo e as acoes
 * (agendar para resgatar, ver meus premios, voltar ao inicio). Sem premio: mensagem elegante e como ganhar outra.
 */
import Link from "next/link";
import { CalendarPlus, Gift, House, Share2, X } from "lucide-react";
import { reais } from "@/lib/cliente-api";
import { descricaoPremio, ROTULO_RARIDADE, type JogadaCliente, type PremioCliente } from "@/lib/jogos/tipos";
import { IconePremio } from "./IconePremio";

const ORDEM = { COMUM: 0, RARO: 1, EPICO: 2, LENDARIO: 3 } as const;

export function raridadeMaxima(ps: Pick<PremioCliente, "raridade">[]) {
  return ps.reduce<PremioCliente["raridade"]>((m, p) => (ORDEM[p.raridade] > ORDEM[m] ? p.raridade : m), "COMUM");
}

export function CartaPremio({ p, grande = false, className = "", style }: { p: PremioCliente; grande?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`jogo-carta raridade-${p.raridade} ${grande ? "jogo-carta-grande" : ""} ${className}`} style={style}>
      <span className="jogo-carta-raridade">{ROTULO_RARIDADE[p.raridade]}</span>
      <span className="jogo-carta-icone"><IconePremio icone={p.icone} tamanho={grande ? 56 : 38} traco={1.4} /></span>
      <span className="jogo-carta-nome">{p.tipo === "CREDITO" ? reais(p.valorCentavos) : p.rotulo}</span>
      <span className="jogo-carta-desc">{descricaoPremio(p)}</span>
    </div>
  );
}

export function ModalResultado({ jogada, aoFechar, campanha = false, jogarDeNovo, fichasRestantes, podeIndicar = true }: {
  jogada: JogadaCliente;
  aoFechar: () => void;
  /** Link da campanha (sem login): as acoes levam a entrar/agendar. */
  campanha?: boolean;
  jogarDeNovo?: () => void;
  fichasRestantes?: number;
  podeIndicar?: boolean;
}) {
  const ps = jogada.premios;
  const usar = ps.find((p) => p.tipo !== "CREDITO");
  const titulo = ps.length ? "Você ganhou!" : "Não foi dessa vez";

  return (
    <div className="jogo-modal-fundo" role="dialog" aria-modal="true" aria-labelledby="resultado-titulo">
      <div className={`jogo-modal jogo-surgir ${ps.length ? `brilho-${raridadeMaxima(ps)}` : ""}`}>
        <button type="button" onClick={aoFechar} aria-label="Fechar" className="jogo-botao-redondo absolute right-3 top-3"><X size={18} /></button>
        <h2 id="resultado-titulo" className={`jogo-titulo text-center ${ps.length ? "text-3xl" : "text-2xl"}`}>{titulo}</h2>

        {ps.length ? (
          <>
            <div className={`mt-5 flex flex-wrap justify-center gap-3 ${ps.length > 1 ? "" : "px-6"}`}>
              {ps.map((p, i) => <CartaPremio key={p.id} p={p} grande={ps.length === 1} style={{ animationDelay: `${i * 90}ms` }} className="jogo-surgir" />)}
            </div>
            {ps.some((p) => p.tipo !== "CREDITO") && (
              <p className="mt-4 text-center text-xs text-zinc-500">
                Mostre o código na barbearia:{" "}
                {ps.filter((p) => p.tipo !== "CREDITO").map((p) => <b key={p.id} className="ml-1 font-mono tracking-wider text-zinc-900">{p.codigo}</b>)}
              </p>
            )}
            {ps.some((p) => p.tipo === "CREDITO") && <p className="mt-2 text-center text-xs text-zinc-500">O crédito já está no seu saldo e entra como desconto no próximo atendimento.</p>}
            {ps[0]?.expiraEm && <p className="mt-1 text-center text-[11px] text-zinc-500">Válido até {new Date(ps[0].expiraEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.</p>}

            <div className="mt-5 grid gap-2">
              <Link href={campanha ? "/c/agendar" : `/c/agendar${usar ? `?premio=${usar.id}` : ""}`} className="jogo-botao-ouro">
                <CalendarPlus size={18} /> {usar ? "Agendar para utilizar" : "Agendar e usar o crédito"}
              </Link>
              {!campanha && (
                <Link href={`/c/premios${usar ? `?destaque=${usar.id}` : ""}`} className="jogo-botao-grafite">
                  <Gift size={17} /> Resgatar prêmio
                </Link>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="mx-auto mt-5 grid h-20 w-20 place-items-center rounded-full border border-zinc-300 text-zinc-500">
              <IconePremio icone="nada" tamanho={40} />
            </div>
            <p className="mt-4 text-center text-sm text-zinc-600">A sorte fica para a próxima. Cada atendimento libera novas jogadas.</p>
            {podeIndicar && !campanha && (
              <Link href="/c/saldo" className="jogo-botao-grafite mt-4"><Share2 size={17} /> Indique um amigo e ganhe outra jogada</Link>
            )}
          </>
        )}

        <div className="mt-2 grid gap-2">
          {!!jogarDeNovo && !!fichasRestantes && (
            <button type="button" onClick={jogarDeNovo} className="jogo-botao-grafite">Jogar de novo ({fichasRestantes})</button>
          )}
          <Link href={campanha ? "/c" : "/c/jogos"} className="jogo-botao-texto"><House size={16} /> Voltar para o início</Link>
        </div>
      </div>
    </div>
  );
}
