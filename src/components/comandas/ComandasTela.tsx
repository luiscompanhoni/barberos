"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Plus, Receipt, Search, UserRound } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { Modal } from "@/components/Modal";
import { nomeDaComanda, ROTULO_FORMA, type Comanda, type ModoMaquininha } from "./tipos";
import { useAoVivo } from "./useAoVivo";

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
type Concluido = { id: string; inicio: string; precoCentavos: number; assinaturaId: string | null; antecipado: { status: string } | null;
  cliente: { nome: string }; barbeiro: { nome: string }; servico: { nome: string } };
type Dados = { comandas: Comanda[]; concluidos: Concluido[]; maquininha: ModoMaquininha };

/** Comandas abertas (cartoes) e as fechadas do turno. */
export function ComandasTela() {
  const [dados, setDados] = useState<Dados | null>(null);
  const router = useRouter();
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [nova, setNova] = useState(false);

  const carregar = useCallback(() => {
    api<Dados>("/api/comandas").then((r) => { setDados(r); setErro(""); }).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);
  useAoVivo("comanda", carregar);
  useAoVivo("agenda", carregar);

  async function abrirAtendimento(id: string) {
    setAbrindo(id); setErro("");
    try {
      const r = await api<{ id: string }>("/api/comandas", { method: "POST", body: { agendamentoId: id } });
      router.push(`/comandas/${r.id}`);
    } catch (e) { setErro((e as Error).message); }
    finally { setAbrindo(null); }
  }

  if (!dados) return <p className="text-sm text-zinc-500">{erro || "Carregando..."}</p>;
  const abertas = dados.comandas.filter((c) => c.status === "ABERTA");
  const fechadas = dados.comandas.filter((c) => c.status !== "ABERTA");
  const totalFechadas = fechadas.filter((c) => c.status === "FECHADA").reduce((s, c) => s + c.resumo.total, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="eyebrow">Balcão</p>
          <h1 className="titulo-marca text-2xl">Comandas</h1>
        </div>
        <span className="ml-auto text-xs text-zinc-500">
          Maquininha: {dados.maquininha === "stone" ? "Stone integrada" : dados.maquininha === "simulada" ? "simulada (teste)" : "manual"}
        </span>
        <button className="btn-primario" onClick={() => setNova(true)}><Plus size={15} /> Nova comanda</button>
      </div>

      {erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {abertas.length === 0 ? (
        <div className="cartao py-10 text-center text-sm text-zinc-500">
          <Receipt className="mx-auto mb-3 text-zinc-400" size={28} />
          Nenhuma comanda aberta. Abra pelo botão acima ou pelo atendimento na agenda.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {abertas.map((c) => (
            <Link key={c.id} href={`/comandas/${c.id}`} className="cartao-clicavel flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-ouro">#{c.numero}</p>
                  <p className="truncate font-bold">{nomeDaComanda(c)}</p>
                </div>
                <span className="text-xs text-zinc-500">{hora(c.abertaEm)}</span>
              </div>
              <p className="line-clamp-2 min-h-[2.5em] text-xs text-zinc-500">
                {c.itens.length ? c.itens.map((i) => (i.quantidade > 1 ? `${i.quantidade}× ` : "") + i.descricao).join(" · ") : "Sem itens"}
              </p>
              <div className="flex items-end justify-between">
                <span className="text-xl font-black">{reais(c.resumo.total)}</span>
                {c.resumo.aguardando > 0 ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-ouro"><LoaderCircle size={13} className="animate-spin" /> Na maquininha</span>
                ) : c.resumo.podeFechar ? (
                  <span className="selo-ouro">Pago · fechar</span>
                ) : c.resumo.pago > 0 ? (
                  <span className="text-xs text-zinc-500">Falta {reais(c.resumo.falta)}</span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}

      {fechadas.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-zinc-600">Histórico de comandas de hoje</h2>
            <span className="text-sm font-bold">{reais(totalFechadas)}</span>
          </div>
          <ul className="cartao divide-y divide-zinc-200 p-0 text-sm">
            {fechadas.map((c) => (
              <li key={c.id}>
                <Link href={`/comandas/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50">
                  <span className="w-12 text-xs font-bold text-zinc-500">#{c.numero}</span>
                  <span className="min-w-0 flex-1 truncate">{nomeDaComanda(c)}</span>
                  <span className="hidden text-xs text-zinc-500 sm:inline">
                    {[...new Set(c.pagamentos.filter((p) => p.status === "PAGO").map((p) => ROTULO_FORMA[p.forma]))].join(" + ")}
                  </span>
                  {c.status === "CANCELADA" ? <span className="text-xs text-red-600">Cancelada</span> : <span className="font-semibold">{reais(c.resumo.total)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dados.concluidos.length > 0 && <section className="space-y-3">
        <div><h2 className="font-semibold">Atendimentos concluídos sem comanda</h2>
          <p className="text-xs text-zinc-500">Histórico do dia. Concluir o atendimento não confirma recebimento.</p></div>
        <ul className="cartao divide-y divide-zinc-200 p-0">
          {dados.concluidos.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="text-xs text-zinc-500">{hora(a.inicio)}</span>
            <div className="min-w-40 flex-1"><p className="text-sm font-semibold">{a.cliente.nome}</p>
              <p className="text-xs text-zinc-500">{a.servico.nome} · {a.barbeiro.nome}</p></div>
            <div className="text-right"><p className="font-semibold">{reais(a.precoCentavos)}</p>
              <p className={`text-xs ${a.precoCentavos === 0 || a.antecipado?.status === "PAGO" ? "text-emerald-700" : "text-amber-700"}`}>
                {a.antecipado?.status === "PAGO" ? "Pago antecipadamente · conferir na comanda" : a.precoCentavos === 0 ? a.assinaturaId ? "Incluído no plano · sem cobrança extra" : "Serviço sem cobrança" : "Conferir recebimento na comanda"}</p></div>
            <button className="btn text-xs" disabled={abrindo !== null} onClick={() => abrirAtendimento(a.id)}>
              {abrindo === a.id ? "Abrindo…" : "Abrir comanda"}</button>
          </li>)}
        </ul>
      </section>}

      {nova && <NovaComanda onFechar={() => setNova(false)} />}
    </div>
  );
}

type ClienteBusca = { id: string; nome: string; telefone: string };

function NovaComanda({ onFechar }: { onFechar: () => void }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<ClienteBusca[]>([]);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (busca.trim().length < 2) return;
    const t = setTimeout(() => {
      api<ClienteBusca[]>(`/api/clientes?busca=${encodeURIComponent(busca.trim())}`).then(setAchados).catch(() => setAchados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  async function abrir(corpo: { clienteId?: string; nomeAvulso?: string }) {
    setErro("");
    setEnviando(true);
    try {
      const r = await api<{ id: string }>("/api/comandas", { method: "POST", body: corpo });
      router.push(`/comandas/${r.id}`);
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Nova comanda" onFechar={onFechar}>
      <label className="rotulo" htmlFor="busca-cliente">Cliente</label>
      <div className="relative">
        <Search size={15} className="absolute top-2.5 left-3 text-zinc-500" />
        <input id="busca-cliente" className="campo pl-9" autoFocus placeholder="Nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <div className="mt-2 space-y-1">
        {busca.trim().length >= 2 && achados.map((c) => (
          <button key={c.id} disabled={enviando} onClick={() => abrir({ clienteId: c.id })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100">
            <UserRound size={15} className="text-ouro" />
            <span className="flex-1 font-medium">{c.nome || "(sem nome)"}</span>
            <span className="text-xs text-zinc-500">{c.telefone.slice(-4).padStart(8, "•")}</span>
          </button>
        ))}
      </div>
      {busca.trim().length >= 2 && (
        <button disabled={enviando} onClick={() => abrir({ nomeAvulso: busca.trim() })} className="btn mt-3 w-full">
          Abrir sem cadastro: “{busca.trim()}”
        </button>
      )}
      {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
      <p className="mt-4 text-xs text-zinc-500">Atendimento marcado na agenda? Abra a comanda pelo cartão do atendimento: o serviço já entra com o preço certo.</p>
    </Modal>
  );
}
