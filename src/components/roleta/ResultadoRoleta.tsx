"use client";

import { useEffect, useState } from "react";
import { api, reais } from "@/lib/cliente-api";

type Resultado = {
  periodo: { chave: string; rotulo: string };
  giros: { total: number; credito: number; brinde: number; nada: number };
  brindes: { entregues: number; custoCentavos: number; semCusto: number };
  creditos: { usos: number; usadoCentavos: number };
  custoCentavos: number;
  visitas: number;
  faturamentoCentavos: number;
  retorno: number | null;
  saldoAberto: { centavos: number; creditos: number };
};
const PERIODOS = [["mes", "Este mês"], ["mes_passado", "Mês passado"], ["30d", "Últimos 30 dias"], ["90d", "Últimos 90 dias"]] as const;

function Bloco({ titulo, valor, detalhe, destaque }: { titulo: string; valor: string; detalhe: string; destaque?: boolean }) {
  return (
    <div className={destaque ? "cartao-destaque" : "cartao"}>
      <p className="text-xs text-zinc-500">{titulo}</p>
      <p className={`text-2xl font-black ${destaque ? "text-ouro" : ""}`}>{valor}</p>
      <p className="text-xs text-zinc-500">{detalhe}</p>
    </div>
  );
}

/** Custo da roleta x faturamento das visitas com resgate de premio (so o dono). */
export function ResultadoRoleta() {
  const [periodo, setPeriodo] = useState("mes");
  const [r, setR] = useState<Resultado | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    api<Resultado>(`/api/roleta/resultado?periodo=${periodo}`).then((x) => { setErro(""); setR(x); }).catch((e) => setErro(e.message));
  }, [periodo]);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Custo × faturamento</h2>
        <select className="campo ml-auto w-auto py-1.5" value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
          {PERIODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </div>
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {r && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Bloco titulo="Giros" valor={String(r.giros.total)} detalhe={`${r.giros.credito} em dinheiro · ${r.giros.brinde} brindes · ${r.giros.nada} sem prêmio`} />
            <Bloco titulo="Custo da roleta" valor={reais(r.custoCentavos)}
              detalhe={`${reais(r.creditos.usadoCentavos)} de saldo usado · ${reais(r.brindes.custoCentavos)} em ${r.brindes.entregues} brinde(s) entregue(s)`} />
            <Bloco titulo="Faturamento das visitas com resgate" valor={reais(r.faturamentoCentavos)} detalhe={`${r.visitas} visita(s) em que o cliente usou um prêmio`} />
            <Bloco titulo="Retorno" destaque valor={r.retorno === null ? "—" : `${r.retorno.toLocaleString("pt-BR")}×`}
              detalhe={r.retorno === null ? "Sem custo no período" : `R$ ${r.retorno.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} faturados por R$ 1 de custo`} />
          </div>
          <p className="text-xs text-zinc-500">
            Saldo da roleta ainda não usado: {reais(r.saldoAberto.centavos)} em {r.saldoAberto.creditos} crédito(s) (vira custo quando o cliente usar).
            {r.brindes.semCusto > 0 && <span className="text-amber-700"> {r.brindes.semCusto} brinde(s) entregue(s) sem custo cadastrado: informe o custo na lista de prêmios.</span>}
          </p>
        </>
      )}
    </section>
  );
}
