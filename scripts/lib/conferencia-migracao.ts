import { cpfValido, emailValido, nomeChave, telefoneValido } from "../dados/cadastros-verificados";

type Colunas = Record<string, string>;
export type FonteMigracao = { linha: number; colunas: Colunas | null };
type Cadastro = { id: string; nome: string; telefone: string | null; cpf: string | null; email: string | null; dataNascimento: string | null; observacoes: string | null; excluidoEm: Date | null };
type Contrato = { id: string; clienteId: string; plano: string; status: string; gatewayId: string | null; proximoVencimento: string | null; ultimoPagamento: string | null };

/** Lê também campos com aspas, vírgulas e quebras de linha. A referência é o número do registro no CSV, contando o cabeçalho. */
export function lerFonteMigracao(texto: string, obrigatorias: string[], separador: "," | ";" = ",") {
  const registros: string[][] = [];
  let campo = "", registro: string[] = [], emAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') {
      if (emAspas && texto[i + 1] === '"') { campo += '"'; i++; }
      else emAspas = !emAspas;
    } else if (!emAspas && (c === separador || c === "\n")) {
      registro.push(campo.replace(/\r$/, "")); campo = "";
      if (c === "\n") { registros.push(registro); registro = []; }
    } else campo += c;
  }
  if (emAspas) throw new Error("CSV com aspas não fechadas. Confira a integridade do arquivo.");
  if (campo || registro.length) registros.push([...registro, campo.replace(/\r$/, "")]);
  const cabecalho = (registros.shift() ?? []).map(nomeChave);
  const faltantes = obrigatorias.filter(c => !cabecalho.includes(nomeChave(c)));
  if (faltantes.length) throw new Error(`Colunas obrigatórias ausentes: ${faltantes.join(", ")}.`);
  if (new Set(cabecalho).size !== cabecalho.length) throw new Error("CSV com colunas duplicadas.");
  const linhas: FonteMigracao[] = registros.flatMap((r, i) => r.length === 1 && !r[0].trim() ? [] : [{
    linha: i + 2,
    colunas: r.length === cabecalho.length ? Object.fromEntries(cabecalho.map((k, j) => [k, r[j].trim()])) : null,
  }]);
  return { cabecalho, linhas };
}

export function dataDaFonte(s: string | undefined) {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : s;
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const data = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(+data) && data.toISOString().slice(0, 10) === iso ? iso : null;
}

function indice<T>(itens: T[], chave: (item: T) => string | null) {
  const valores = new Map<string, T[]>();
  for (const item of itens) {
    const k = chave(item);
    if (k) valores.set(k, [...(valores.get(k) ?? []), item]);
  }
  return valores;
}

function valor(c: Colunas, chave: string) {
  const v = c[chave];
  return v && !["n/a", "-"].includes(v.toLowerCase()) ? v : null;
}

function indiceIdentidade(cadastros: Cadastro[]) {
  return {
    cpf: indice(cadastros, c => cpfValido(c.cpf)),
    telefone: indice(cadastros, c => telefoneValido(c.telefone)),
    nome: indice(cadastros, c => nomeChave(c.nome)),
  };
}

function localizar(c: Colunas, nome: string, indices: ReturnType<typeof indiceIdentidade>) {
  const cpf = cpfValido(valor(c, "cpf")), telefone = telefoneValido(valor(c, "telefone"));
  const cp = cpf ? indices.cpf.get(cpf) ?? [] : [], tp = telefone ? indices.telefone.get(telefone) ?? [] : [];
  const candidato = cp[0] ?? tp[0];
  if (cp.length > 1 || tp.length > 1 || (cp[0] && tp[0] && cp[0].id !== tp[0].id)) return { motivo: "Identidade ambígua" };
  if (!candidato) {
    const candidatos = indices.nome.get(nomeChave(nome)) ?? [];
    return { motivo: candidatos.length ? "Vínculo por nome exige confirmação" : "Cadastro não localizado" };
  }
  if (candidato.excluidoEm) return { motivo: "Cadastro excluído no BarberOS" };
  if (!nomeChave(nome).includes(" ") || nomeChave(candidato.nome) !== nomeChave(nome)) return { motivo: "Nome incompleto ou divergente" };
  if (cpf && candidato.cpf && cpfValido(candidato.cpf) !== cpf) return { motivo: "CPF divergente" };
  if (telefone && candidato.telefone && telefoneValido(candidato.telefone) !== telefone) return { motivo: "Telefone divergente" };
  if (candidato.observacoes?.includes("Outros nomes com este telefone")) return { motivo: "Cadastro com histórico de telefone compartilhado" };
  return { cliente: candidato };
}

export function conferirCadastros(fonte: FonteMigracao[], cadastros: Cadastro[]) {
  const indices = indiceIdentidade(cadastros);
  const cpfs = indice(fonte, l => l.colunas && cpfValido(valor(l.colunas, "cpf")));
  const telefones = indice(fonte, l => l.colunas && telefoneValido(valor(l.colunas, "telefone")));
  const ids = indice(fonte, l => l.colunas && valor(l.colunas, "id"));
  return fonte.map(({ linha, colunas: c }) => {
    if (!c) return { linha, origemId: null, clienteId: null, pendencias: ["Colunas inconsistentes"] };
    const origemId = valor(c, "id");
    const pendencias: string[] = [];
    const cpf = cpfValido(valor(c, "cpf")), tel = telefoneValido(valor(c, "telefone"));
    if (!tel) pendencias.push("Telefone inválido ou ausente na origem");
    if ((tel && (telefones.get(tel)?.length ?? 0) > 1) || (cpf && (cpfs.get(cpf)?.length ?? 0) > 1) || (origemId && (ids.get(origemId)?.length ?? 0) > 1)) {
      return { linha, origemId, clienteId: null, pendencias: [...pendencias, "Identificador repetido na origem"] };
    }
    const { cliente, motivo } = localizar(c, c.nome, indices);
    if (!cliente) return { linha, origemId, clienteId: null, pendencias: [...pendencias, motivo!] };
    if (tel && telefoneValido(cliente.telefone) !== tel) pendencias.push("Telefone divergente no BarberOS");
    if (valor(c, "cpf") && (!cpf || cpfValido(cliente.cpf) !== cpf)) pendencias.push("CPF a conferir");
    const email = valor(c, "email"), nascimento = valor(c, "data de nascimento");
    if (email && (!emailValido(email) || emailValido(cliente.email) !== emailValido(email))) pendencias.push("E-mail a conferir");
    if (nascimento && (!dataDaFonte(nascimento) || dataDaFonte(nascimento) !== cliente.dataNascimento)) pendencias.push("Nascimento a conferir");
    return { linha, origemId, clienteId: cliente.id, pendencias };
  });
}

const statusDaFonte = new Map([
  ["em dia", "ATIVA"], ["boleto compensado", "ATIVA"], ["pago fora do sistema", "ATIVA"],
  ["atrasado", "ATRASADA"], ["atrasada", "ATRASADA"], ["em atraso", "ATRASADA"], ["inadimplente", "ATRASADA"],
  ["cancelado", "CANCELADA"], ["cancelada", "CANCELADA"], ["aguardando primeiro pagamento", "PENDENTE"],
]);

export function conferirAssinantes(fonte: FonteMigracao[], cadastros: Cadastro[], contratos: Contrato[]) {
  const indices = indiceIdentidade(cadastros);
  const porCliente = indice(contratos.filter(a => !/^(cashbarber|celcash):hist:/.test(a.gatewayId ?? "")), a => a.clienteId);
  const referencia = (c: Colunas) => valor(c, "id da assinatura") ?? valor(c, "id do contrato");
  const ids = indice(fonte, l => l.colunas && referencia(l.colunas));
  const cpfs = indice(fonte, l => l.colunas && cpfValido(valor(l.colunas, "cpf")));
  const telefones = indice(fonte, l => l.colunas && telefoneValido(valor(l.colunas, "telefone")));
  const linhas = fonte.map(({ linha, colunas: c }) => {
    if (!c) return { linha, origemId: null, clienteId: null, assinaturaId: null, statusOrigem: null, vencimentoOrigem: null, vencimentoBarberOS: null, pendencias: ["Colunas inconsistentes"] };
    const origemId = referencia(c);
    const statusOrigem = statusDaFonte.get(nomeChave(c.status)) ?? null;
    const vencimentoOrigem = dataDaFonte(c["proximo vencimento"]);
    const ultimoPagamento = dataDaFonte(c["ultimo pagamento"]);
    const pendencias: string[] = [];
    if (!origemId) pendencias.push("ID do contrato ausente na origem");
    if (!valor(c, "plano")) pendencias.push("Plano ausente na origem");
    if (!statusOrigem) pendencias.push("Situação da origem não reconhecida");
    if (statusOrigem !== "CANCELADA" && !vencimentoOrigem) pendencias.push("Próximo vencimento ausente ou inválido na origem");
    if ((statusOrigem === "ATIVA" || statusOrigem === "ATRASADA") && !ultimoPagamento) pendencias.push("Último pagamento ausente ou inválido na origem");
    if (origemId && (ids.get(origemId)?.length ?? 0) > 1) pendencias.push("Contrato repetido na origem");
    const cpf = cpfValido(valor(c, "cpf")), tel = telefoneValido(valor(c, "telefone"));
    if ((valor(c, "cpf") && !cpf) || (valor(c, "telefone") && !tel)) pendencias.push("CPF ou telefone inválido na origem");
    const pares = [...(cpf ? cpfs.get(cpf) ?? [] : []), ...(tel ? telefones.get(tel) ?? [] : [])];
    const conflito = pares.some(p => p.colunas && (nomeChave(p.colunas.cliente) !== nomeChave(c.cliente) ||
      (cpf && cpfValido(valor(p.colunas, "cpf")) && cpfValido(valor(p.colunas, "cpf")) !== cpf)));
    const { cliente, motivo } = conflito ? { cliente: null, motivo: "Identificador compartilhado por titulares diferentes na origem" } : localizar(c, c.cliente, indices);
    if (!cliente) pendencias.push(motivo!);
    const candidatos = cliente ? (porCliente.get(cliente.id) ?? []).filter(a => statusOrigem === "CANCELADA" ? a.status === "CANCELADA" : a.status !== "CANCELADA") : [];
    const contrato = candidatos.length === 1 ? candidatos[0] : null;
    if (cliente && !contrato) pendencias.push(candidatos.length ? "Múltiplos contratos no BarberOS" : "Contrato não localizado no BarberOS");
    if (contrato) {
      if (valor(c, "plano") && nomeChave(c.plano) !== nomeChave(contrato.plano)) pendencias.push("Plano divergente");
      if (statusOrigem && statusOrigem !== contrato.status) pendencias.push("Situação divergente");
      if (vencimentoOrigem && vencimentoOrigem !== contrato.proximoVencimento) pendencias.push("Próximo vencimento divergente");
      if (ultimoPagamento && ultimoPagamento !== contrato.ultimoPagamento) pendencias.push("Último pagamento divergente");
    }
    return { linha, origemId, clienteId: cliente?.id ?? null, assinaturaId: contrato?.id ?? null, statusOrigem, vencimentoOrigem, vencimentoBarberOS: contrato?.proximoVencimento ?? null, pendencias };
  });
  const porContrato = indice(linhas, l => l.assinaturaId);
  for (const linha of linhas) {
    if (linha.assinaturaId && (porContrato.get(linha.assinaturaId)?.length ?? 0) > 1) linha.pendencias.push("Várias linhas apontam para o mesmo contrato no BarberOS");
  }
  return linhas;
}
