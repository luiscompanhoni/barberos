"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { api, reais } from "@/lib/cliente-api";

type PlanoApi = {
  id: string; nome: string; descricao: string | null; precoCentavos: number; ativo: boolean;
  vagas: number | null; intervaloMinDias: number | null; maxAgendamentosAbertos: number;
  diasSemana: number[]; descontoExtrasPct: number; formasPagamento: string[];
  servicos: { servicoId: string; usosPorCiclo: number | null; servico: { nome: string } }[];
  barbeiros: { barbeiroId: string }[];
  _count: { assinaturas: number; listaEspera: number };
  vagasRestantes: number | null;
};
type Servico = { id: string; nome: string; ativo: boolean };
type Barbeiro = { id: string; nome: string; ativo: boolean };

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const FORMAS = [["PIX", "Pix"], ["CARTAO", "Cartão"], ["BOLETO", "Boleto"]] as const;

export function PlanosTela() {
  const [planos, setPlanos] = useState<PlanoApi[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([]);
  const [editando, setEditando] = useState<PlanoApi | "novo" | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(() => {
    api<PlanoApi[]>("/api/planos").then(setPlanos).catch((e) => setErro(e.message));
  }, []);
  useEffect(() => {
    carregar();
    api<Servico[]>("/api/servicos").then(setServicos).catch(() => {});
    api<Barbeiro[]>("/api/barbeiros").then(setBarbeiros).catch(() => {});
  }, [carregar]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Planos de assinatura</h1>
        <button className="btn-primario ml-auto" onClick={() => setEditando("novo")}>+ Novo plano</button>
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {planos.map((p) => (
          <button key={p.id} className={`cartao space-y-2 text-left hover:border-zinc-400 ${p.ativo ? "" : "opacity-60"}`} onClick={() => setEditando(p)}>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">{p.nome}</span>
              {!p.ativo && <span className="rounded bg-zinc-100 px-1.5 text-xs">inativo</span>}
              <span className="ml-auto text-lg font-semibold">{reais(p.precoCentavos)}<span className="text-xs font-normal text-zinc-500">/mês</span></span>
            </div>
            <p className="text-sm text-zinc-600">{p.servicos.map((s) => s.servico.nome + (s.usosPorCiclo ? ` (${s.usosPorCiclo}x)` : "")).join(" · ")}</p>
            <div className="flex flex-wrap gap-1.5 text-xs text-zinc-600">
              {p.intervaloMinDias && <Tag>1 uso a cada {p.intervaloMinDias} dias</Tag>}
              <Tag>{p.maxAgendamentosAbertos} horário(s) por vez</Tag>
              {p.diasSemana.length > 0 && p.diasSemana.length < 7 && <Tag>{[...p.diasSemana].sort().map((d) => DIAS[d]).join(", ")}</Tag>}
              {p.descontoExtrasPct > 0 && <Tag>{p.descontoExtrasPct}% nos extras</Tag>}
            </div>
            <p className="text-sm">
              <b>{p._count.assinaturas}</b> assinante(s)
              {p.vagas !== null && <> · {p.vagasRestantes} de {p.vagas} vagas livres</>}
              {p._count.listaEspera > 0 && <> · <span className="text-amber-700">{p._count.listaEspera} na lista de espera</span></>}
            </p>
          </button>
        ))}
      </div>
      {editando && (
        <FormPlano plano={editando === "novo" ? null : editando} servicos={servicos.filter((s) => s.ativo)} barbeiros={barbeiros.filter((b) => b.ativo)}
          onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar(); }} />
      )}
    </div>
  );
}

const Tag = ({ children }: { children: React.ReactNode }) => <span className="rounded-full bg-zinc-100 px-2 py-0.5">{children}</span>;

function FormPlano(p: { plano: PlanoApi | null; servicos: Servico[]; barbeiros: Barbeiro[]; onFechar: () => void; onSalvo: () => void }) {
  const x = p.plano;
  const [nome, setNome] = useState(x?.nome ?? "");
  const [descricao, setDescricao] = useState(x?.descricao ?? "");
  const [preco, setPreco] = useState(x ? String(x.precoCentavos / 100).replace(".", ",") : "");
  const [vagas, setVagas] = useState(x?.vagas ? String(x.vagas) : "");
  const [intervalo, setIntervalo] = useState(x?.intervaloMinDias ? String(x.intervaloMinDias) : "7");
  const [abertos, setAbertos] = useState(String(x?.maxAgendamentosAbertos ?? 1));
  const [dias, setDias] = useState<number[]>(x?.diasSemana.length ? x.diasSemana : [1, 2, 3, 4, 5, 6]);
  const [desconto, setDesconto] = useState(String(x?.descontoExtrasPct ?? 10));
  const [formas, setFormas] = useState<string[]>(x?.formasPagamento ?? ["PIX", "CARTAO", "BOLETO"]);
  const [inclusos, setInclusos] = useState<Record<string, string>>(
    Object.fromEntries((x?.servicos ?? []).map((s) => [s.servicoId, s.usosPorCiclo ? String(s.usosPorCiclo) : ""])),
  );
  const [barbeiroIds, setBarbeiroIds] = useState<string[]>(x?.barbeiros.map((b) => b.barbeiroId) ?? []);
  const [ativo, setAtivo] = useState(x?.ativo ?? true);
  const [erro, setErro] = useState("");

  const alterna = <T,>(lista: T[], v: T) => (lista.includes(v) ? lista.filter((i) => i !== v) : [...lista, v]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    const precoCentavos = Math.round(Number(preco.replace(/\./g, "").replace(",", ".")) * 100);
    if (nome.trim().length < 2) return setErro("Dê um nome ao plano.");
    if (!Number.isFinite(precoCentavos) || precoCentavos < 100) return setErro("Preço inválido.");
    if (!Object.keys(inclusos).length) return setErro("Escolha pelo menos um serviço incluído.");
    if (!formas.length) return setErro("Escolha pelo menos uma forma de pagamento.");
    if (!dias.length) return setErro("Escolha pelo menos um dia da semana.");
    const body = {
      nome: nome.trim(), descricao: descricao.trim() || null, precoCentavos, ativo,
      vagas: vagas ? Number(vagas) : null, intervaloMinDias: intervalo ? Number(intervalo) : null,
      maxAgendamentosAbertos: Number(abertos) || 1, diasSemana: dias.length === 7 ? [] : dias,
      descontoExtrasPct: Number(desconto) || 0, formasPagamento: formas,
      servicos: Object.entries(inclusos).map(([servicoId, u]) => ({ servicoId, usosPorCiclo: u ? Number(u) : null })),
      barbeiroIds,
    };
    try {
      await api(x ? `/api/planos/${x.id}` : "/api/planos", { method: x ? "PATCH" : "POST", body });
      p.onSalvo();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <Modal titulo={x ? `Editar ${x.nome}` : "Novo plano"} onFechar={p.onFechar}>
      <form onSubmit={salvar} className="space-y-3 text-sm">
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <div><label className="rotulo">Nome</label><input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div><label className="rotulo">Preço/mês (R$)</label><input className="campo" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} /></div>
        </div>
        <div><label className="rotulo">Descrição (aparece para o cliente)</label><input className="campo" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></div>

        <div>
          <label className="rotulo">Serviços incluídos (usos por mês: vazio = à vontade)</label>
          <div className="space-y-1">
            {p.servicos.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={s.id in inclusos}
                  onChange={() => setInclusos((m) => { const n = { ...m }; if (s.id in n) delete n[s.id]; else n[s.id] = ""; return n; })} />
                <span className="flex-1">{s.nome}</span>
                {s.id in inclusos && (
                  <input className="campo w-24 py-1" placeholder="à vontade" inputMode="numeric" value={inclusos[s.id]}
                    onChange={(e) => setInclusos((m) => ({ ...m, [s.id]: e.target.value.replace(/\D/g, "") }))} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div><label className="rotulo">Dias entre usos</label><input className="campo" inputMode="numeric" placeholder="livre" value={intervalo} onChange={(e) => setIntervalo(e.target.value.replace(/\D/g, ""))} /></div>
          <div><label className="rotulo">Horários por vez</label><input className="campo" inputMode="numeric" value={abertos} onChange={(e) => setAbertos(e.target.value.replace(/\D/g, ""))} /></div>
          <div><label className="rotulo">Vagas</label><input className="campo" inputMode="numeric" placeholder="sem limite" value={vagas} onChange={(e) => setVagas(e.target.value.replace(/\D/g, ""))} /></div>
        </div>

        <div>
          <label className="rotulo">Dias em que o plano vale</label>
          <div className="flex flex-wrap gap-1">
            {DIAS.map((d, i) => (
              <button type="button" key={d} onClick={() => setDias((l) => alterna(l, i))}
                className={`rounded-md border px-2 py-1 text-xs ${dias.includes(i) ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"}`}>{d}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div><label className="rotulo">Desconto nos extras (%)</label><input className="campo" inputMode="numeric" value={desconto} onChange={(e) => setDesconto(e.target.value.replace(/\D/g, ""))} /></div>
          <div>
            <label className="rotulo">Formas de pagamento</label>
            <div className="flex gap-2 pt-2">
              {FORMAS.map(([v, t]) => (
                <label key={v} className="flex items-center gap-1"><input type="checkbox" checked={formas.includes(v)} onChange={() => setFormas((l) => alterna(l, v))} />{t}</label>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="rotulo">Barbeiros que atendem pelo plano (nenhum marcado = todos)</label>
          <div className="flex flex-wrap gap-3">
            {p.barbeiros.map((b) => (
              <label key={b.id} className="flex items-center gap-1"><input type="checkbox" checked={barbeiroIds.includes(b.id)} onChange={() => setBarbeiroIds((l) => alterna(l, b.id))} />{b.nome}</label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />Plano à venda</label>
        {x && <p className="text-xs text-zinc-500">Mudar o preço vale só para novas assinaturas: quem já assina continua pagando o valor de quando entrou.</p>}
        {erro && <p className="text-red-600">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={p.onFechar}>Voltar</button>
          <button className="btn-primario">Salvar plano</button>
        </div>
      </form>
    </Modal>
  );
}
