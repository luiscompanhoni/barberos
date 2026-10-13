"use client";

import type { indicadoresDeAssinaturas, indicadoresDoBar } from "@/lib/indicadores/assinaturas-bar";
import type { indicadoresDoBarbeiro, rankingDaEquipe } from "@/lib/indicadores/barbeiro";
import type { Leitura } from "@/lib/indicadores/leituras";
import type { indicadoresDoNegocio } from "@/lib/indicadores/negocio";

export type Dados = {
  periodo: { chave: string; rotulo: string; de: number; ate: number; dias: number };
  negocio: Awaited<ReturnType<typeof indicadoresDoNegocio>>;
  assinaturas: Awaited<ReturnType<typeof indicadoresDeAssinaturas>>;
  bar: Awaited<ReturnType<typeof indicadoresDoBar>>;
  equipe: Awaited<ReturnType<typeof rankingDaEquipe>>;
  leituras: Leitura[];
};

export type DadosBarbeiro = { periodo: { chave: string; rotulo: string } } & Awaited<ReturnType<typeof indicadoresDoBarbeiro>>;

export const PERIODOS: [string, string][] = [
  ["7d", "7 dias"], ["30d", "30 dias"], ["mes", "Este mês"], ["mes_passado", "Mês passado"], ["90d", "90 dias"], ["ano", "Este ano"],
];
export const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const CANAIS: Record<string, string> = { BOT: "WhatsApp (bot)", SITE: "Site", RECEPCAO: "Recepção", BARBEIRO: "Barbeiro", PAINEL: "Painel" };
export const ORIGENS: Record<string, string> = {
  INDICACAO: "Indicação", INSTAGRAM: "Instagram", GOOGLE: "Google", FACHADA: "Passou na frente", WHATSAPP: "WhatsApp", OUTRO: "Outro", NAO_INFORMADO: "Não informado",
};

export function SeletorPeriodo({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PERIODOS.map(([k, r]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${valor === k ? "bg-ouro text-fundo" : "bg-zinc-100 text-zinc-600 hover:text-zinc-900"}`}>
          {r}
        </button>
      ))}
    </div>
  );
}
