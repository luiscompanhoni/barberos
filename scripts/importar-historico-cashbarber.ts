/**
 * Importa o historico do CashBarber (relatorios exportados em CSV, janelas de ate 60 dias):
 * - agend_*.csv  = Relatorios > Historico de agendamentos (relatorio03)
 * - mov_*.csv    = Financeiro > Movimentacoes (relatorio01): uma linha por forma de pagamento de cada comanda
 *
 * O que entra:
 * - agendamentos passados (Finalizado -> CONCLUIDO, Cancelado -> CANCELADO, faltou/nao finalizado -> FALTOU),
 *   com o servico "Atendimento (CashBarber)" (o relatorio nao diz qual servico foi) e preco zero;
 * - comandas fechadas com um item (o total) e os pagamentos por forma; ligadas ao cliente e ao atendimento do dia.
 * O que NAO acontece: nenhuma mensagem sai. Reativacao e retorno ficam marcados como "nao enviados" para a
 * ultima visita importada de cada cliente (so voltam a valer depois de uma visita nova no BarberOS).
 *
 * Na troca de sistema: --ate=agora e --futuros trazem tambem os horarios ainda marcados no CashBarber
 * (MARCADO/CONFIRMADO, recebem os lembretes do BarberOS). Agradecimento e aviso de falta dos atendimentos
 * importados das ultimas horas ficam marcados como "nao enviados".
 *
 * Ids fixos (cba_/cbc_): rodar de novo nao duplica. Por padrao so mostra o que faria; --aplicar grava.
 * Os CSVs tem dados pessoais: nao copiar para dentro do projeto.
 * Rodar: DATABASE_URL=... npx tsx scripts/importar-historico-cashbarber.ts <pasta-dos-csv> [--ate=2026-10-11|agora] [--futuros] [--aplicar]
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient, type FormaRecebimento, type StatusAgendamento } from "@prisma/client";

const db = new PrismaClient();
const SERVICO = "Atendimento (CashBarber)";
const MARCA = "Importado do CashBarber";
const MIN = 60_000;

function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo.replace(/\r$/, "")); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function telefoneBr(s: string): string | null {
  let d = (s || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d.length === 11 && d[2] === "9" && !/^0/.test(d) ? `55${d}` : null;
}

/** "dd/mm/aaaa hh:mm" no horario de Brasilia (UTC-3, sem horario de verao). */
function instante(s: string): Date {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Data inválida: ${s}`);
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 3, +m[5]));
}
const diaLocal = (d: Date) => new Date(+d - 3 * 3_600_000).toISOString().slice(0, 10);
const centavos = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100);
const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const id = (prefixo: string, ...partes: string[]) => `${prefixo}${createHash("sha1").update(partes.join("|")).digest("hex").slice(0, 22)}`;

const FORMA: Record<string, FormaRecebimento> = { Pix: "PIX", Dinheiro: "DINHEIRO", "Cartão de débito": "DEBITO", "Cartão de crédito": "CREDITO" };

/**
 * Linhas de todos os CSVs com o prefixo. Janelas que se sobrepoem trazem a mesma linha em dois arquivos:
 * cada linha conta o maximo de vezes que aparece num arquivo so (linha repetida dentro do arquivo e real).
 */
function ler(pasta: string, prefixo: string) {
  const vezes = new Map<string, { linha: string[]; n: number }>();
  for (const f of readdirSync(pasta).filter((f) => f.startsWith(prefixo) && f.endsWith(".csv"))) {
    const noArquivo = new Map<string, number>();
    for (const l of lerCsv(readFileSync(join(pasta, f), "utf8")).slice(1).filter((l) => l.length >= 8)) {
      const k = l.join("\u0001");
      noArquivo.set(k, (noArquivo.get(k) ?? 0) + 1);
      if (!vezes.has(k)) vezes.set(k, { linha: l, n: 0 });
    }
    for (const [k, n] of noArquivo) vezes.get(k)!.n = Math.max(vezes.get(k)!.n, n);
  }
  return [...vezes.values()].flatMap(({ linha, n }) => Array.from({ length: n }, () => linha));
}

async function main() {
  const pasta = process.argv[2];
  if (!pasta) throw new Error("Informe a pasta com os CSVs.");
  const aplicar = process.argv.includes("--aplicar");
  const agora = new Date();
  const ateArg = process.argv.find((a) => a.startsWith("--ate="))?.slice(6) ?? "2026-10-11";
  const ate = ateArg === "agora" ? agora : new Date(`${ateArg}T03:00:00Z`);
  const futuros = process.argv.includes("--futuros");

  // ---- cadastros do sistema
  const barbeiros = await db.barbeiro.findMany({ select: { id: true, nome: true } });
  const barbeiroDe = (nome: string) => barbeiros.find((b) => normal(nome).startsWith(normal(b.nome)))?.id ?? null;
  const clientes = await db.cliente.findMany({ select: { id: true, telefone: true, nome: true } });
  const porTelefone = new Map(clientes.map((c) => [c.telefone, c.id]));
  const porNome = new Map<string, Set<string>>();
  const juntarNome = (nome: string, cid: string) => porNome.set(normal(nome), (porNome.get(normal(nome)) ?? new Set()).add(cid));
  for (const c of clientes) juntarNome(c.nome, c.id);

  // ---- agendamentos
  type Ag = { id: string; barbeiroId: string; clienteId: string; inicio: Date; fim: Date; status: StatusAgendamento; origem: "SITE" | "RECEPCAO"; telefone: string; futuro: boolean };
  const novosClientes: Prisma.ClienteCreateManyInput[] = [];
  const ags = new Map<string, Ag>();
  let semTelefone = 0, semBarbeiro = 0, depoisDoCorte = 0;
  for (const l of ler(pasta, "agend_")) {
    const [, prof, cli, origem, , status, statusCliente, quando] = l;
    const inicio = instante(quando);
    // Horario ainda por vir (so com --futuros): entra marcado; cancelado ou ja passado fica de fora.
    const futuro = inicio >= ate && futuros && status === "Agendado" && inicio > agora && !statusCliente.startsWith("Cancelado");
    if (inicio >= ate && !futuro) { depoisDoCorte++; continue; }
    const barbeiroId = barbeiroDe(prof);
    if (!barbeiroId) { semBarbeiro++; continue; }
    const partes = cli.split(" - ");
    const telefone = telefoneBr(partes.find((p) => /\(\d{2}\)/.test(p)) ?? "");
    if (!telefone) { semTelefone++; continue; }
    const nome = partes[0].replace(/\s+/g, " ").trim() || "Cliente";
    let clienteId = porTelefone.get(telefone);
    if (!clienteId) {
      clienteId = id("cbcl_", telefone);
      const email = partes.find((p) => p.includes("@"))?.trim().toLowerCase() ?? null;
      novosClientes.push({ id: clienteId, telefone, nome, email, origemDetalhe: MARCA, criadoEm: inicio });
      porTelefone.set(telefone, clienteId);
    }
    juntarNome(nome, clienteId);
    const st: StatusAgendamento = futuro ? (statusCliente.startsWith("Confirmado") ? "CONFIRMADO" : "MARCADO")
      : status === "Finalizado" ? "CONCLUIDO" : status === "Cancelado" && statusCliente !== "Faltou" ? "CANCELADO" : "FALTOU";
    const chave = id("cba_", barbeiroId, telefone, quando);
    const ja = ags.get(chave);
    // Corte e barba no mesmo horario sao duas linhas no CashBarber: vira um atendimento so (o mais "forte").
    if (ja && (ja.status === "CONCLUIDO" || st !== "CONCLUIDO")) continue;
    ags.set(chave, { id: chave, barbeiroId, clienteId, inicio, fim: inicio, status: st, origem: origem === "App" ? "SITE" : "RECEPCAO", telefone, futuro });
  }

  // Duracao: ate 40 min, cortada no proximo atendimento do mesmo barbeiro. Sobreposicao (encaixe no mesmo horario
  // ou choque com o que ja existe no BarberOS) nao cabe na agenda: o repetido fica de fora.
  const existentes = await db.agendamento.findMany({ where: { status: { notIn: ["CANCELADO", "FALTOU"] }, ...(futuros ? {} : { inicio: { lt: ate } }) }, select: { id: true, barbeiroId: true, inicio: true, fim: true } });
  const lista = [...ags.values()].sort((a, b) => a.barbeiroId.localeCompare(b.barbeiroId) || +a.inicio - +b.inicio);
  const ativos = lista.filter((a) => a.status !== "CANCELADO" && a.status !== "FALTOU");
  let encaixes = 0;
  for (let i = 0; i < ativos.length; i++) {
    const a = ativos[i];
    const prox = ativos.slice(i + 1).find((b) => b.barbeiroId === a.barbeiroId && +b.inicio > +a.inicio);
    a.fim = new Date(Math.min(+a.inicio + 40 * MIN, prox && prox.barbeiroId === a.barbeiroId ? +prox.inicio : Infinity));
  }
  for (const a of lista) if (+a.fim <= +a.inicio) a.fim = new Date(+a.inicio + 30 * MIN); // cancelados/faltas
  // O que ja foi importado numa rodada anterior (mesmo id) nao conta como choque com ele mesmo.
  const ocupado = new Map<string, { id: string; inicio: number; fim: number }[]>();
  for (const e of existentes) ocupado.set(e.barbeiroId, [...(ocupado.get(e.barbeiroId) ?? []), { id: e.id, inicio: +e.inicio, fim: +e.fim }]);
  const final: Ag[] = [];
  for (const a of lista) {
    if (a.status === "CANCELADO" || a.status === "FALTOU") { final.push(a); continue; }
    const faixas = ocupado.get(a.barbeiroId) ?? [];
    if (faixas.some((f) => f.id !== a.id && +a.inicio < f.fim && f.inicio < +a.fim)) { encaixes++; continue; }
    faixas.push({ id: a.id, inicio: +a.inicio, fim: +a.fim });
    ocupado.set(a.barbeiroId, faixas);
    final.push(a);
  }

  // ---- comandas (Movimentacoes): agrupa as linhas por id da comanda
  type Cm = { id: string; cb: string; quando: Date; prof: string; cliente: string; pagamentos: { forma: FormaRecebimento; valor: number }[]; cortesia: number; total: number };
  const comandas = new Map<string, Cm>();
  let operacoesCaixa = 0, comandasDepois = 0;
  for (const l of ler(pasta, "mov_")) {
    const [cb, , prof, cliente, opNome, , tipo, forma, valor, quando] = l;
    if (cb === "Totalizado") continue;
    if (opNome !== "N/A" || tipo !== "Crédito") { operacoesCaixa++; continue; } // sangria/suprimento do caixa
    const q = instante(quando);
    if (q >= ate) { comandasDepois++; continue; }
    const c = comandas.get(cb) ?? { id: `cbc_${cb}`, cb, quando: q, prof, cliente: cliente.replace(/\s+/g, " ").trim(), pagamentos: [], cortesia: 0, total: 0 };
    const v = centavos(valor);
    c.total += v;
    if (FORMA[forma]) { if (v > 0) c.pagamentos.push({ forma: FORMA[forma], valor: v }); } else c.cortesia += v;
    comandas.set(cb, c);
  }

  // Liga a comanda ao cliente (pelo nome, quando o nome e de um cliente so) e ao atendimento concluido do dia.
  const atendDoDia = new Map<string, Ag[]>();
  for (const a of final) if (a.status === "CONCLUIDO") {
    const k = `${a.clienteId}|${a.barbeiroId}|${diaLocal(a.inicio)}`;
    atendDoDia.set(k, [...(atendDoDia.get(k) ?? []), a]);
  }
  const usados = new Set<string>();
  const cmCriar: Prisma.ComandaCreateManyInput[] = [], itens: Prisma.ItemComandaCreateManyInput[] = [], pags: Prisma.PagamentoComandaCreateManyInput[] = [];
  let comCliente = 0, ligadas = 0;
  for (const c of comandas.values()) {
    const consumo = normal(c.cliente) === "comanda de consumo";
    const ids = consumo ? undefined : porNome.get(normal(c.cliente));
    const clienteId = ids?.size === 1 ? [...ids][0] : null;
    if (clienteId) comCliente++;
    const barbeiroId = c.prof === "Crédito" ? null : barbeiroDe(c.prof);
    const candidatos = clienteId && barbeiroId ? (atendDoDia.get(`${clienteId}|${barbeiroId}|${diaLocal(c.quando)}`) ?? []).filter((a) => !usados.has(a.id)) : [];
    const ag = candidatos.sort((a, b) => Math.abs(+a.inicio - +c.quando) - Math.abs(+b.inicio - +c.quando))[0];
    if (ag) { usados.add(ag.id); ligadas++; }
    cmCriar.push({
      id: c.id, clienteId, nomeAvulso: clienteId ? null : consumo ? "Consumo (bar)" : c.cliente || "Cliente", status: "FECHADA",
      descontoCentavos: c.cortesia, observacao: `${MARCA} (comanda ${c.cb})`, abertaEm: c.quando, fechadaEm: c.quando,
    });
    itens.push({ id: `${c.id}_i`, comandaId: c.id, agendamentoId: ag?.id ?? null, descricao: consumo ? "Consumo (CashBarber)" : "Atendimento (CashBarber)", precoUnitCentavos: c.total, barbeiroId, criadoEm: c.quando });
    c.pagamentos.forEach((p, i) => pags.push({ id: `${c.id}_p${i}`, comandaId: c.id, forma: p.forma, valorCentavos: p.valor, status: "PAGO", criadoEm: c.quando, pagoEm: c.quando }));
  }

  const porMes = new Map<string, number>();
  for (const p of pags) { const m = diaLocal(p.pagoEm as Date).slice(0, 7); porMes.set(m, (porMes.get(m) ?? 0) + p.valorCentavos); }
  const st = (s: StatusAgendamento) => final.filter((a) => a.status === s).length;
  console.log(`corte: antes de ${ate.toISOString()} (fora: ${depoisDoCorte} agendamentos, ${comandasDepois} linhas de comanda)`);
  console.log(`agendamentos: ${final.length} (concluídos ${st("CONCLUIDO")}, cancelados ${st("CANCELADO")}, faltas ${st("FALTOU")}, marcados ${st("MARCADO") + st("CONFIRMADO")}) | sem telefone ${semTelefone} | sem barbeiro ${semBarbeiro} | encaixe/choque fora ${encaixes}`);
  console.log(`clientes novos: ${novosClientes.length}`);
  console.log(`comandas: ${cmCriar.length} | com cliente ${comCliente} | ligadas a atendimento ${ligadas} | pagamentos ${pags.length} | operações de caixa ignoradas ${operacoesCaixa}`);
  console.log("recebido por mês:", Object.fromEntries([...porMes].sort().map(([m, v]) => [m, (v / 100).toFixed(2)])));
  const indicacoes = await db.indicacao.count({ where: { convertidaEm: null, indicadoId: { in: [...new Set(final.filter((a) => a.status === "CONCLUIDO").map((a) => a.clienteId))] } } });
  if (indicacoes) console.log(`ATENÇÃO: ${indicacoes} indicação(ões) pendente(s) virariam prêmio com o histórico.`);
  if (!aplicar) { console.log("\nSó simulação. Para gravar: --aplicar"); return; }
  if (indicacoes) throw new Error("Resolva as indicações pendentes antes de importar.");

  // ---- grava
  let servico = await db.servico.findFirst({ where: { nome: SERVICO } });
  servico ??= await db.servico.create({ data: { nome: SERVICO, duracaoMin: 40, precoCentavos: 0, ordem: 999, ativo: false } });
  const lote = async <T>(dados: T[], fn: (d: T[]) => Promise<{ count: number }>) => {
    let n = 0;
    for (let i = 0; i < dados.length; i += 1000) n += (await fn(dados.slice(i, i + 1000))).count;
    return n;
  };
  const nCli = await lote(novosClientes, (d) => db.cliente.createMany({ data: d, skipDuplicates: true }));
  const nAg = await lote(final, (d) => db.agendamento.createMany({
    data: d.map((a) => ({ id: a.id, barbeiroId: a.barbeiroId, clienteId: a.clienteId, servicoId: servico.id, inicio: a.inicio, fim: a.fim, status: a.status, origem: a.origem, precoCentavos: 0,
      observacao: a.futuro ? "Marcado no CashBarber (serviço não informado)" : MARCA, criadoEm: a.futuro ? agora : a.inicio })),
    skipDuplicates: true,
  }));
  const nCm = await lote(cmCriar, (d) => db.comanda.createMany({ data: d, skipDuplicates: true }));
  const nIt = await lote(itens, (d) => db.itemComanda.createMany({ data: d, skipDuplicates: true }));
  const nPg = await lote(pags, (d) => db.pagamentoComanda.createMany({ data: d, skipDuplicates: true }));

  // Nada de mensagem por causa do historico: a ultima visita importada de cada cliente fica marcada como ja tratada.
  const ultimas = await db.agendamento.groupBy({ by: ["clienteId"], where: { status: "CONCLUIDO" }, _max: { inicio: true } });
  const importadas = new Map(final.filter((a) => a.status === "CONCLUIDO").map((a) => [`${a.clienteId}|${+a.inicio}`, true]));
  const marcas: Prisma.AutomacaoEnviadaCreateManyInput[] = [];
  for (const u of ultimas) {
    if (!importadas.has(`${u.clienteId}|${+u._max.inicio!}`)) continue;
    const chave = `${u.clienteId}:${u._max.inicio!.toISOString()}`;
    for (const tipo of ["REATIVACAO", "RETORNO"] as const) marcas.push({ tipo, chave, clienteId: u.clienteId, ok: false, erro: "Histórico importado do CashBarber: não enviado." });
  }
  // Atendimentos/faltas importados das ultimas horas: sem agradecimento nem aviso de falta (a rotina usa o dia UTC na chave).
  const dias = [0, 1].map((n) => new Date(+agora + n * 86_400_000).toISOString().slice(0, 10));
  for (const a of final) {
    if (a.status === "CONCLUIDO" && +a.fim > +agora - 13 * 3_600_000) {
      for (const d of dias) marcas.push({ tipo: "POS_ATENDIMENTO", chave: `${a.clienteId}:${d}`, clienteId: a.clienteId, agendamentoId: a.id, ok: false, erro: "Histórico importado do CashBarber: não enviado." });
    }
    if (a.status === "FALTOU" && +a.inicio > +agora - 25 * 3_600_000) {
      marcas.push({ tipo: "POS_FALTA", chave: a.id, clienteId: a.clienteId, agendamentoId: a.id, ok: false, erro: "Histórico importado do CashBarber: não enviado." });
    }
  }
  const nMarcas = await lote(marcas, (d) => db.automacaoEnviada.createMany({ data: d, skipDuplicates: true }));
  console.log(`\ngravado: clientes ${nCli}, agendamentos ${nAg}, comandas ${nCm}, itens ${nIt}, pagamentos ${nPg}, automações bloqueadas ${nMarcas}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
