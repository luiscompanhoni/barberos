/**
 * Importa o cadastro da barbearia vindo do CashBarber (scripts/dados/cashbarber.json):
 * servicos, barbeiros (com servicos, duracoes e horarios), planos e produtos.
 * Pode rodar de novo: o que ja existe (mesmo nome/telefone) e atualizado, nada e duplicado.
 * Rodar: DATABASE_URL=... npx tsx scripts/importar-cashbarber.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

type Barbeiro = {
  nome: string; nomeCompleto: string; telefone: string; dono?: boolean; cor: string;
  servicos: Record<string, number>; horarios: Record<string, [string, string]>; intervalos: Record<string, [string, string]>;
};
type Dados = {
  servicos: [string, number, number][];
  barbeiros: Barbeiro[];
  planos: { nome: string; preco: number; vagas: number; servicos: string[]; descricao: string }[];
  produtos: [string, number, "B" | "L"][];
};

const db = new PrismaClient();
const dados: Dados = JSON.parse(readFileSync(join(__dirname, "dados", "cashbarber.json"), "utf8"));
const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const centavos = (r: number) => Math.round(r * 100);
// Combo para agendar corte e barba juntos (no CashBarber sao dois servicos no mesmo horario).
const COMBO = { nome: "Corte + Barba", partes: ["Corte de cabelo", "Barba"] };

async function main() {
  // ---- Servicos
  const servicos = new Map<string, string>();
  const todos = [...dados.servicos];
  const [corte, barba] = COMBO.partes.map((n) => dados.servicos.find((s) => s[0] === n)!);
  todos.splice(2, 0, [COMBO.nome, corte[1] + barba[1], corte[2] + barba[2]]);
  for (const [ordem, [nome, duracaoMin, preco]] of todos.entries()) {
    const ex = await db.servico.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } } });
    const data = { nome, duracaoMin, precoCentavos: centavos(preco), ordem, ativo: true };
    const s = ex ? await db.servico.update({ where: { id: ex.id }, data }) : await db.servico.create({ data });
    servicos.set(nome, s.id);
  }
  console.log(`servicos: ${servicos.size}`);

  // ---- Barbeiros
  const barbeiros: string[] = [];
  for (const [ordem, b] of dados.barbeiros.entries()) {
    const u = await db.usuario.upsert({
      where: { telefone: b.telefone },
      create: { telefone: b.telefone, nome: b.nomeCompleto, papel: b.dono ? "DONO" : "BARBEIRO" },
      update: { nome: b.nomeCompleto, ativo: true },
    });
    const barbeiro = await db.barbeiro.upsert({
      where: { usuarioId: u.id },
      create: { usuarioId: u.id, nome: b.nome, cor: b.cor, ordem },
      update: { nome: b.nome, cor: b.cor, ordem, ativo: true },
    });
    barbeiros.push(barbeiro.id);

    const servs = { ...b.servicos };
    if (servs[COMBO.partes[0]] && servs[COMBO.partes[1]]) servs[COMBO.nome] = servs[COMBO.partes[0]] + servs[COMBO.partes[1]];
    await db.barbeiroServico.deleteMany({ where: { barbeiroId: barbeiro.id } });
    await db.barbeiroServico.createMany({
      data: Object.entries(servs).map(([nome, dur]) => {
        const id = servicos.get(nome);
        if (!id) throw new Error(`Serviço desconhecido no barbeiro ${b.nome}: ${nome}`);
        const padrao = todos.find((s) => s[0] === nome)![1];
        return { barbeiroId: barbeiro.id, servicoId: id, duracaoMin: dur === padrao ? null : dur };
      }),
    });

    // Expediente: cada dia vira 1 ou 2 faixas (antes e depois do intervalo).
    await db.expedientePadrao.deleteMany({ where: { barbeiroId: barbeiro.id } });
    const faixas: { barbeiroId: string; diaSemana: number; inicioMin: number; fimMin: number }[] = [];
    for (const [dia, [ini, fim]] of Object.entries(b.horarios)) {
      const pausa = b.intervalos[dia];
      const [i, f] = [min(ini), min(fim)];
      if (pausa && min(pausa[0]) > i && min(pausa[1]) < f) {
        faixas.push({ barbeiroId: barbeiro.id, diaSemana: +dia, inicioMin: i, fimMin: min(pausa[0]) });
        faixas.push({ barbeiroId: barbeiro.id, diaSemana: +dia, inicioMin: min(pausa[1]), fimMin: f });
      } else {
        faixas.push({ barbeiroId: barbeiro.id, diaSemana: +dia, inicioMin: i, fimMin: f });
      }
    }
    await db.expedientePadrao.createMany({ data: faixas });
    console.log(`barbeiro ${b.nome}: ${Object.keys(servs).length} serviços, ${faixas.length} faixas de horário${b.dono ? " (dono)" : ""}`);
  }

  // ---- Planos (no CashBarber cada forma de pagamento era um plano; aqui e um plano so)
  for (const [ordem, p] of dados.planos.entries()) {
    const ids = [...p.servicos, ...(p.servicos.length > 1 ? [COMBO.nome] : [])].map((n) => servicos.get(n)!);
    const data = {
      nome: p.nome, descricao: p.descricao, precoCentavos: centavos(p.preco), ordem, vagas: p.vagas, ativo: true,
      intervaloMinDias: 15, maxAgendamentosAbertos: 1, diasSemana: [1, 2, 3, 4, 5, 6], descontoExtrasPct: 10,
      formasPagamento: ["CARTAO", "PIX", "BOLETO"] as ("CARTAO" | "PIX" | "BOLETO")[],
    };
    const ex = await db.plano.findFirst({ where: { nome: p.nome } });
    const plano = ex ? await db.plano.update({ where: { id: ex.id }, data }) : await db.plano.create({ data });
    await db.planoServico.deleteMany({ where: { planoId: plano.id } });
    await db.planoServico.createMany({ data: ids.map((servicoId) => ({ planoId: plano.id, servicoId, usosPorCiclo: null })) });
    await db.planoBarbeiro.deleteMany({ where: { planoId: plano.id } });
    await db.planoBarbeiro.createMany({ data: barbeiros.map((barbeiroId) => ({ planoId: plano.id, barbeiroId })) });
  }
  console.log(`planos: ${dados.planos.length}`);

  // ---- Produtos (estoque comeca em 0: o do CashBarber estava negativo; fazer a contagem e dar entrada)
  let novos = 0;
  for (const [nome, preco, cat] of dados.produtos) {
    const n = nome.replace(/\s+/g, " ").trim();
    const ex = await db.produto.findFirst({ where: { nome: { equals: n, mode: "insensitive" } } });
    const data = { nome: n, precoCentavos: centavos(preco), categoria: cat === "B" ? ("BAR" as const) : ("LOJA" as const), ativo: true };
    if (ex) await db.produto.update({ where: { id: ex.id }, data });
    else { await db.produto.create({ data }); novos++; }
  }
  console.log(`produtos: ${dados.produtos.length} (${novos} novos)`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
