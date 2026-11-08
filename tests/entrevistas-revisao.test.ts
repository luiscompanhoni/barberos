import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, EntrevistaRecrutamento } from "@prisma/client";
const m = vi.hoisted(() => ({ dono:vi.fn(), ler:vi.fn(), outro:vi.fn(), escrever:vi.fn(), candidatura:vi.fn(), sql:vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (tx: unknown) => unknown) => fn({ usuario:{findFirst:m.dono}, barbeiro:{findUnique:async()=>null}, $executeRaw:m.sql, entrevistaRecrutamento:{findUnique:m.ler,findFirst:m.outro,updateMany:m.escrever}, candidaturaRecrutamento:{findUniqueOrThrow:m.candidatura} }) } }));
import { gerirEntrevista } from "@/lib/recrutamento/entrevistas-gestao";
import { apresentarEntrevista, agirEntrevista } from "@/lib/recrutamento/entrevistas";
const e = {id:"fixture",donoId:"dono",candidaturaId:"c",versao:0,estado:"CONVIDADO",inicio:null,expiraEm:new Date("2031-03-01"),duracaoMin:45,local:"Local fictício"} as EntrevistaRecrutamento;
afterEach(() => vi.useRealTimers());
beforeEach(() => {vi.clearAllMocks();m.sql.mockReset(); m.dono.mockResolvedValue({id:"dono"});m.ler.mockResolvedValue(e);m.outro.mockResolvedValue(null);m.candidatura.mockResolvedValue({etapa:"NOVO"});});
describe("regressões encontradas nos quatro ciclos", () => {
 it("revalida o relógio após esperar a trava, sem aceitar convite expirado", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2031-02-28"));
  m.sql.mockImplementation(async () => { vi.setSystemTime(new Date("2031-03-02")); });
  const tx={$executeRaw:m.sql,barbeiro:{findUnique:async()=>null},entrevistaRecrutamento:{findUniqueOrThrow:m.ler}} as unknown as Prisma.TransactionClient;
  await expect(agirEntrevista(tx,e,{acao:"CONSULTAR"},"PORTAL",undefined)).rejects.toMatchObject({status:404});
 });
 it("não renova convite antigo quando outro dono tem um convite ativo", async () => {
  m.outro.mockResolvedValue({id:"outro",donoId:"outro-dono"});
  await expect(gerirEntrevista("dono",e.id,0,"RENOVAR",Date.parse("2031-03-03"))).rejects.toMatchObject({status:409});
  expect(m.escrever).not.toHaveBeenCalled(); expect(m.outro.mock.calls[0][0].where.candidaturaId).toBe("c");
 });
 it.each(["CONTRATADO","ENCERRADO"])("não renova nem oferece opções em seleção %s", async etapa => {
  m.candidatura.mockResolvedValue({etapa});
  await expect(gerirEntrevista("dono",e.id,0,"RENOVAR",0)).rejects.toMatchObject({status:409});
  const tx={candidaturaRecrutamento:{findUniqueOrThrow:m.candidatura}} as unknown as Prisma.TransactionClient;
  const v=await apresentarEntrevista(tx,e,0); expect(v.selecaoEncerrada).toBe(true); expect(v.horarios).toEqual([]); expect(v.propostaInicio).toBeNull(); expect(v).not.toHaveProperty("candidaturaId");
  expect(m.escrever).not.toHaveBeenCalled();
 });
});
