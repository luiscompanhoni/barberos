"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Cfg = {
  lembreteHorasAntes: number;
  lembreteMinutosAntes: number;
  avisoFalta: boolean;
  limiteFaltas: number;
  janelaFaltasDias: number;
  posAtendimento: boolean;
  linkAvaliacao: string | null;
  reativacaoDias: number;
  aniversario: boolean;
  presenteAniversario: string | null;
  retornoAtivo: boolean;
  indicacaoAtiva: boolean;
  premioIndicadorCentavos: number;
  premioIndicadoCentavos: number;
  cashbackAtivo: boolean;
  cashbackPct: number;
  cashbackValidadeDias: number;
};
type Log = {
  ultimas: { id: string; tipo: string; ok: boolean; erro: string | null; criadoEm: string; cliente: string }[];
  semana: Record<string, number>;
  semMensagens: number;
};

const NOMES: Record<string, string> = {
  LEMBRETE_VESPERA: "Lembrete (véspera)",
  LEMBRETE_PROXIMO: "Lembrete (chegando a hora)",
  POS_FALTA: "Depois da falta",
  POS_ATENDIMENTO: "Agradecimento",
  REATIVACAO: "Cliente sumido",
  ANIVERSARIO: "Aniversário",
  RETORNO: "Hora de voltar",
  ESPERA_HORARIO: "Vaga abriu (lista de espera)",
  INDICACAO: "Prêmio de indicação",
};

/** Mensagens automaticas no WhatsApp (so o dono configura). */
export function AutomacoesTela() {
  const [c, setC] = useState<Cfg | null>(null);
  const [log, setLog] = useState<Log | null>(null);
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);

  const carregarLog = useCallback(() => { api<Log>("/api/automacoes").then(setLog).catch(() => {}); }, []);
  useEffect(() => {
    api<Cfg>("/api/configuracao").then(setC).catch((e) => setMsg({ texto: e.message, erro: true }));
    carregarLog();
  }, [carregarLog]);

  if (!c) return <section className="cartao text-sm text-zinc-500">{msg?.texto ?? "Carregando..."}</section>;
  const campo = <K extends keyof Cfg>(k: K, v: Cfg[K]) => { setC({ ...c, [k]: v }); setMsg(null); };
  const num = (k: keyof Cfg, v: string) => campo(k, Math.max(0, Math.round(Number(v) || 0)) as never);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { lembreteHorasAntes, lembreteMinutosAntes, avisoFalta, limiteFaltas, janelaFaltasDias, posAtendimento, reativacaoDias, aniversario,
        retornoAtivo, indicacaoAtiva, premioIndicadorCentavos, premioIndicadoCentavos, cashbackAtivo, cashbackPct, cashbackValidadeDias } = c!;
      await api("/api/configuracao", {
        method: "PATCH",
        body: {
          lembreteHorasAntes, lembreteMinutosAntes, avisoFalta, limiteFaltas, janelaFaltasDias, posAtendimento, reativacaoDias, aniversario,
          retornoAtivo, indicacaoAtiva, premioIndicadorCentavos, premioIndicadoCentavos, cashbackAtivo, cashbackPct, cashbackValidadeDias,
          linkAvaliacao: c!.linkAvaliacao?.trim() || null, presenteAniversario: c!.presenteAniversario?.trim() || null,
        },
      });
      setMsg({ texto: "Automações salvas. Valem a partir da próxima rodada (a cada 5 min)." });
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  return (
    <form onSubmit={salvar} className="cartao space-y-4">
      <div className="flex items-center gap-2">
        <BellRing size={18} className="text-ouro" />
        <h2 className="font-semibold">Mensagens automáticas no WhatsApp</h2>
      </div>
      <p className="text-sm text-zinc-500">
        Saem entre 8h e 21h (o lembrete de “chegando a hora” sai quando precisa). Quem responder PARAR não recebe mais.
        Fora da janela de 24h do WhatsApp, usam o modelo aprovado de aviso (WHATSAPP_TEMPLATE_AVISO).
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Bloco titulo="Lembrete na véspera" ajuda="Pede para o cliente confirmar; o bot entende o “SIM” e marca como confirmado.">
          <Numero id="a-lh" rotulo="Horas antes (0 desliga)" valor={c.lembreteHorasAntes} onChange={(v) => num("lembreteHorasAntes", v)} max={72} />
        </Bloco>
        <Bloco titulo="Lembrete chegando a hora" ajuda="Com o endereço, para ninguém se atrasar.">
          <Numero id="a-lm" rotulo="Minutos antes (0 desliga)" valor={c.lembreteMinutosAntes} onChange={(v) => num("lembreteMinutosAntes", v)} max={240} />
        </Bloco>
        <Bloco titulo="Faltas" ajuda="Quem passar do limite só marca falando com a equipe (bot e site passam para vocês).">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={c.avisoFalta} onChange={(e) => campo("avisoFalta", e.target.checked)} />
            Depois da falta, oferecer remarcar
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Numero id="a-lf" rotulo="Limite de faltas (0 = sem)" valor={c.limiteFaltas} onChange={(v) => num("limiteFaltas", v)} max={10} />
            <Numero id="a-jf" rotulo="Em quantos dias" valor={c.janelaFaltasDias} onChange={(v) => num("janelaFaltasDias", v)} max={365} />
          </div>
        </Bloco>
        <Bloco titulo="Agradecimento depois do corte" ajuda="Sai 30 min depois de marcar como concluído. Com o link, pede avaliação no Google.">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={c.posAtendimento} onChange={(e) => campo("posAtendimento", e.target.checked)} />
            Mandar agradecimento
          </label>
          <input className="campo" placeholder="Link de avaliação no Google (opcional)" value={c.linkAvaliacao ?? ""} onChange={(e) => campo("linkAvaliacao", e.target.value)} />
        </Bloco>
        <Bloco titulo="Aniversário" ajuda="Parabéns às 9h do dia, para quem tem data de nascimento no cadastro.">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={c.aniversario} onChange={(e) => campo("aniversario", e.target.checked)} />
            Mandar parabéns
          </label>
          <input className="campo" placeholder="Presente (opcional), ex.: uma cerveja por nossa conta" value={c.presenteAniversario ?? ""} onChange={(e) => campo("presenteAniversario", e.target.value)} />
        </Bloco>
        <Bloco titulo="Hora de voltar (no ritmo de cada cliente)" ajuda="Quem corta a cada 20 dias recebe no dia 19 um lembrete com 2 horários livres do barbeiro de costume. O bot marca na resposta.">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={c.retornoAtivo} onChange={(e) => campo("retornoAtivo", e.target.checked)} />
            Mandar lembrete de retorno
          </label>
        </Bloco>
        <Bloco titulo="Indique e ganhe" ajuda="Cada cliente ganha um link. Quem chega por ele ganha o desconto de boas-vindas; quem indicou ganha o prêmio quando o amigo faz o 1º corte. Os descontos saem na comanda.">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={c.indicacaoAtiva} onChange={(e) => campo("indicacaoAtiva", e.target.checked)} />
            Programa de indicação ativo
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Numero id="a-pi" rotulo="Quem indica ganha (R$)" valor={c.premioIndicadorCentavos / 100} onChange={(v) => campo("premioIndicadorCentavos", Math.max(0, Math.round(Number(v) * 100) || 0))} max={1000} />
            <Numero id="a-pn" rotulo="Amigo ganha (R$)" valor={c.premioIndicadoCentavos / 100} onChange={(v) => campo("premioIndicadoCentavos", Math.max(0, Math.round(Number(v) * 100) || 0))} max={1000} />
          </div>
        </Bloco>
        <Bloco titulo="Cashback" ajuda="Uma % de tudo que o cliente paga na comanda (corte avulso, bar, loja) volta como saldo para a próxima visita. Aparece na tela Saldo do cliente e sai na comanda.">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={c.cashbackAtivo} onChange={(e) => campo("cashbackAtivo", e.target.checked)} />
            Dar cashback
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Numero id="a-cbp" rotulo="Quanto volta (%)" valor={c.cashbackPct} onChange={(v) => num("cashbackPct", v)} max={50} />
            <Numero id="a-cbv" rotulo="Vale por (dias)" valor={c.cashbackValidadeDias} onChange={(v) => num("cashbackValidadeDias", v)} max={365} />
          </div>
        </Bloco>
        <Bloco titulo="Chamar de volta quem sumiu" ajuda="Mensagem para quem não vem há X dias e não tem nada marcado (até 15 por vez). É promocional: use com moderação.">
          <Numero id="a-rd" rotulo="Dias sem vir (0 desliga)" valor={c.reativacaoDias} onChange={(v) => num("reativacaoDias", v)} max={365} />
        </Bloco>
      </div>

      {msg && <p className={`text-sm ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</p>}
      <button className="btn-primario">Salvar automações</button>

      {log && (
        <div className="space-y-2 border-t border-zinc-200 pt-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <h3 className="font-semibold">Últimos 7 dias</h3>
            {Object.keys(NOMES).map((t) => <span key={t} className="text-zinc-500">{NOMES[t]}: <b className="text-zinc-900">{log.semana[t] ?? 0}</b></span>)}
            {log.semMensagens > 0 && <span className="text-zinc-500">{log.semMensagens} cliente(s) pediram para não receber</span>}
            <button type="button" className="ml-auto text-xs text-zinc-500 underline" onClick={carregarLog}>atualizar</button>
          </div>
          {log.ultimas.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhuma mensagem automática enviada ainda.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-zinc-200 overflow-y-auto text-sm">
              {log.ultimas.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-1.5">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">
                    {new Date(u.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{u.cliente}</span>
                  <span className="text-xs text-zinc-500">{NOMES[u.tipo] ?? u.tipo}</span>
                  {!u.ok && <span className="text-xs text-red-600" title={u.erro ?? ""}>não enviada</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

function Bloco({ titulo, ajuda, children }: { titulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 p-3">
      <p className="text-sm font-semibold">{titulo}</p>
      <p className="text-xs text-zinc-500">{ajuda}</p>
      {children}
    </div>
  );
}

function Numero({ id, rotulo, valor, onChange, max }: { id: string; rotulo: string; valor: number; onChange: (v: string) => void; max: number }) {
  return (
    <div>
      <label className="rotulo" htmlFor={id}>{rotulo}</label>
      <input id={id} type="number" min={0} max={max} className="campo" value={valor} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
