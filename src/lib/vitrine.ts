import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { vagasRestantes } from "@/lib/assinaturas/servico";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const hh = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;

/** Dias e horario de funcionamento a partir da semana padrao dos barbeiros ativos. Ex.: "Seg–Sáb", "09h–20h". */
export function horarioDeFuncionamento(expediente: { diaSemana: number; inicioMin: number; fimMin: number }[]) {
  if (expediente.length === 0) return null;
  const dias = [...new Set(expediente.map((e) => e.diaSemana))].sort((a, b) => a - b);
  const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  const textoDias = dias.length === 1 ? DIAS[dias[0]] : seguidos ? `${DIAS[dias[0]]}–${DIAS[dias.at(-1)!]}` : dias.map((d) => DIAS[d]).join(", ");
  const inicio = Math.min(...expediente.map((e) => e.inicioMin));
  const fim = Math.max(...expediente.map((e) => e.fimMin));
  return { dias: textoDias, horas: `${hh(inicio)}–${hh(fim)}` };
}

/** "Rua X, 50 - Rio do Sul/SC" -> "Rio do Sul · SC" */
export function cidadeDoEndereco(endereco: string | null) {
  const cidade = endereco?.split(/\s[-–]\s/).at(-1)?.trim();
  if (!cidade || cidade === endereco?.trim()) return null;
  return cidade.replace("/", " · ");
}

/** Dados publicos da pagina de venda das assinaturas (/assine). So informacao real do sistema. */
export async function dadosDaVitrine() {
  const [cfg, planos, assinantes, expediente] = await Promise.all([
    configuracao(),
    db.plano.findMany({
      where: { ativo: true },
      orderBy: [{ ordem: "asc" }, { precoCentavos: "asc" }],
      include: { servicos: { include: { servico: { select: { nome: true } } } } },
    }),
    db.assinatura.count({ where: { status: { in: ["ATIVA", "ATRASADA"] } } }),
    db.expedientePadrao.findMany({ where: { barbeiro: { ativo: true } }, select: { diaSemana: true, inicioMin: true, fimMin: true } }),
  ]);

  return {
    nomeBarbearia: cfg.nomeBarbearia,
    endereco: cfg.endereco,
    cidade: cidadeDoEndereco(cfg.endereco),
    horario: horarioDeFuncionamento(expediente),
    // Numero pequeno nao ajuda a vender: so mostra a partir de 20 assinantes.
    assinantes: assinantes >= 20 ? assinantes : null,
    whatsapp: process.env.WHATSAPP_NUMERO_PUBLICO?.replace(/\D/g, "") || null,
    indicacao: { ativa: cfg.indicacaoAtiva, premioIndicadoCentavos: cfg.premioIndicadoCentavos },
    fotoCapa: existsSync(path.join(process.cwd(), "public", "capa.jpg")) ? "/capa.jpg" : null,
    planos: await Promise.all(
      planos.map(async (p) => ({
        id: p.id,
        nome: p.nome,
        descricao: p.descricao,
        precoCentavos: p.precoCentavos,
        intervaloMinDias: p.intervaloMinDias,
        diasSemana: p.diasSemana,
        descontoExtrasPct: p.descontoExtrasPct,
        servicos: p.servicos.map((s) => ({ nome: s.servico.nome, usosPorCiclo: s.usosPorCiclo })),
        vagasRestantes: await vagasRestantes(p),
      })),
    ),
  };
}
