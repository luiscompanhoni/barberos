import { beforeEach, expect, it, vi } from "vitest";
import { lancarBonusNaFolha, pessoaDaFolha, vendasDaCampanha } from "@/lib/campanha-equipe";
import { proximaCompetencia } from "@/lib/equipe-regras";
import { db } from "@/lib/db";
vi.mock("@/lib/db",()=>({db:{comanda:{findMany:vi.fn()}}}));
it("bônus entra na folha do primeiro mês ainda aberto, com a pessoa travada", async () => {
  expect(proximaCompetencia("2026-10")).toBe("2026-11");
  expect(proximaCompetencia("2026-12")).toBe("2027-01");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-31T23:30:00-03:00"));
  const fechadas = new Set(["2026-10", "2026-11"]);
  const criar = vi.fn(async ({ data }) => ({ id: "l1", ...data }));
  const lock = vi.fn();
  const tx = { $queryRaw: lock, folhaPagamento: { findUnique: async ({ where }: { where: { competencia_pessoaId: { competencia: string } } }) => fechadas.has(where.competencia_pessoaId.competencia) ? { id: "f" } : null }, folhaLancamento: { create: criar } };
  const l = await lancarBonusNaFolha(tx as never, { pessoaId: "p1", valorCentavos: 5000, descricao: "Bônus", porId: "u", fuso: "America/Sao_Paulo" });
  vi.useRealTimers();
  expect(lock).toHaveBeenCalledOnce();
  expect(l).toMatchObject({ pessoaId: "p1", tipo: "BONUS", valorCentavos: 5000, competencia: "2026-12" });
});
it("sem ficha de RH: recusa antes de sortear", async () => {
  await expect(pessoaDaFolha({ checklistPessoa: { findUnique: async () => null } } as never, "b")).rejects.toMatchObject({ status: 409 });
  expect(await pessoaDaFolha({ checklistPessoa: { findUnique: async () => ({ id: "p1" }) } } as never, "b")).toBe("p1");
});
const listar=vi.mocked(db.comanda.findMany);
beforeEach(()=>vi.clearAllMocks());
it("exclui comandas não quitadas e estornadas e rateia desconto",async()=>{
  const item={barbeiroId:"b",produtoId:"p",quantidade:10,precoUnitCentavos:4000};
  const comanda=(valor:number,estornado=0)=>({itens:[item],descontoCentavos:10000,pagamentos:[{status:"PAGO",valorCentavos:valor,estornadoCentavos:estornado}]});
  listar.mockResolvedValue([comanda(30000),comanda(29999),comanda(40000,1000)] as never);
  expect(await vendasDaCampanha(db,{inicio:new Date(0),fim:new Date(),metaQuantidade:10,metaCentavos:30000},"b")).toEqual({quantidade:10,receita:30000,ciclos:1});
  expect(listar.mock.calls[0][0]?.where).toMatchObject({status:"FECHADA",itens:{some:{barbeiroId:"b",produtoId:{not:null}}}});
});
