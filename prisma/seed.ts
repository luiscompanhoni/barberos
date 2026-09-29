/**
 * Dados de exemplo para desenvolvimento: dono, recepcao, 3 barbeiros, servicos,
 * semana padrao e alguns atendimentos hoje. Rodar: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { dataLocal, instanteLocal } from "../src/lib/agenda/tempo";

const db = new PrismaClient();
const FUSO = "America/Sao_Paulo";

async function main() {
  if (await db.usuario.count()) {
    console.log("Banco já tem dados; seed ignorado. Use `npx prisma migrate reset` para recomeçar.");
    return;
  }
  await db.configuracao.create({ data: { id: 1, nomeBarbearia: "Barbearia Exemplo", fuso: FUSO } });

  await db.usuario.create({ data: { telefone: "5511900000001", nome: "Dono", papel: "DONO" } });
  await db.usuario.create({ data: { telefone: "5511900000002", nome: "Recepção", papel: "RECEPCAO" } });

  const dadosBarbeiros = [
    { nome: "Joao", telefone: "5511900000011", cor: "#378ADD" },
    { nome: "Pedro", telefone: "5511900000012", cor: "#1D9E75" },
    { nome: "Lucas", telefone: "5511900000013", cor: "#D85A30" },
  ];
  const barbeiros = [];
  for (const [ordem, b] of dadosBarbeiros.entries()) {
    barbeiros.push(
      await db.barbeiro.create({
        data: {
          nome: b.nome,
          cor: b.cor,
          ordem,
          usuario: { create: { telefone: b.telefone, nome: b.nome, papel: "BARBEIRO" } },
        },
      }),
    );
  }

  const servicos = await Promise.all(
    [
      { nome: "Corte", duracaoMin: 30, precoCentavos: 5000 },
      { nome: "Barba", duracaoMin: 30, precoCentavos: 4000 },
      { nome: "Corte + barba", duracaoMin: 60, precoCentavos: 8000 },
      { nome: "Sobrancelha", duracaoMin: 15, precoCentavos: 2000 },
      { nome: "Luzes", duracaoMin: 90, precoCentavos: 15000 },
    ].map((s, ordem) => db.servico.create({ data: { ...s, ordem } })),
  );

  // Todos fazem tudo, exceto Luzes (so Pedro). Pedro corta em 40 min.
  for (const b of barbeiros) {
    for (const s of servicos) {
      if (s.nome === "Luzes" && b.nome !== "Pedro") continue;
      await db.barbeiroServico.create({
        data: { barbeiroId: b.id, servicoId: s.id, duracaoMin: b.nome === "Pedro" && s.nome === "Corte" ? 40 : null },
      });
    }
  }

  // Terca a sabado, 9-12 e 13-19 (Lucas almoca 12:30-13:30).
  for (const b of barbeiros) {
    for (const dia of [2, 3, 4, 5, 6]) {
      const almoco = b.nome === "Lucas" ? [750, 810] : [720, 780];
      await db.expedientePadrao.createMany({
        data: [
          { barbeiroId: b.id, diaSemana: dia, inicioMin: 540, fimMin: almoco[0] },
          { barbeiroId: b.id, diaSemana: dia, inicioMin: almoco[1], fimMin: 1140 },
        ],
      });
    }
  }

  const clientes = await Promise.all(
    ["Carlos", "Rafael", "Bruno", "Diego", "Mateus", "Thiago", "Andre"].map((nome, i) =>
      db.cliente.create({ data: { nome, telefone: `55119888800${String(i).padStart(2, "0")}` } }),
    ),
  );

  // Atendimentos de exemplo hoje (se hoje for dia de expediente).
  const hoje = dataLocal(Date.now(), FUSO);
  const exemplos: [number, number, number, number][] = [
    // barbeiro, servico, cliente, minuto de inicio
    [0, 0, 0, 540],
    [0, 2, 1, 600],
    [0, 0, 2, 840],
    [1, 0, 3, 570],
    [1, 4, 4, 690 + 90],
    [2, 1, 5, 600],
    [2, 0, 6, 900],
  ];
  const diaSemanaHoje = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  if ([2, 3, 4, 5, 6].includes(diaSemanaHoje)) {
    for (const [bi, si, ci, min] of exemplos) {
      const s = servicos[si];
      const dur = barbeiros[bi].nome === "Pedro" && s.nome === "Corte" ? 40 : s.duracaoMin;
      const inicio = instanteLocal(hoje, min, FUSO);
      await db.agendamento.create({
        data: {
          barbeiroId: barbeiros[bi].id,
          servicoId: s.id,
          clienteId: clientes[ci].id,
          inicio: new Date(inicio),
          fim: new Date(inicio + dur * 60_000),
          origem: "RECEPCAO",
          precoCentavos: s.precoCentavos,
        },
      });
    }
  }

  console.log("Seed pronto. Logins (código aparece no terminal do `npm run dev`):");
  console.log("  Dono      (11) 90000-0001");
  console.log("  Recepção  (11) 90000-0002");
  console.log("  Joao      (11) 90000-0011 | Pedro (11) 90000-0012 | Lucas (11) 90000-0013");
}

main().finally(() => db.$disconnect());
