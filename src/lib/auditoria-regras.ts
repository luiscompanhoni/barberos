/**
 * Regras puras da auditoria: o que mudou (antes -> depois) e textos para a tela. Testadas em tests/auditoria.test.ts.
 */

type Registro = Record<string, unknown>;

/** Valor comparavel (datas viram texto ISO). */
const comparavel = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);

/**
 * So os campos de `novos` que mudaram em relacao a `atual`: { antes, depois } com esses campos, ou null se nada
 * mudou. Campos fora de `novos` (nao enviados) nao contam.
 */
export function mudancas(atual: Registro, novos: Registro, ignorar: string[] = []) {
  const antes: Registro = {}, depois: Registro = {};
  for (const [k, v] of Object.entries(novos)) {
    if (v === undefined || ignorar.includes(k)) continue;
    const a = comparavel(atual[k]), d = comparavel(v);
    if (JSON.stringify(a) === JSON.stringify(d)) continue;
    antes[k] = a;
    depois[k] = d;
  }
  return Object.keys(depois).length ? { antes, depois } : null;
}

export const ENTIDADES: Record<string, string> = {
  adicional_comissao: "Comissão diferenciada", agendamento: "Atendimento", assinatura: "Assinatura", barbeiro: "Barbeiro",
  bloqueio: "Agenda fechada", caixa: "Caixa", checklist: "Checklist", checklist_item: "Tarefa do checklist", checklist_pessoa: "Funcionário",
  cliente: "Cliente", comanda: "Comanda", comissao: "Comissão", configuracao: "Configuração", despesa: "Despesa", estorno: "Estorno",
  financeiro: "Financeiro", folha: "Folha", folha_lancamento: "Lançamento da folha", folha_pagamento: "Folha", link_pagamento: "Link de pagamento",
  plano: "Plano", produto: "Produto", retencao: "Retenção", servico: "Serviço", usuario: "Acesso",
};

const ACOES: Record<string, string> = {
  abrir: "abriu", abrir_caixa: "abriu o caixa", agendar_cancelamento: "agendou o cancelamento", alterar: "alterou", assinar: "assinou",
  cancelar: "cancelou", cancelar_link_pagamento: "cancelou o link", cancelar_pagamento: "cancelou o pagamento", cancelar_pelo_cliente: "cancelou (cliente)",
  cancelar_por_fechamento: "cancelou ao fechar a agenda", checklist_ajuste_pontos: "ajustou pontos", checklist_configurar: "configurou",
  checklist_novo_link: "gerou novo link", checklist_validado: "validou", checklist_re: "deu ré", checklist_desfazer_avaliacao: "desfez a avaliação",
  conciliar: "conferiu", conciliar_desfazer: "desfez a conferência", configurar: "configurou", confirmar_cliente: "confirmou (cliente)", criar: "criou",
  criar_link_pagamento: "criou", desconto: "mudou o desconto", despesa_criar: "lançou", despesa_editar: "editou", despesa_estornar: "estornou",
  despesa_excluir: "excluiu", despesa_pagar: "pagou", enviar_link_pagamento: "enviou", estorno_aprovado: "aprovou", estorno_direto: "estornou direto",
  estorno_executado: "executou", estorno_falhou: "falhou", estorno_manual: "marcou como feito por fora", estorno_pedido: "pediu", estorno_recusado: "recusou",
  excecao: "mudou o horário do dia", expediente: "mudou a semana padrão", fechar: "fechou", fechar_agenda: "fechou a agenda", fechar_caixa: "fechou o caixa",
  foto_remover: "removeu a foto", foto_trocar: "trocou a foto", gerar_pagamento_antecipado: "gerou pagamento antecipado", indicacao: "registrou indicação",
  link_pagamento_recebido: "recebeu", pagamento: "registrou pagamento", pagamento_antecipado_creditado: "creditou o pago antes",
  pagamento_antecipado_recebido: "recebeu o pago antes", pagar_link_pagamento: "pagou", reabrir_agenda: "reabriu a agenda", remarcar_pelo_cliente: "remarcou (cliente)",
  remover_excecao: "voltou ao horário padrão", remover_item: "removeu item", rh_adicional_criar: "registrou", rh_adicional_encerrar: "encerrou",
  rh_adicional_excluir: "apagou", rh_comissoes_configurar: "mudou as regras", rh_comissoes_extras: "mudou assinaturas e produtos", rh_ficha: "mudou a ficha",
  rh_folha_fechar: "fechou", rh_folha_paga: "pagou", rh_folha_reabrir: "reabriu", rh_lancamento: "lançou", rh_lancamento_excluir: "excluiu lançamento",
  roleta_configurar: "configurou a roleta", roleta_entregar: "entregou brinde", roleta_girar: "girou a roleta", sangria: "fez sangria",
  sangria_estornada: "estornou sangria", senha_temporaria: "gerou senha temporária", status: "mudou a situação", suprimento: "fez suprimento",
  taxas_recebimento: "mudou taxas e prazos", transferir_por_fechamento: "transferiu ao fechar a agenda", usar_saldo: "usou saldo",
  whatsapp_desconectar: "desconectou o WhatsApp", ativar: "ativou", desativar: "desativou",
};

/** "Comanda · mudou o desconto" (codigos desconhecidos aparecem legiveis). */
export function descreverAcao(acao: string, entidade: string) {
  const e = ENTIDADES[entidade] ?? entidade.replace(/_/g, " ");
  const a = ACOES[acao] ?? acao.replace(/^retencao_/, "retenção: ").replace(/_/g, " ");
  return `${e} · ${a}`;
}

const CAMPOS: Record<string, string> = {
  precoCentavos: "preço", valorCentavos: "valor", descontoCentavos: "desconto", salarioCentavos: "salário", custoCentavos: "custo",
  duracaoMin: "duração (min)", nome: "nome", ativo: "ativo", percentualBps: "percentual", pontosBps: "pontos", fim: "fim", inicio: "início",
};

/** Valor para a tela: centavos em R$, Bps em %, booleano em sim/não. */
export function formatarCampo(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "number" && /Centavos$/.test(campo)) return (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (typeof v === "number" && /Bps$/.test(campo)) return `${(v / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return v.slice(0, 10).split("-").reverse().join("/");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Linhas "preço: R$ 65,00 → R$ 50,00" quando o registro tem antes/depois. */
export function linhasDeMudanca(dados: unknown): string[] {
  if (!dados || typeof dados !== "object") return [];
  const { antes, depois } = dados as { antes?: Registro; depois?: Registro };
  if (!depois || typeof depois !== "object" || Array.isArray(depois)) return [];
  return Object.keys(depois).map((k) => {
    const rotulo = CAMPOS[k] ?? k;
    const a = antes && typeof antes === "object" && k in antes ? formatarCampo(k, antes[k]) : null;
    return a === null ? `${rotulo}: ${formatarCampo(k, depois[k])}` : `${rotulo}: ${a} → ${formatarCampo(k, depois[k])}`;
  });
}

/** "iPhone · Safari", "Android · Chrome", "Windows · Edge" (aparelho e navegador do user agent). */
export function resumoAparelho(ua: string | null | undefined) {
  if (!ua) return null;
  const sistema = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : null;
  const navegador = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /OPR\//.test(ua) ? "Opera" : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : null;
  return [sistema, navegador].filter(Boolean).join(" · ") || ua.slice(0, 40);
}
