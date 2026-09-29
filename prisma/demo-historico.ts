/**
 * Gera 4 semanas de atendimentos passados FICTICIOS para demonstrar o painel
 * (mapa de pico, clientes sumidos, faltas). So para desenvolvimento.
 * Rodar: npm run db:demo
 */
import { PrismaClient } from "@prisma/client";
import { dataLocal, diaSemana, instanteLocal, somarDias } from "../src/lib/agenda/tempo";

const db = new PrismaClient();
const FUSO = "America/Sao_Paulo";

// Chance de cada horario estar ocupado: sabado de manha e fim de tarde cheios, segunda fraca.
function chance(ds: number, min: number) {
  const h = min / 60;
  let base = ds === 6 ? 0.85 : ds === 5 ? 0.7 : ds === 2 ? 0.35 : 0.5;
  if (h >= 12 && h < 14) base -= 0.25;
  if (h >= 17) base += 0.2;
  if (ds === 6 && h < 12) base += 0.1;
  return Math.max(0.05, Math.min(0.95, base));
}

// Gerador deterministico (mesmo resultado a cada execucao).
let semente = 42;
const aleatorio = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);

async function main() {
  if (await db.agendamento.count({ where: { observacao: "demo" } })) {
    console.log("Historico de demonstracao ja existe.");
    return;
  }
  const barbeiros = await db.barbeiro.findMany({ where: { ativo: true }, include: { expediente: true } });
  const corte = await db.servico.findFirstOrThrow({ where: { nome: "Corte" } });
  const nomes = ["Bruno", "Caio", "Davi", "Enzo", "Felipe", "Gabriel", "Heitor", "Igor", "Joaquim", "Kaique", "Leo", "Murilo", "Nicolas", "Otavio", "Paulo", "Renan", "Samuel", "Tiago", "Vitor", "Wesley"];
  const clientes = [];
  for (const [i, nome] of nomes.entries()) {
    clientes.push(await db.cliente.upsert({
      where: { telefone: `55119770000${String(i).padStart(2, "0")}` },
      create: { telefone: `55119770000${String(i).padStart(2, "0")}`, nome: `${nome} (demo)` },
      update: {},
    }));
  }

  const hoje = dataLocal(Date.now(), FUSO);
  let total = 0;
  for (let d = 28; d >= 1; d--) {
    const data = somarDias(hoje, -d);
    const ds = diaSemana(data);
    for (const b of barbeiros) {
      for (const e of b.expediente.filter((x) => x.diaSemana === ds)) {
        for (let m = e.inicioMin; m + 30 <= e.fimMin; m += 30) {
          if (aleatorio() > chance(ds, m)) continue;
          // Os 4 primeiros clientes "somem" depois da primeira semana.
          const idx = Math.floor(aleatorio() * clientes.length);
          if (idx < 4 && d < 21) continue;
          const inicio = instanteLocal(data, m, FUSO);
          await db.agendamento.create({
            data: {
              barbeiroId: b.id, clienteId: clientes[idx].id, servicoId: corte.id,
              inicio: new Date(inicio), fim: new Date(inicio + 30 * 60_000),
              status: aleatorio() < 0.05 ? "FALTOU" : "CONCLUIDO",
              origem: aleatorio() < 0.5 ? "BOT" : "RECEPCAO", precoCentavos: corte.precoCentavos, observacao: "demo",
            },
          });
          total++;
        }
      }
    }
  }
  console.log(`${total} atendimentos de demonstracao criados.`);
}

main().finally(() => db.$disconnect());
