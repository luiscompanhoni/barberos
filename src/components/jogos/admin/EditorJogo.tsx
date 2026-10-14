"use client";

/**
 * Configuracao de um jogo no painel: liga/desliga, periodo, regras de liberacao, limite por pessoa, validade e os
 * premios (chance em %, estoque, custo, limite do mes). So publica com a soma das chances em 100%; antes, a
 * simulacao mostra a distribuicao e o custo com a mesma regra do sorteio do servidor.
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FlaskConical, Plus, Save, Trash2 } from "lucide-react";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";
import { ICONES, ROTULO_RARIDADE, type Raridade, type TipoPremio } from "@/lib/jogos/tipos";
import { IconePremio } from "../kit/IconePremio";
import type { JogoPainel, Painel, PremioPainel, Simulacao } from "./tipos";

type Linha = {
  chave: string; id?: string; rotulo: string; tipo: TipoPremio; valor: string; percentual: string; servicoId: string;
  chance: string; raridade: Raridade; cor: string; icone: string; ativo: boolean; limite: string; estoque: string; custo: string; saiuNoMes: number;
};

const TIPOS: { v: TipoPremio; r: string }[] = [
  { v: "CREDITO", r: "Crédito no saldo" }, { v: "BRINDE", r: "Brinde" }, { v: "SERVICO", r: "Serviço grátis" }, { v: "DESCONTO", r: "Desconto %" }, { v: "NADA", r: "Não foi dessa vez" },
];
const CORES = ["#141416", "#C9A24A", "#2A2A2E", "#8A6A3B", "#E6D3A3", "#3A3A3F"];
const RARIDADES: Raridade[] = ["COMUM", "RARO", "EPICO", "LENDARIO"];
let seq = 0;

const paraBps = (t: string) => {
  const n = Number(t.trim().replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const deBps = (b: number) => (b / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const numOuNulo = (t: string) => (t.trim() === "" ? null : Math.max(0, Math.round(Number(t))));
const dataInput = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

function linha(p: PremioPainel): Linha {
  return {
    chave: p.id, id: p.id, rotulo: p.rotulo, tipo: p.tipo, valor: p.valorCentavos ? centavosParaTexto(p.valorCentavos) : "", percentual: p.percentual ? String(p.percentual) : "",
    servicoId: p.servicoId ?? "", chance: deBps(p.chanceBps), raridade: p.raridade, cor: p.cor, icone: p.icone, ativo: p.ativo,
    limite: p.limiteMensal === null ? "" : String(p.limiteMensal), estoque: p.estoque === null ? "" : String(p.estoque),
    custo: p.custoCentavos ? centavosParaTexto(p.custoCentavos) : "", saiuNoMes: p.saiuNoMes,
  };
}

export function EditorJogo({ jogo, servicos, aoSalvar }: { jogo: JogoPainel; servicos: Painel["servicos"]; aoSalvar: (p: Painel) => void }) {
  const [cfg, setCfg] = useState(() => ({ ...jogo, inicioEm: dataInput(jogo.inicioEm), fimEm: dataInput(jogo.fimEm), valorMin: jogo.valorMinimoAtendimentoCentavos ? centavosParaTexto(jogo.valorMinimoAtendimentoCentavos) : "", limite: jogo.limitePorPessoaMes === null ? "" : String(jogo.limitePorPessoaMes) }));
  const [premios, setPremios] = useState<Linha[]>(() => jogo.premios.map(linha));
  const [sim, setSim] = useState<Simulacao | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const soma = useMemo(() => premios.filter((p) => p.ativo).reduce((t, p) => t + (paraBps(p.chance) || 0), 0), [premios]);
  const muda = (chave: string, d: Partial<Linha>) => { setSim(null); setPremios((ps) => ps.map((p) => (p.chave === chave ? { ...p, ...d } : p))); };
  const mover = (i: number, dir: -1 | 1) => setPremios((ps) => { const j = i + dir; if (j < 0 || j >= ps.length) return ps; const c = [...ps]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const num = (k: keyof typeof cfg, v: string) => setCfg({ ...cfg, [k]: Math.max(0, Math.round(Number(v) || 0)) });

  function corpoPremios(comId: boolean) {
    return premios.map((p) => ({
      ...(p.id ? { id: p.id } : comId ? { id: p.chave } : {}),
      rotulo: p.rotulo.trim(), tipo: p.tipo, valorCentavos: p.tipo === "CREDITO" || p.tipo === "SERVICO" ? paraCentavos(p.valor || "0") : 0,
      percentual: p.tipo === "DESCONTO" ? Math.round(Number(p.percentual) || 0) : 0, servicoId: p.tipo === "SERVICO" ? p.servicoId || null : null,
      chanceBps: paraBps(p.chance) || 0, raridade: p.raridade, cor: p.cor, icone: p.icone, ativo: p.ativo,
      limiteMensal: numOuNulo(p.limite), estoque: numOuNulo(p.estoque), custoCentavos: p.custo.trim() ? paraCentavos(p.custo) : 0,
    }));
  }
  function validarLocal() {
    for (const p of premios) {
      if (!p.rotulo.trim()) return "Dê um nome para cada prêmio.";
      if (Number.isNaN(paraBps(p.chance))) return `"${p.rotulo}": chance inválida.`;
      if ((p.tipo === "CREDITO") && !(paraCentavos(p.valor) > 0)) return `"${p.rotulo}": informe o valor em reais.`;
      if (p.custo.trim() && Number.isNaN(paraCentavos(p.custo))) return `"${p.rotulo}": custo inválido.`;
    }
    return null;
  }

  async function simular() {
    const e = validarLocal();
    if (e) return setMsg({ t: e, erro: true });
    setMsg(null);
    try {
      setSim(await api<Simulacao>("/api/jogos/simular", { method: "POST", body: { tipo: jogo.tipo, premiosPorJogada: cfg.premiosPorJogada, jogadas: 10_000, premios: corpoPremios(true) } }));
    } catch (x) { setMsg({ t: (x as Error).message, erro: true }); }
  }

  async function salvar() {
    const e = validarLocal();
    if (e) return setMsg({ t: e, erro: true });
    setSalvando(true);
    setMsg(null);
    try {
      const d = await api<Painel>(`/api/jogos/${jogo.id}`, {
        method: "PUT",
        body: {
          config: {
            nome: cfg.nome.trim(), descricao: cfg.descricao?.trim() || null, ativo: cfg.ativo, premiosPorJogada: cfg.premiosPorJogada, raridade: cfg.raridade,
            validadeDias: cfg.validadeDias, bonusAssinantePct: cfg.bonusAssinantePct,
            inicioEm: cfg.inicioEm ? new Date(`${cfg.inicioEm}T03:00:00Z`).toISOString() : null,
            fimEm: cfg.fimEm ? new Date(`${cfg.fimEm}T03:00:00Z`).toISOString() : null,
            limitePorPessoaMes: numOuNulo(cfg.limite) || null, jogadasPorAtendimento: cfg.jogadasPorAtendimento,
            valorMinimoAtendimentoCentavos: cfg.valorMin.trim() ? paraCentavos(cfg.valorMin) : 0, soAssinante: cfg.soAssinante,
            jogadasPorIndicacao: cfg.jogadasPorIndicacao, jogadasAniversario: cfg.jogadasAniversario, jogadasRenovacaoPlano: cfg.jogadasRenovacaoPlano, gratisACadaDias: cfg.gratisACadaDias,
          },
          premios: corpoPremios(false),
        },
      });
      aoSalvar(d);
      setMsg({ t: cfg.ativo ? "Publicado: o jogo já está no ar com essa configuração." : "Salvo (jogo desligado)." });
    } catch (x) {
      setMsg({ t: (x as Error).message, erro: true });
    } finally {
      setSalvando(false);
    }
  }

  const caixa = jogo.tipo === "CAIXA";
  const somaOk = soma === 10_000;

  return (
    <div className="space-y-4">
      <section className="cartao space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-3 font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-[#d3ab45]" checked={cfg.ativo} onChange={(e) => setCfg({ ...cfg, ativo: e.target.checked })} />
            {cfg.ativo ? "Ligado na área do cliente" : "Desligado"}
          </label>
          <span className="text-xs text-zinc-500">Este mês: {jogo.jogadasNoMes} jogadas · {jogo.premiosAbertos} prêmios para usar · custo esperado {reais(jogo.custoPorJogadaCentavos)}/jogada</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="rotulo">Nome</label><input className="campo" maxLength={40} value={cfg.nome} onChange={(e) => setCfg({ ...cfg, nome: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="rotulo">Descrição curta</label><input className="campo" maxLength={120} value={cfg.descricao ?? ""} onChange={(e) => setCfg({ ...cfg, descricao: e.target.value })} /></div>
          {caixa && <div><label className="rotulo">Prêmios por caixa</label><input className="campo" type="number" min={1} max={5} value={cfg.premiosPorJogada} onChange={(e) => num("premiosPorJogada", e.target.value)} /></div>}
          {caixa && (
            <div><label className="rotulo">Visual (raridade)</label>
              <select className="campo" value={cfg.raridade} onChange={(e) => setCfg({ ...cfg, raridade: e.target.value as Raridade })}>{RARIDADES.map((r) => <option key={r} value={r}>{ROTULO_RARIDADE[r]}</option>)}</select>
            </div>
          )}
          <div><label className="rotulo">Validade do prêmio (dias)</label><input className="campo" type="number" min={1} value={cfg.validadeDias} onChange={(e) => num("validadeDias", e.target.value)} /></div>
          <div><label className="rotulo">Bônus assinante em dinheiro (%)</label><input className="campo" type="number" min={0} max={200} value={cfg.bonusAssinantePct} onChange={(e) => num("bonusAssinantePct", e.target.value)} /></div>
          <div><label className="rotulo">Limite por pessoa no mês</label><input className="campo" type="number" min={1} placeholder="sem limite" value={cfg.limite} onChange={(e) => setCfg({ ...cfg, limite: e.target.value })} /></div>
          <div><label className="rotulo">Começa em</label><input className="campo" type="date" value={cfg.inicioEm} onChange={(e) => setCfg({ ...cfg, inicioEm: e.target.value })} /></div>
          <div><label className="rotulo">Termina em</label><input className="campo" type="date" value={cfg.fimEm} onChange={(e) => setCfg({ ...cfg, fimEm: e.target.value })} /></div>
        </div>
        <h3 className="pt-2 text-sm font-bold">Como o cliente ganha jogadas</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="rotulo">Por atendimento concluído</label><input className="campo" type="number" min={0} max={10} value={cfg.jogadasPorAtendimento} onChange={(e) => num("jogadasPorAtendimento", e.target.value)} /></div>
          <div><label className="rotulo">…a partir de (R$)</label><input className="campo" inputMode="decimal" placeholder="qualquer valor" value={cfg.valorMin} onChange={(e) => setCfg({ ...cfg, valorMin: e.target.value })} /></div>
          <div><label className="rotulo">Por amigo indicado que veio</label><input className="campo" type="number" min={0} max={10} value={cfg.jogadasPorIndicacao} onChange={(e) => num("jogadasPorIndicacao", e.target.value)} /></div>
          <div><label className="rotulo">No aniversário</label><input className="campo" type="number" min={0} max={10} value={cfg.jogadasAniversario} onChange={(e) => num("jogadasAniversario", e.target.value)} /></div>
          <div><label className="rotulo">A cada mensalidade paga</label><input className="campo" type="number" min={0} max={10} value={cfg.jogadasRenovacaoPlano} onChange={(e) => num("jogadasRenovacaoPlano", e.target.value)} /></div>
          <div><label className="rotulo">Grátis a cada (dias, 0 = não)</label><input className="campo" type="number" min={0} value={cfg.gratisACadaDias} onChange={(e) => num("gratisACadaDias", e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[#d3ab45]" checked={cfg.soAssinante} onChange={(e) => setCfg({ ...cfg, soAssinante: e.target.checked })} /> Só assinantes em dia podem jogar</label>
        <p className="text-xs text-zinc-500">Só o que acontecer depois de ligar o jogo libera jogadas. Campanhas de WhatsApp também podem dar uma jogada de presente (tela Campanhas).</p>
      </section>

      <section className="cartao space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Prêmios e chances</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${somaOk ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>Soma: {deBps(soma)}% {somaOk ? "✓" : `(falta ${deBps(10_000 - soma)}%)`}</span>
        </div>
        <div className="space-y-2">
          {premios.map((p, i) => (
            <div key={p.chave} className={`rounded-xl border p-2 ${p.ativo ? "border-zinc-200" : "border-dashed border-zinc-300 opacity-60"}`}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[auto_1.4fr_1.2fr_.9fr_.8fr_auto]">
                <div className="flex items-center gap-1">
                  <input type="color" value={p.cor} onChange={(e) => muda(p.chave, { cor: e.target.value })} className="h-9 w-9 cursor-pointer rounded border-0 bg-transparent" aria-label="Cor" />
                  <select className="campo w-auto py-1.5" value={p.icone} onChange={(e) => muda(p.chave, { icone: e.target.value })} aria-label="Ícone">{ICONES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                  <span className="text-ouro"><IconePremio icone={p.icone} tamanho={20} /></span>
                </div>
                <input className="campo py-1.5" maxLength={24} placeholder="Nome do prêmio" value={p.rotulo} onChange={(e) => muda(p.chave, { rotulo: e.target.value })} />
                <select className="campo py-1.5" value={p.tipo} onChange={(e) => muda(p.chave, { tipo: e.target.value as TipoPremio })}>{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select>
                {p.tipo === "CREDITO" && <input className="campo py-1.5" inputMode="decimal" placeholder="Valor R$" value={p.valor} onChange={(e) => muda(p.chave, { valor: e.target.value })} />}
                {p.tipo === "DESCONTO" && <input className="campo py-1.5" type="number" min={1} max={100} placeholder="% off" value={p.percentual} onChange={(e) => muda(p.chave, { percentual: e.target.value })} />}
                {p.tipo === "SERVICO" && (
                  <select className="campo py-1.5" value={p.servicoId} onChange={(e) => muda(p.chave, { servicoId: e.target.value })}>
                    <option value="">Serviço…</option>{servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                )}
                {(p.tipo === "BRINDE" || p.tipo === "NADA") && <span />}
                <div className="flex items-center gap-1">
                  <input className="campo py-1.5 text-right font-bold" inputMode="decimal" value={p.chance} onChange={(e) => muda(p.chave, { chance: e.target.value })} aria-label="Chance %" />
                  <span className="text-sm font-bold text-ouro">%</span>
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
                  <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={() => mover(i, -1)} aria-label="Subir"><ArrowUp size={14} /></button>
                  <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={() => mover(i, 1)} aria-label="Descer"><ArrowDown size={14} /></button>
                  <input type="checkbox" className="h-4 w-4 accent-[#d3ab45]" checked={p.ativo} onChange={(e) => muda(p.chave, { ativo: e.target.checked })} title="Ativo" />
                  <button className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600" onClick={() => setPremios((ps) => ps.filter((x) => x.chave !== p.chave))} aria-label="Remover"><Trash2 size={14} /></button>
                </div>
              </div>
              {p.tipo !== "NADA" && (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <select className="campo py-1.5 text-xs" value={p.raridade} onChange={(e) => muda(p.chave, { raridade: e.target.value as Raridade })} aria-label="Raridade">{RARIDADES.map((r) => <option key={r} value={r}>{ROTULO_RARIDADE[r]}</option>)}</select>
                  <input className="campo py-1.5 text-xs" type="number" min={0} placeholder="Estoque: sem limite" value={p.estoque} onChange={(e) => muda(p.chave, { estoque: e.target.value })} title="Quantos ainda podem sair" />
                  <input className="campo py-1.5 text-xs" type="number" min={0} placeholder="Limite/mês: sem" value={p.limite} onChange={(e) => muda(p.chave, { limite: e.target.value })} title="Máximo por mês (todos os clientes)" />
                  {p.tipo !== "CREDITO" && p.tipo !== "DESCONTO"
                    ? <input className="campo py-1.5 text-xs" inputMode="decimal" placeholder="Custo interno R$" value={p.custo} onChange={(e) => muda(p.chave, { custo: e.target.value })} title="Quanto custa para a barbearia" />
                    : <span className="self-center text-[11px] text-zinc-500">{p.saiuNoMes} saíram no mês</span>}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => setPremios((ps) => [...ps, { chave: `novo${++seq}`, rotulo: "", tipo: "CREDITO", valor: "", percentual: "", servicoId: "", chance: "0", raridade: "COMUM", cor: CORES[ps.length % CORES.length], icone: "dinheiro", ativo: true, limite: "", estoque: "", custo: "", saiuNoMes: 0 }])}>
            <Plus size={15} /> Adicionar prêmio
          </button>
          {!somaOk && premios.some((p) => p.ativo) && (
            <button className="btn" onClick={() => { const i = premios.findIndex((p) => p.ativo); muda(premios[i].chave, { chance: deBps((paraBps(premios[i].chance) || 0) + 10_000 - soma) }); }}>
              Ajustar o 1º para fechar 100%
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500">Prêmio sem estoque ou no limite do mês sai do sorteio: os outros dividem a chance dele. Removido não some do histórico (só fica desativado).</p>
      </section>

      <section className="cartao space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Simulação antes de publicar</h2>
          <button className="btn" onClick={simular} disabled={!somaOk}><FlaskConical size={15} /> Simular 10.000 jogadas</button>
        </div>
        {sim ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500"><th className="py-1">Prêmio</th><th className="text-right">Chance</th><th className="text-right">Saiu</th><th className="text-right">Real</th><th className="text-right">Custo</th></tr></thead>
                <tbody className="divide-y divide-zinc-200">
                  {sim.linhas.map((l) => (
                    <tr key={l.id}><td className="py-1.5">{l.rotulo}</td><td className="text-right">{deBps(l.chanceBps)}%</td><td className="text-right">{l.saiu.toLocaleString("pt-BR")}</td><td className="text-right">{l.pctReal.toLocaleString("pt-BR")}%</td><td className="text-right">{reais(l.custoCentavos)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm">Em {sim.jogadas.toLocaleString("pt-BR")} jogadas: <b>{sim.vitoriaPct.toLocaleString("pt-BR")}%</b> com prêmio · custo médio <b>{reais(sim.custoPorJogadaCentavos)}</b> por jogada (esperado {reais(sim.custoEsperadoPorJogadaCentavos)}){sim.semPremio > 0 && <> · <span className="text-red-700">{sim.semPremio} sorteios ficaram sem prêmio (estoque acabou)</span></>}.</p>
          </>
        ) : <p className="text-xs text-zinc-500">Roda o mesmo sorteio do servidor (com estoque e limite) e mostra quanto cada prêmio sai e quanto custa. Não grava nada.</p>}
      </section>

      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}
      <div className="flex justify-end">
        <button className="btn-primario px-6 py-2.5" disabled={salvando || !somaOk} onClick={salvar}><Save size={16} /> {salvando ? "Publicando…" : "Publicar"}</button>
      </div>
    </div>
  );
}
