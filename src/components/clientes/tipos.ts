export type CadastroCliente = {
  id: string; nome: string; telefone: string; email: string | null; cpfMascarado: string | null;
  endereco: string | null; dataNascimento: string | null; observacoes: string | null;
  criadoEm: string; fotoVersao: number; temAcesso: boolean; cadastroCompleto: boolean;
};
export type PlanoCliente = { id: string; status: string; plano: { nome: string }; proximoVencimento?: string | null };
export type ListaClientes = { total: number; pagina: number; paginas: number;
  clientes: (CadastroCliente & { assinatura: PlanoCliente | null; ultimaVisita: string | null })[] };
export type DetalheCliente = { cliente: CadastroCliente; assinaturas: PlanoCliente[]; atendimentos: number; faltas: number;
  agendamentos: { id: string; inicio: string; status: string; servico: { nome: string }; barbeiro: { nome: string };
    adicionais: { servico: { nome: string } }[] }[] };
export const dataCliente = (d: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" }).format(new Date(d));
