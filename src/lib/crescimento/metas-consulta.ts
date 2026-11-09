import { z } from "zod";
import { dataLocal, parseData } from "@/lib/agenda/tempo";
import { somarMes } from "@/lib/assinaturas/regras";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { zData } from "@/lib/validacao";
import type { ContratoMeta } from "./metas";

const numero = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const data = zData.refine((valor) => { try { parseData(valor); return true; } catch { return false; } }, "Data civil inválida.");
const id = z.string().trim().min(1).max(80);
export const zEntradaMetas = z.object({
  referencia: data, fuso: z.string().min(1).max(80).optional(),
  realizado: z.object({ inicio: data, fimExclusivo: data, receitaAssinaturasLiquidaCentavos: numero,
    receitaOutrasVendasLiquidaCentavos: numero, descontosEstornosJaDeduzidosCentavos: numero,
    custosTotaisCentavos: numero.nullable(), custosCompletos: z.boolean() }).strict(),
  assinantesAdimplentes: numero, assinantesAtrasados: numero, contratosCompletos: z.boolean(),
  contratos: z.array(z.object({ id, clienteId: id, planoId: id, valorMensalLiquidoCentavos: numero,
    inicio: data, fimExclusivo: data.nullable(), situacao: z.enum(["ADIMPLENTE", "ATRASADO"]) }).strict()).max(10_000),
  cancelamentos: z.array(z.object({ contratoId: id, fimExclusivo: data }).strict()).max(10_000),
  dezembro: z.object({ outrasVendasLiquidasCentavos: numero.nullable(), custosBaseCentavos: numero.nullable(), custosCompletos: z.boolean() }).strict(),
  aquisicao: z.object({ contribuicaoVerificada: z.boolean(), receitaLiquidaPorNovoDezembroCentavos: numero.nullable(),
    custosVariaveisPorNovoCentavos: numero.nullable(), custoIndicacaoTotalPorNovoCentavos: numero,
    creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos: numero }).strict(),
  capacidade: z.object({ verificada: z.boolean(), duracaoVisitaMinutos: numero.nullable(), minutosOfertaveisDezembro: numero.nullable(),
    minutosOutrasVendasDezembro: numero.nullable(), visitasPlanejadasPorAssinante: z.union([z.literal(2), z.literal(3), z.literal(4)]).nullable() }).strict(),
}).strict();

/** Leitura local, sem sincronização de gateway ou reconhecimento contábil implícito. */
export async function consultarBaseMetas(agora = new Date()) {
  let dados;
  try {
    dados = await Promise.all([
      db.configuracao.findUnique({ where: { id: 1 }, select: { fuso: true } }),
      db.assinatura.findMany({ where: { status: { not: "CANCELADA" } }, take: 10_001,
        select: { id: true, clienteId: true, planoId: true, status: true, precoCentavos: true, cicloInicio: true,
          proximoVencimento: true, ativadaEm: true, criadaEm: true, encerraEm: true, pausadaEm: true, operacaoInicial: true,
          plano: { select: { nome: true } }, cobrancas: { where: { status: "PAGA", pagaEm: { not: null }, vinculosExternos: { none: {} } },
            select: { vencimento: true, pagaEm: true } } } }),
    ]);
  } catch {
    throw new ErroNegocio("Base de metas indisponível. Confira a conexão com o banco; nenhum dado de exemplo foi carregado.", 503, "base_indisponivel");
  }
  const [configuracao, assinaturas] = dados;
  const fuso = configuracao?.fuso ?? "America/Sao_Paulo";
  const referencia = dataLocal(agora, fuso);
  const clientes = new Map<string, string>();
  const planos = new Map<string, string>();
  const grupos = new Map<string, { plano: string; valorContratoCentavos: number; contratos: number }>();
  const comprovados = new Set<string>(), atrasados = new Set<string>(), desconhecidos = new Set<string>();
  const contratos: ContratoMeta[] = [];
  let mrrNominalCentavos = 0;
  for (const [indice, assinatura] of assinaturas.slice(0, 10_000).entries()) {
    if (!clientes.has(assinatura.clienteId)) clientes.set(assinatura.clienteId, `cliente-${clientes.size + 1}`);
    if (!planos.has(assinatura.planoId)) planos.set(assinatura.planoId, `plano-${planos.size + 1}`);
    const clienteId = clientes.get(assinatura.clienteId)!;
    const ciclo = assinatura.cicloInicio?.toISOString().slice(0, 10);
    const proximo = assinatura.proximoVencimento?.toISOString().slice(0, 10);
    const fim = assinatura.encerraEm?.toISOString().slice(0, 10) ?? null;
    const pagasDoCiclo = assinatura.cobrancas.filter((cobranca) => cobranca.vencimento.toISOString().slice(0, 10) === ciclo && cobranca.pagaEm && +cobranca.pagaEm <= +agora);
    const comprovada = assinatura.status === "ATIVA" && !assinatura.pausadaEm && !assinatura.operacaoInicial &&
      !!ciclo && ciclo <= referencia && somarMes(ciclo) > referencia && !!proximo && proximo > referencia && (!fim || fim > referencia) && pagasDoCiclo.length === 1;
    if (comprovada) comprovados.add(clienteId);
    else if (assinatura.status === "ATRASADA") atrasados.add(clienteId);
    else desconhecidos.add(clienteId);
    mrrNominalCentavos += assinatura.precoCentavos;
    const chave = `${assinatura.planoId}:${assinatura.precoCentavos}`;
    const grupo = grupos.get(chave) ?? { plano: assinatura.plano.nome, valorContratoCentavos: assinatura.precoCentavos, contratos: 0 };
    grupo.contratos++; grupos.set(chave, grupo);
    if (comprovada || assinatura.status === "ATRASADA") contratos.push({ id: `contrato-${indice + 1}`, clienteId,
      planoId: planos.get(assinatura.planoId)!, valorMensalLiquidoCentavos: assinatura.precoCentavos,
      inicio: dataLocal(assinatura.ativadaEm ?? assinatura.criadaEm, fuso), fimExclusivo: fim,
      situacao: comprovada ? "ADIMPLENTE" : "ATRASADO" });
  }
  for (const cliente of comprovados) { atrasados.delete(cliente); desconhecidos.delete(cliente); }
  for (const cliente of atrasados) desconhecidos.delete(cliente);
  return { referencia, fuso, consultadoEm: agora.toISOString(), assinantesNominais: clientes.size,
    assinantesComprovados: comprovados.size, assinantesAtrasados: atrasados.size, outrosSemComprovacao: desconhecidos.size,
    mrrNominalCentavos, porPlano: [...grupos.values()], contratos, coberturaTruncada: assinaturas.length > 10_000,
    limitacoes: ["Fotografia local nominal; não é DRE nem receita reconhecida.",
      "Adimplência comprovada localmente exige ATIVA, ciclo vigente e uma cobrança PAGA do mesmo ciclo com pagaEm, sem vínculo externo histórico. Eventos do provedor/importação não foram auditados.",
      "Valores contratuais ainda precisam de revisão de descontos/estornos; projeção de continuidade não comprova pagamento futuro.",
      "Receitas, despesas completas, cancelamentos futuros e capacidade precisam de conferência manual antes da decisão."] };
}
export type BaseMetasCrescimento = Awaited<ReturnType<typeof consultarBaseMetas>>;
