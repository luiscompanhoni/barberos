export type ServicoPedido = { id: string; nome: string; duracaoMin: number; precoCentavos: number };
export type ProfissionalPedido = { id: string; nome: string };
export type CatalogoPedido = { janelaDias: number; servicos: (ServicoPedido & { barbeiros: ProfissionalPedido[] })[] };
export type PedidoResumo = {
  id: string; status: string; dataPreferida: string; horaPreferida: string; observacao: string | null;
  servicos: ServicoPedido[]; barbeiro: ProfissionalPedido | null;
  cliente?: { id: string; nome: string; telefone: string };
  agendamento: { inicio: string; status: string; barbeiro: { nome: string } } | null;
};
export type ListaPedidos = { pedidos: PedidoResumo[]; profissionais: (ProfissionalPedido & { servicos: { servicoId: string }[] })[] };
