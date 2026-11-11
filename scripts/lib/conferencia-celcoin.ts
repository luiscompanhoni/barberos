import { cpfValido, emailValido, nomeChave, telefoneValido } from "../dados/cadastros-verificados";
import { dataDaFonte, type FonteMigracao } from "./conferencia-migracao";

type Colunas = NonNullable<FonteMigracao["colunas"]>;
const PAGAS = new Set(["capturada na operadora", "boleto compensado", "pix pago"]);
const EM_ABERTO = new Set(["aguardando pagamento", "em aberto", "pix em aberto", "negada na operadora", "boleto baixado por decurso de prazo", "erro ao processar cobranca"]);
const ESTORNADAS = new Set(["estornada na operadora", "estornada fora do sistema", "estorno por chargeback", "solicitado o estorno na operadora"]);
const CANCELADAS = new Set(["cancelada ao cancelar a cobranca", "cancelada manualmente"]);
const STATUS_CONTRATO = new Set(["ativa", "inativa", "cancelada", "encerrada", "interrompida", "aguardando pagamento"]);

const codigo = (s: string | undefined) => s && /^[1-9]\d{0,15}$/.test(s) ? s : null;
const telefones = (valores: (string | undefined)[]) => [...new Set(valores.map(v => telefoneValido(v ?? null)).filter((v): v is string => !!v))];
function identidade(c: Colunas, fonte: "cash" | "celcoin") {
  const documento = (fonte === "cash" ? c.cpf : c["documento do cliente"]) ?? "";
  const cpf = cpfValido(documento);
  return {
    nome: nomeChave((fonte === "cash" ? c.nome : c["nome do cliente"]) ?? ""), cpf,
    documentoInvalido: /\d/.test(documento) && !/[*•]/.test(documento) && !cpf,
    telefones: telefones(fonte === "cash" ? [c.telefone] : [c["celular do cliente"], c["telefone do cliente"]]),
  };
}
type Identidade = ReturnType<typeof identidade>;

function centavos(s: string | undefined) {
  if (!s || !/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(s)) return null;
  const v = Number(s.replace(/[.,]/g, ""));
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}

function dataDoStatus(s: string | undefined) {
  const m = s?.match(/^(\d{2}\/\d{2}\/\d{4})(?: - (?:[01]\d|2[0-3]):[0-5]\d)?$/);
  return m ? dataDaFonte(m[1]) : dataDaFonte(s);
}

function agrupar<T>(registros: T[], chaves: (r: T) => (string | null)[]) {
  const mapa = new Map<string, T[]>();
  for (const r of registros) for (const k of new Set(chaves(r))) {
    if (!k) continue;
    const xs = mapa.get(k);
    if (xs) xs.push(r);
    else mapa.set(k, [r]);
  }
  return mapa;
}

function titularCoincide(a: Identidade, b: Identidade) {
  if (!a.nome.includes(" ") || a.nome !== b.nome) return false;
  if (a.documentoInvalido || b.documentoInvalido) return false;
  if (a.cpf && b.cpf && a.cpf !== b.cpf) return false;
  if (a.telefones.length && b.telefones.length && !a.telefones.some(t => b.telefones.includes(t))) return false;
  return !!(a.cpf && a.cpf === b.cpf) || a.telefones.some(t => b.telefones.includes(t));
}

function avancarCiclo(data: string, meses: number) {
  const [ano, mes, dia] = data.split("-").map(Number);
  const limite = new Date(Date.UTC(ano, mes + meses, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes - 1 + meses, Math.min(dia, limite))).toISOString().slice(0, 10);
}

function transacao({ linha, colunas: c }: FonteMigracao) {
  return {
    linha, id: codigo(c?.codigo), contrato: codigo(c?.["codigo do contrato venda"]),
    plano: nomeChave(c?.plano ?? ""), status: nomeChave(c?.status ?? ""),
    vencimento: dataDaFonte(c?.vencimento), estadoEm: dataDoStatus(c?.["data do status atual"]),
    valor: centavos(c?.valor), tid: c?.tid && !/^[-0]+$/.test(c.tid) ? c.tid : null, titular: c ? identidade(c, "celcoin") : null,
  };
}
type Transacao = ReturnType<typeof transacao>;

function classificarCiclo(ciclo: Transacao[], valorContrato: number | null, dataCorte: string) {
  const sucessos = ciclo.filter(t => PAGAS.has(t.status));
  const externos = ciclo.filter(t => t.status === "paga fora do sistema");
  if (sucessos.length > 1 || (sucessos.length && externos.length)) return "PAGAMENTOS_MULTIPLOS";
  if (ciclo.some(t => ESTORNADAS.has(t.status))) return "ESTORNO_OU_CHARGEBACK";
  if (ciclo.some(t => !PAGAS.has(t.status) && !EM_ABERTO.has(t.status) && !CANCELADAS.has(t.status) && t.status !== "paga fora do sistema")) return "STATUS_INDEFINIDO";
  if (sucessos.length === 1) {
    if (!valorContrato || sucessos[0].valor !== valorContrato) return "VALOR_DIVERGENTE";
    if (ciclo.some(t => EM_ABERTO.has(t.status))) return "OUTRA_TENTATIVA_EM_ABERTO";
    return "PAGAMENTO_CONFIRMADO_CELCOIN";
  }
  if (externos.length) return "PAGO_FORA_A_CONFERIR";
  if (ciclo.some(t => EM_ABERTO.has(t.status))) return ciclo[0].vencimento! < dataCorte ? "VENCIDO_SEM_PAGAMENTO" : "VENCE_NO_CORTE";
  return "CICLO_CANCELADO_A_CONFERIR";
}

/** Cruza arquivos sem gravar cadastros e sem transformar data do status em data de recebimento. */
export function conferirCelcoin(clientes: FonteMigracao[], contratos: FonteMigracao[], transacoes: FonteMigracao[], dataCorte: string) {
  if (dataDaFonte(dataCorte) !== dataCorte) throw new Error("Data de corte inválida.");
  const base = clientes.map(l => ({ linha: l.linha, id: codigo(l.colunas?.id), identidade: l.colunas ? identidade(l.colunas, "cash") : null }));
  const cpfs = agrupar(base, l => [l.identidade?.cpf ?? null]);
  const tels = agrupar(base, l => l.identidade?.telefones ?? []);
  const idsClientes = agrupar(base, l => [l.id]);
  const idsContratos = agrupar(contratos, l => [codigo(l.colunas?.codigo)]);
  const titularesAtivos = contratos.flatMap(l => l.colunas && nomeChave(l.colunas.status) === "ativa" ? [identidade(l.colunas, "celcoin")] : []);
  const cpfsCelcoin = agrupar(titularesAtivos, l => [l.cpf]);
  const telsCelcoin = agrupar(titularesAtivos, l => l.telefones);
  const listaTx = transacoes.map(transacao);
  const porContrato = agrupar(listaTx, t => [t.contrato]);
  const porTx = agrupar(listaTx, t => [t.id]);
  const porTid = agrupar(listaTx.filter(t => PAGAS.has(t.status) || ESTORNADAS.has(t.status)), t => [t.tid]);
  const linhas = contratos.map(({ linha, colunas: c }) => {
    const contratoId = codigo(c?.codigo);
    const titular = c ? identidade(c, "celcoin") : null;
    const candidatos = [...new Set([...(titular?.cpf ? cpfs.get(titular.cpf) ?? [] : []),
      ...(titular?.telefones.flatMap(t => tels.get(t) ?? []) ?? [])])];
    const relacionados = titular ? [...(titular.cpf ? cpfsCelcoin.get(titular.cpf) ?? [] : []),
      ...titular.telefones.flatMap(t => telsCelcoin.get(t) ?? [])] : [];
    const compartilhado = !!titular && relacionados.some(r => r.nome !== titular.nome || !!r.cpf && !!titular.cpf && r.cpf !== titular.cpf);
    const cadastrado = !compartilhado && candidatos.length === 1 && candidatos[0].id && idsClientes.get(candidatos[0].id)?.length === 1
      && candidatos[0].identidade && titular && titularCoincide(candidatos[0].identidade, titular) ? candidatos[0] : null;
    const vinculo = cadastrado ? "CONFERIDO" : compartilhado || candidatos.length ? "IDENTIDADE_DIVERGENTE_OU_AMBIGUA" : "SEM_VINCULO_COMPROVADO";
    const status = nomeChave(c?.status ?? "");
    const periodicidade = nomeChave(c?.periodicidade ?? "");
    const meses = periodicidade === "mensal" ? 1 : periodicidade === "trimestral" ? 3 : periodicidade === "anual" ? 12 : 0;
    const recorrencia = meses > 0;
    const refer = { linha, contratoId, clienteId: cadastrado?.id ?? null, vinculo, status, recorrencia };
    if (!c || !contratoId || (idsContratos.get(contratoId)?.length ?? 0) !== 1 || !STATUS_CONTRATO.has(status) || (!recorrencia && periodicidade !== "unica venda")) {
      return { ...refer, estado: "CONTRATO_INCONSISTENTE", vencimento: null, proximoVencimento: null, anterioresEmAberto: 0 };
    }
    if (!recorrencia || status !== "ativa") {
      return { ...refer, estado: "FORA_DOS_CONTRATOS_ATIVOS", vencimento: null, proximoVencimento: null, anterioresEmAberto: 0 };
    }
    const txs = porContrato.get(contratoId) ?? [];
    const validas = txs.filter(t => t.vencimento && t.estadoEm && t.estadoEm <= dataCorte);
    const ciclos = agrupar(validas.filter(t => t.vencimento! <= dataCorte), t => [t.vencimento]);
    const vencimentos = [...ciclos.keys()].sort();
    const vencimento = vencimentos.at(-1) ?? null;
    const ciclo = vencimento ? ciclos.get(vencimento)! : [];
    const problemaTx = (t: Transacao) => !t.id || porTx.get(t.id)?.length !== 1 || !!t.tid && (porTid.get(t.tid)?.length ?? 0) > 1
      || !t.valor || !t.titular || !titular || !titularCoincide(t.titular, titular)
      || !t.plano || t.plano !== nomeChave(c.plano ?? "");
    const proximoVencimento = validas.filter(t => t.vencimento! > dataCorte && EM_ABERTO.has(t.status) && !problemaTx(t)).map(t => t.vencimento!).sort()[0] ?? null;
    let estado = ciclo.length ? classificarCiclo(ciclo, centavos(c.valor), dataCorte) : "SEM_CICLO_NO_CORTE";
    if (estado === "PAGAMENTO_CONFIRMADO_CELCOIN" && vencimento && avancarCiclo(vencimento, meses) < dataCorte) {
      estado = "SEM_CICLO_RECENTE_COMPROVADO";
    }
    if (txs.some(t => !t.vencimento || !t.estadoEm || (t.vencimento <= dataCorte && t.estadoEm > dataCorte)) || ciclo.some(problemaTx)) estado = "TRANSACAO_A_CONFERIR";
    const anterioresEmAberto = vencimentos.slice(0, -1).filter(d => {
      const xs = ciclos.get(d)!;
      return xs.some(t => !CANCELADAS.has(t.status)) && (xs.some(problemaTx) || classificarCiclo(xs, centavos(c.valor), dataCorte) !== "PAGAMENTO_CONFIRMADO_CELCOIN");
    }).length;
    return { ...refer, estado, vencimento, proximoVencimento, anterioresEmAberto };
  });
  const vinculos = agrupar(linhas.filter(l => l.recorrencia && l.status === "ativa"), l => [l.clienteId]);
  const comIdentidadeValidada = linhas.filter(l => l.recorrencia && l.status === "ativa" && l.vinculo === "CONFERIDO" && vinculos.get(l.clienteId!)?.length === 1);
  const pendenciasCadastros = base.flatMap((l, i) => {
    const c = clientes[i].colunas;
    const motivos: string[] = [];
    if (!c) motivos.push("LINHA_INVALIDA");
    else {
      if (!l.id || idsClientes.get(l.id)?.length !== 1) motivos.push("ID_A_CONFERIR");
      if (!l.identidade?.nome.includes(" ")) motivos.push("NOME_INCOMPLETO");
      if (!l.identidade?.telefones.length) motivos.push("TELEFONE_INVALIDO_OU_AUSENTE");
      if (l.identidade?.telefones.some(t => (tels.get(t)?.length ?? 0) > 1)) motivos.push("TELEFONE_REPETIDO");
      if (!/\d/.test(c.cpf ?? "")) motivos.push("CPF_NAO_INFORMADO");
      else if (!l.identidade?.cpf) motivos.push("CPF_INVALIDO");
      if (l.identidade?.cpf && (cpfs.get(l.identidade.cpf)?.length ?? 0) > 1) motivos.push("CPF_REPETIDO");
      if (c.email && !emailValido(c.email)) motivos.push("EMAIL_INVALIDO");
      if (c["data de nascimento"] && !dataDaFonte(c["data de nascimento"])) motivos.push("NASCIMENTO_INVALIDO");
    }
    return motivos.length ? [{ linha: l.linha, clienteId: l.id, motivos }] : [];
  });
  return {
    clientes: base.length,
    pendenciasCadastros,
    contratos: linhas,
    contratosInconsistentes: linhas.filter(l => l.estado === "CONTRATO_INCONSISTENTE").length,
    clientesComMaisDeUmContratoAtivo: [...vinculos.values()].filter(l => l.length > 1).length,
    transacoes: listaTx.length,
    transacoesSemContratoIdentificado: listaTx.filter(t => !t.contrato || idsContratos.get(t.contrato)?.length !== 1).length,
    ciclosConfirmadosComVinculo: comIdentidadeValidada.filter(l => l.estado === "PAGAMENTO_CONFIRMADO_CELCOIN").length,
    ciclosConfirmadosSemPendenciaAnterior: comIdentidadeValidada.filter(l => l.estado === "PAGAMENTO_CONFIRMADO_CELCOIN" && !l.anterioresEmAberto).length,
    ciclosVencidosComVinculo: comIdentidadeValidada.filter(l => l.estado === "VENCIDO_SEM_PAGAMENTO").length,
  };
}
