"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarCheck, Clock3, Scissors, UserRound, Wallet, type LucideIcon } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { FotoBarbeiro } from "@/components/FotoBarbeiro";
import { SemVaga } from "./SemVaga";
import { dataLocal, minParaHhmm, minutosLocal, somarDias } from "@/lib/agenda/tempo";

const FUSO = "America/Sao_Paulo";
type Barbeiro = { id: string; nome: string; cor: string; fotoVersao: number };
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
  const [previa, setPrevia] = useState<{ precoCentavos: number; peloPlano: boolean; nota: string | null; bloqueio: string | null } | null>(null);

  // Preco real para este cliente (incluso no plano, desconto de assinante ou avulso).
  useEffect(() => {
    if (!escolha || !servicoId) return;
    let vivo = true;
    const q = new URLSearchParams({ servicoId, barbeiroId: escolha.barbeiroId, inicio: escolha.inicio, ...(remarcarId ? { remarcar: remarcarId } : {}) });
    api<NonNullable<typeof previa>>(`/api/cliente/preco?${q}`).then((r) => vivo && setPrevia(r)).catch(() => {});
    return () => { vivo = false; setPrevia(null); };
  }, [escolha, servicoId, remarcarId]);

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
        await api(`/api/cliente/agendamentos/${remarcarId}`, { method: "PATCH", body: { inicio: escolha.inicio, barbeiroId: escolha.barbeiroId, forcarAvulso: !!previa?.bloqueio } });
      } else {
        await api("/api/cliente/agendamentos", { method: "POST", body: { servicoId, barbeiroId: escolha.barbeiroId, inicio: escolha.inicio, semPreferencia: barbeiroId === QUALQUER, forcarAvulso: !!previa?.bloqueio } });
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
  const barbeiroEscolhido = barbeiroId === QUALQUER ? null : servico?.barbeiros.find((b) => b.id === barbeiroId);
  const voltarPasso = () => {
    if (passo === 4) setEscolha(null);
    else if (passo === 3) { setBarbeiroId(""); setDisp(null); }
    else if (passo === 2 && !remarcarId) setServicoId("");
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="eyebrow">{remarcarId ? "Remarcar horário" : "Agendar"}</span>
        <span className="text-xs font-bold text-zinc-500 uppercase">Passo {passo} de 4</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((n) => <div key={n} className={`h-1 rounded-full transition ${n <= passo ? "bg-ouro" : "bg-zinc-200"}`} />)}
      </div>
      {erro && <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {passo === 1 && (
        <Passo eyebrow="Comece por aqui" titulo="Qual serviço?">
          <div className="space-y-3">
            {catalogo.servicos.map((s) => (
              <button key={s.id} className="cartao-clicavel flex w-full items-center gap-4 p-5 text-left" onClick={() => setServicoId(s.id)}>
                <Scissors className="shrink-0 text-ouro" size={20} />
                <span className="flex-1">
                  <span className="block font-bold">{s.nome}</span>
                  <span className="mt-1 block text-xs text-zinc-500">{s.duracaoMin} min · {reais(s.precoCentavos)}</span>
                </span>
                <ArrowRight className="text-zinc-400" size={16} />
              </button>
            ))}
          </div>
        </Passo>
      )}

      {passo === 2 && servico && (
        <Passo eyebrow="Escolha o profissional" titulo="Com quem?">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <button className="cartao-clicavel px-4 py-6 text-center" onClick={() => setBarbeiroId(QUALQUER)}>
              <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border-2 border-zinc-300 bg-zinc-200"><UserRound size={34} className="text-ouro" /></div>
              <p className="mt-4 text-sm font-bold">Qualquer barbeiro</p>
              <p className="mt-1 text-[11px] text-zinc-500">Mais horários</p>
            </button>
            {servico.barbeiros.map((b) => (
              <button key={b.id} className="cartao-clicavel px-4 py-6 text-center" onClick={() => setBarbeiroId(b.id)}>
                <FotoBarbeiro id={b.id} nome={b.nome} cor={b.cor} versao={b.fotoVersao} tamanho={96} className="mx-auto" />
                <p className="mt-4 text-sm font-bold">{b.nome}</p>
              </button>
            ))}
          </div>
        </Passo>
      )}

      {passo === 3 && servico && (
        <Passo eyebrow={`${servico.nome} · ${barbeiroEscolhido?.nome ?? "qualquer barbeiro"}`} titulo="Quando?">
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-3 [scrollbar-width:none]">
            {dias.map((d) => {
              const c = diaCurto(d);
              const sel = d === data;
              return (
                <button key={d} onClick={() => { setData(d); setDisp(null); }}
                  className={`min-w-[68px] shrink-0 rounded-xl border p-3 text-center text-xs font-bold transition ${sel ? "border-ouro bg-ouro text-fundo" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400"}`}>
                  <span className="block capitalize">{c.semana}</span>
                  <span className={`mt-0.5 block text-sm ${sel ? "" : "text-zinc-900"}`}>{c.dia}</span>
                </button>
              );
            })}
          </div>
          <p className="rotulo mt-6">Horários disponíveis</p>
          {!disp ? (
            <p className="mt-3 text-sm text-zinc-500">Buscando horários...</p>
          ) : opcoes.length === 0 ? (
            <SemVaga key={`${data}|${barbeiroId}`} data={data} servicoId={servico.id} barbeiroId={barbeiroId === QUALQUER ? null : barbeiroId} />
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {opcoes.map((o) => (
                <button key={o.inicio} onClick={() => setEscolha(o)}
                  className="rounded-lg border border-zinc-200 bg-white py-3 text-sm font-bold transition hover:border-ouro hover:text-ouro">
                  {hora(o.inicio)}
                </button>
              ))}
            </div>
          )}
        </Passo>
      )}

      {passo === 4 && escolha && servico && (
        <Passo eyebrow="Confirme seu horário" titulo="Tudo certo?">
          <div className="cartao-destaque grid gap-5 p-6">
            <Linha Icone={Scissors} rotulo="Serviço" valor={servico.nome} />
            <Linha Icone={UserRound} rotulo="Barbeiro" valor={escolha.barbeiroNome} />
            <Linha Icone={CalendarCheck} rotulo="Data"
              valor={new Date(escolha.inicio).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: FUSO })} />
            <Linha Icone={Clock3} rotulo="Horário" valor={hora(escolha.inicio)} />
            <Linha Icone={Wallet} rotulo="Valor"
              valor={!previa ? reais(escolha.precoCentavos) : previa.peloPlano ? "Incluso no seu plano" : `${reais(previa.precoCentavos)}${previa.nota ? ` (${previa.nota})` : ""}`}
              destaque={!!previa?.peloPlano} />
          </div>
          {previa?.bloqueio && (
            <div className="mt-4 rounded-xl border border-ouro/30 bg-ouro/5 p-4 text-xs leading-5 text-zinc-600">
              <strong className="text-ouro">Regra do plano:</strong> {previa.bloqueio}
            </div>
          )}
        </Passo>
      )}

      <div className="mt-8 flex gap-3">
        {passo > 1 && !(passo === 2 && remarcarId) && (
          <button className="btn h-12 w-12 shrink-0 p-0" aria-label="Voltar" onClick={voltarPasso}><ArrowLeft size={18} /></button>
        )}
        {passo === 4 && (
          <button className="btn-primario h-12 flex-1" onClick={confirmar} disabled={salvando}>
            {salvando ? "Confirmando..." : previa?.bloqueio ? `Confirmar como avulso · ${reais(previa.precoCentavos)}` : remarcarId ? "Confirmar remarcação" : "Confirmar agendamento"}
          </button>
        )}
      </div>
      {passo < 4 && <Link href="/c" className="mt-6 block text-center text-sm text-zinc-500 hover:text-zinc-900">Voltar para meus horários</Link>}
    </div>
  );
}

function Passo({ eyebrow, titulo, children }: { eyebrow: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="entrar-suave">
      <p className="eyebrow mt-8">{eyebrow}</p>
      <h1 className="titulo-marca mt-3 mb-7 text-4xl">{titulo}</h1>
      {children}
    </section>
  );
}

function Linha({ Icone, rotulo, valor, destaque }: { Icone: LucideIcon; rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <Icone className="shrink-0 text-ouro" size={20} />
      <div>
        <p className="text-[10px] font-bold text-zinc-500 uppercase">{rotulo}</p>
        <p className={`mt-1 text-sm font-bold first-letter:uppercase ${destaque ? "text-ouro" : ""}`}>{valor}</p>
      </div>
    </div>
  );
}
