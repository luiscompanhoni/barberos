"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, reais } from "@/lib/cliente-api";
import { dataLocal, minParaHhmm, minutosLocal, somarDias } from "@/lib/agenda/tempo";

const FUSO = "America/Sao_Paulo";
type Barbeiro = { id: string; nome: string; cor: string };
type Servico = { id: string; nome: string; duracaoMin: number; precoCentavos: number; barbeiros: Barbeiro[] };
type Catalogo = { nomeBarbearia: string; janelaDias: number; servicos: Servico[] };
type Disp = { barbeiroId: string; nome: string; duracaoMin: number; precoCentavos: number; horarios: string[] };
/** Horario escolhido: com "qualquer barbeiro", fica com o primeiro livre naquele horario. */
type Opcao = { inicio: string; barbeiroId: string; barbeiroNome: string; precoCentavos: number };

const QUALQUER = "qualquer";
const hora = (iso: string) => minParaHhmm(minutosLocal(Date.parse(iso), FUSO));
const diaCurto = (d: string) => {
  const dt = new Date(`${d}T12:00:00Z`);
  return {
    semana: dt.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", ""),
    dia: dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }),
  };
};

/** Agendamento em 4 passos: servico -> barbeiro -> dia e hora -> confirmar. Tambem remarca. */
export function AgendarTela() {
  const router = useRouter();
  const q = useSearchParams();
  const remarcarId = q.get("remarcar");
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [servicoId, setServicoId] = useState(q.get("servico") ?? "");
  const [barbeiroId, setBarbeiroId] = useState(remarcarId ? (q.get("barbeiro") ?? QUALQUER) : "");
  const [hoje] = useState(() => dataLocal(Date.now(), FUSO));
  const [data, setData] = useState(hoje);
  const [disp, setDisp] = useState<Disp[] | null>(null);
  const [escolha, setEscolha] = useState<Opcao | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api<Catalogo>("/api/cliente/servicos").then(setCatalogo).catch((e) => setErro(e.message));
  }, []);

  const servico = catalogo?.servicos.find((s) => s.id === servicoId);
  const passo = !servico ? 1 : !barbeiroId ? 2 : !escolha ? 3 : 4;

  useEffect(() => {
    if (!servicoId || !barbeiroId) return;
    let vivo = true;
    const params = new URLSearchParams({ data, servicoId, ...(barbeiroId !== QUALQUER ? { barbeiroId } : {}) });
    api<Disp[]>(`/api/cliente/disponibilidade?${params}`)
      .then((r) => vivo && setDisp(r))
      .catch((e) => vivo && setErro(e.message));
    return () => { vivo = false; };
  }, [servicoId, barbeiroId, data]);

  // Junta os horarios de todos os barbeiros (modo "qualquer um").
  const opcoes = useMemo<Opcao[]>(() => {
    const mapa = new Map<string, Opcao>();
    for (const b of disp ?? []) {
      for (const h of b.horarios) {
        if (!mapa.has(h)) mapa.set(h, { inicio: h, barbeiroId: b.barbeiroId, barbeiroNome: b.nome, precoCentavos: b.precoCentavos });
      }
    }
    return [...mapa.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
  }, [disp]);

  async function confirmar() {
    if (!escolha) return;
    setErro("");
    setSalvando(true);
    try {
      if (remarcarId) {
        await api(`/api/cliente/agendamentos/${remarcarId}`, { method: "PATCH", body: { inicio: escolha.inicio, barbeiroId: escolha.barbeiroId } });
      } else {
        await api("/api/cliente/agendamentos", { method: "POST", body: { servicoId, barbeiroId: escolha.barbeiroId, inicio: escolha.inicio, semPreferencia: barbeiroId === QUALQUER } });
      }
      router.push("/c");
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
      setSalvando(false);
      setEscolha(null); // horario pode ter sido ocupado: mostra a lista atualizada
      setDisp(null);
    }
  }

  if (!catalogo) return <p className="text-sm text-zinc-500">{erro || "Carregando..."}</p>;
  const dias = Array.from({ length: catalogo.janelaDias + 1 }, (_, i) => somarDias(hoje, i));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">{remarcarId ? "Remarcar horário" : "Agendar"}</h1>
        <span className="ml-auto text-xs text-zinc-500">Passo {passo} de 4</span>
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {passo === 1 && (
        <div className="grid gap-2">
          {catalogo.servicos.map((s) => (
            <button key={s.id} className="cartao flex items-center text-left hover:border-zinc-400" onClick={() => setServicoId(s.id)}>
              <span>
                <span className="block font-medium">{s.nome}</span>
                <span className="text-sm text-zinc-500">{s.duracaoMin} min</span>
              </span>
              <span className="ml-auto font-semibold">{reais(s.precoCentavos)}</span>
            </button>
          ))}
        </div>
      )}

      {passo >= 2 && servico && (
        <Resumo rotulo="Serviço" valor={`${servico.nome} · ${reais(servico.precoCentavos)}`} onTrocar={remarcarId ? undefined : () => { setServicoId(""); setBarbeiroId(""); setEscolha(null); setDisp(null); }} />
      )}

      {passo === 2 && servico && (
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="cartao text-left hover:border-zinc-400" onClick={() => setBarbeiroId(QUALQUER)}>
            <span className="font-medium">Qualquer barbeiro</span>
            <span className="block text-sm text-zinc-500">Mais horários disponíveis</span>
          </button>
          {servico.barbeiros.map((b) => (
            <button key={b.id} className="cartao flex items-center gap-2 text-left hover:border-zinc-400" onClick={() => setBarbeiroId(b.id)}>
              <span className="h-3 w-3 rounded-full" style={{ background: b.cor }} />
              <span className="font-medium">{b.nome}</span>
            </button>
          ))}
        </div>
      )}

      {passo >= 3 && servico && (
        <Resumo
          rotulo="Barbeiro"
          valor={barbeiroId === QUALQUER ? "Qualquer barbeiro" : (servico.barbeiros.find((b) => b.id === barbeiroId)?.nome ?? "")}
          onTrocar={() => { setBarbeiroId(""); setEscolha(null); setDisp(null); }}
        />
      )}

      {passo === 3 && (
        <div className="space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {dias.map((d) => {
              const c = diaCurto(d);
              return (
                <button key={d} onClick={() => { setData(d); setDisp(null); }}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-center text-sm ${d === data ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white"}`}>
                  <span className="block capitalize">{c.semana}</span>
                  <span className="block font-semibold">{c.dia}</span>
                </button>
              );
            })}
          </div>
          {!disp ? (
            <p className="text-sm text-zinc-500">Buscando horários...</p>
          ) : opcoes.length === 0 ? (
            <p className="cartao text-sm text-zinc-600">Sem horários livres nesse dia. Tente outro dia{barbeiroId !== QUALQUER ? " ou outro barbeiro" : ""}.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {opcoes.map((o) => (
                <button key={o.inicio} onClick={() => setEscolha(o)} className="rounded-lg border border-zinc-300 bg-white py-2 text-sm font-medium hover:border-zinc-900">
                  {hora(o.inicio)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {passo === 4 && escolha && servico && (
        <div className="cartao space-y-3">
          <p className="text-sm text-zinc-600">Confira e confirme:</p>
          <p className="text-lg font-semibold first-letter:uppercase">
            {new Date(escolha.inicio).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: FUSO })} às {hora(escolha.inicio)}
          </p>
          <p className="text-sm">{servico.nome} com {escolha.barbeiroNome} · {reais(escolha.precoCentavos)}</p>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setEscolha(null)}>Voltar</button>
            <button className="btn-primario" onClick={confirmar} disabled={salvando}>
              {salvando ? "Confirmando..." : remarcarId ? "Confirmar remarcação" : "Confirmar agendamento"}
            </button>
          </div>
        </div>
      )}

      <Link href="/c" className="block text-center text-sm text-zinc-500 underline">Voltar para meus horários</Link>
    </div>
  );
}

function Resumo({ rotulo, valor, onTrocar }: { rotulo: string; valor: string; onTrocar?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
      <span className="text-zinc-500">{rotulo}:</span>
      <span className="font-medium">{valor}</span>
      {onTrocar && <button className="ml-auto text-xs text-zinc-500 underline" onClick={onTrocar}>trocar</button>}
    </div>
  );
}
