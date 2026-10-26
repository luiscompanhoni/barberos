"use client";

import { useState } from "react";
import Link from "next/link";
import { useAcesso } from "@/components/AcessoContexto";
import { ComissoesConfig } from "./ComissoesConfig";
import { ComissoesExtras } from "./ComissoesExtras";
import { ComissoesRelatorio } from "./ComissoesRelatorio";
import { FolhaTela } from "./FolhaTela";
import { Funcionarios } from "./Funcionarios";

const ABAS = [
  { v: "folha", r: "Folha de pagamento" },
  { v: "relatorio", r: "Comissões" },
  { v: "regras", r: "Regras de comissão" },
  { v: "funcionarios", r: "Funcionários" },
] as const;
type Aba = (typeof ABAS)[number]["v"];

/** RH: folha do mes, relatorio e regras de comissao, fichas dos funcionarios (cada aba conforme a permissao). */
export function RhTela() {
  const acesso = useAcesso();
  const pode = acesso.permissoes;
  const abas = ABAS.filter((a) => (a.v === "relatorio" ? pode.folha || pode.comissao : a.v === "regras" ? pode.comissao : pode.folha));
  const [aba, setAba] = useState<Aba>(abas[0]?.v ?? "relatorio");
  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Equipe</p>
        <h1 className="titulo-marca text-2xl">RH</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        {(acesso.papel === "DONO" || acesso.papel === "GERENTE") && <Link className="btn" href="/recrutamento">Recrutamento</Link>}
        {abas.map((a) => <button key={a.v} className={aba === a.v ? "btn-primario" : "btn"} onClick={() => setAba(a.v)}>{a.r}</button>)}
      </div>
      {aba === "folha" && <FolhaTela />}
      {aba === "relatorio" && <ComissoesRelatorio />}
      {aba === "regras" && <div className="space-y-6"><ComissoesConfig /><ComissoesExtras /></div>}
      {aba === "funcionarios" && <Funcionarios />}
    </div>
  );
}
