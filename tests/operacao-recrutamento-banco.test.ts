import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/api/recrutamento/candidaturas/route";
import { POST } from "@/app/api/servicos/route";

vi.mock("@/lib/auth/sessao", () => ({ GESTAO: ["DONO", "GERENTE"], exigirSessao: async () => ({ papel: "DONO" }) }));
const executar = process.env.TESTE_OPERACAO_LOCAL === "1";
if (executar) {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || !/^\/barberos_op_\d{8}_\d+$/.test(url.pathname)) throw Error("Use um banco local dedicado à regressão de operação.");
}

describe.skipIf(!executar)("API de operação em PostgreSQL", () => {
  it.each(["exclusão", "mudança de etapa"])("recupera os 30 primeiros após %s do único resultado na página 2", async acao => {
    const vaga = await db.vagaRecrutamento.create({ data: { titulo: "Seleção de teste", descricao: "Teste", cidade: "Teste", privacidade: "Teste", criadoPorId: "teste" } });
    for (let n = 0; n < 31; n++) await db.candidaturaRecrutamento.create({ data: {
      candidato: { create: { nome: `Teste ${n}`, cidade: "Teste", telefone: "teste" } }, vaga: { connect: { id: vaga.id } },
      envioId: randomUUID(), conteudoHash: "teste", experienciaMeses: 0, servicos: [], disponibilidade: "", portfolio: "", instagram: "",
      futurasOportunidades: false, formularioVersao: "1", avisoPrivacidade: "teste", origem: {},
    } });
    const listar = async () => (await GET(new Request(`http://localhost/api/recrutamento/candidaturas?vagaId=${vaga.id}&etapa=NOVO&pagina=2`))).json();
    const antes = await listar();
    expect(antes.pagina).toBe(2); expect(antes.candidaturas).toHaveLength(1);
    const where = { id: antes.candidaturas[0].id };
    if (acao === "exclusão") await db.candidaturaRecrutamento.delete({ where });
    else await db.candidaturaRecrutamento.update({ where, data: { etapa: "ENTREVISTA" } });
    const depois = await listar();
    expect(depois.pagina).toBe(1); expect(depois.total).toBe(30); expect(depois.candidaturas).toHaveLength(30);
  });

  it.each([[undefined, 400], ["", 400], [null, 400], [0, 201]])("preço %j retorna %i", async (precoCentavos, status) => {
    const req = new Request("http://localhost/api/servicos", { method: "POST", body: JSON.stringify({ nome: "Teste", duracaoMin: 30, precoCentavos }) });
    expect((await POST(req)).status).toBe(status);
  });
});
