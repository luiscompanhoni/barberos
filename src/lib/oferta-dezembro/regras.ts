import { instanteLocal } from "@/lib/agenda/tempo";
import { ErroNegocio } from "@/lib/erros";

const FUSO_OFERTA = "America/Sao_Paulo";
const inicioDoDia = (data: string) => instanteLocal(data, 0, FUSO_OFERTA);
const DIA_MS = 86_400_000;

export const TERMO_DEZEMBRO = "dezembro-2026-homologacao-v1";

export const CRONOGRAMA_DEZEMBRO = {
  inicioAdesao: "2026-11-22",
  inicioGratis: "2026-12-01",
  primeiroDebito: "2027-01-01",
  competencias: ["2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01", "2027-06-01"],
  fimFidelidade: "2027-07-01",
} as const;

export const INICIO_GRATIS_DEZEMBRO = inicioDoDia(CRONOGRAMA_DEZEMBRO.inicioGratis);
export const FIM_GRATIS_DEZEMBRO = inicioDoDia(CRONOGRAMA_DEZEMBRO.primeiroDebito);
const INICIO_ADESAO = inicioDoDia(CRONOGRAMA_DEZEMBRO.inicioAdesao);
const FINS_DE_COMPETENCIA = [...CRONOGRAMA_DEZEMBRO.competencias.slice(1), CRONOGRAMA_DEZEMBRO.fimFidelidade].map(inicioDoDia);

export const dentroDoPeriodoGratis = (instante: Date | number) => +instante >= INICIO_GRATIS_DEZEMBRO && +instante < FIM_GRATIS_DEZEMBRO;
export const adesaoNoPeriodo = (instante: Date) => +instante >= INICIO_ADESAO && +instante < FIM_GRATIS_DEZEMBRO;
export const inicioInatividade = (agora: Date) => new Date(+agora - 90 * DIA_MS);

/** A referência ensaiada é o valor de uma mensalidade dispensada, com arredondamento em centavos para baixo. */
export function calcularMultaSimulada(mensalidadeCentavos: number, aceite: Date, pedido: Date) {
  if (+pedido <= +aceite + 7 * DIA_MS) return 0;
  const faltantes = FINS_DE_COMPETENCIA.filter(fim => +pedido < fim).length;
  return Math.floor(mensalidadeCentavos * faltantes / FINS_DE_COMPETENCIA.length);
}

export function motivoInelegibilidade(p: { jaAderiu: boolean; assinaturaAberta: boolean; cancelamentoRecente: boolean }) {
  if (p.jaAderiu) return { codigo: "adesao_existente", mensagem: "Já existe uma adesão a esta oferta neste cadastro." };
  if (p.assinaturaAberta) return { codigo: "assinatura_existente", mensagem: "A oferta é para clientes sem assinatura em andamento." };
  if (p.cancelamentoRecente) return { codigo: "cancelamento_recente", mensagem: "É preciso aguardar 90 dias desde o último cancelamento de assinatura." };
  return null;
}

export function avaliarLimiteDezembro(usos: { inicio: number }[], limite: number) {
  const usados = usos.filter(({ inicio }) => dentroDoPeriodoGratis(inicio)).length;
  return { usados, restantes: Math.max(0, limite - usados) };
}

export const erroUsarOfertaDezembro = () => new ErroNegocio(
  "Confira o contrato e as opções de cancelamento na página Dezembro Grátis.",
  409, "oferta_dezembro_contrato",
);
