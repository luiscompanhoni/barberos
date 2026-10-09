export type Forma = "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO";
export type ModoMaquininha = "stone" | "simulada" | "manual";

export type Produto = {
  id: string;
  nome: string;
  categoria: "BAR" | "LOJA" | "USO_INTERNO";
  precoCentavos: number;
  custoCentavos: number;
  estoque: number;
  estoqueMinimo: number;
  unidade: string;
  codigoBarras: string | null;
  ativo: boolean;
};

export type Item = {
  id: string;
  produtoId: string | null;
  agendamentoId: string | null;
  descricao: string;
  quantidade: number;
  precoUnitCentavos: number;
  produto: { nome: string; categoria: Produto["categoria"]; estoque: number } | null;
};

export type Pagamento = {
  id: string;
  forma: Forma;
  valorCentavos: number;
  status: "AGUARDANDO" | "PAGO" | "CANCELADO";
  gatewayPedidoId: string | null;
  /** Pago online antes do atendimento (link de Pix/cartao). */
  antecipadoId?: string | null;
  /** Pago a distancia pelo link de pagamento. */
  linkPagamentoId?: string | null;
  nsu: string | null;
  bandeira: string | null;
  criadoEm: string;
};

export type Resumo = {
  subtotal: number; desconto: number; total: number; pago: number;
  aguardando: number; falta: number; troco: number; podeFechar: boolean;
};

export type Comanda = {
  id: string;
  numero: number;
  status: "ABERTA" | "FECHADA" | "CANCELADA";
  nomeAvulso: string | null;
  cliente: { id: string; nome: string; telefone: string } | null;
  descontoCentavos: number;
  abertaEm: string;
  fechadaEm: string | null;
  itens: Item[];
  pagamentos: Pagamento[];
  resumo: Resumo;
  /** Saldo do cliente (cashback + indicacao) que pode virar desconto nesta comanda. */
  saldoCliente?: number;
  /** Links de pagamento em aberto desta comanda. */
  linksPagamento?: { id: string; token: string; url: string | null; valorCentavos: number; expiraEm: string; criadoEm: string }[];
};

export const FORMAS: { valor: Forma; rotulo: string }[] = [
  { valor: "PIX", rotulo: "Pix" },
  { valor: "CREDITO", rotulo: "Crédito" },
  { valor: "DEBITO", rotulo: "Débito" },
  { valor: "DINHEIRO", rotulo: "Dinheiro" },
];
export const ROTULO_FORMA: Record<Forma, string> = { PIX: "Pix", CREDITO: "Crédito", DEBITO: "Débito", DINHEIRO: "Dinheiro" };
export const CATEGORIAS: Record<Produto["categoria"], string> = { BAR: "Bar", LOJA: "Loja", USO_INTERNO: "Uso interno" };

export const nomeDaComanda = (c: Pick<Comanda, "cliente" | "nomeAvulso">) => c.cliente?.nome || c.nomeAvulso || "Cliente";
