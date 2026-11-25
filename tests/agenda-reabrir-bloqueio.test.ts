import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";
const m = vi.hoisted(() => ({ existe: true, auditoria: [] as unknown[], papel: [] as unknown[], individual: [] as unknown[] }));
vi.mock("@/lib/db", () => {
  const apagar = async () => { const count = m.existe ? 1 : 0; m.existe = false; return { count }; };
  const db = {
    bloqueio: { findUnique: async () => m.existe ? { id: "bloqueio", barbeiroId: "proprio" } : null, delete: apagar, deleteMany: apagar },
    permissaoPapel: { findMany: async () => m.papel }, permissaoUsuario: { findMany: async () => m.individual },
    auditoria: { create: async (d: unknown) => { m.auditoria.push(d); } },
    $executeRaw: async () => 1,
  };
  return { db: { ...db, $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db) } };
});
import { reabrirAgenda } from "@/lib/agenda/expediente";
import { assinar } from "@/lib/eventos";
const eventos: unknown[] = [];let sair: () => void;
beforeEach(() => { m.existe = true; m.auditoria = []; m.papel = []; m.individual = []; eventos.length = 0; sair = assinar(e => eventos.push(e)); });
afterEach(() => sair());
const ator = (papel: Sessao["papel"], barbeiroId: string | null = null): Sessao => ({ usuarioId: "u", papel, barbeiroId, clienteId: null, nome: "Teste" });
it.each(["DONO", "GERENTE", "RECEPCAO", "BARBEIRO"] as const)("%s remove o bloqueio autorizado, registra auditoria e atualiza a agenda", async papel => {
  await reabrirAgenda("bloqueio", ator(papel, papel === "BARBEIRO" ? "proprio" : null));
  expect(m.existe).toBe(false);expect(m.auditoria).toHaveLength(1);
  expect(m.auditoria[0]).toMatchObject({ data: { usuarioId: "u", acao: "reabrir_agenda", entidadeId: "bloqueio" } });
  expect(eventos).toEqual([{ tipo: "agenda", barbeiroIds: ["proprio"], datas: [] }]);
});
it.each([ator("BARBEIRO", "outra"), ator("CLIENTE")])("não permite remover bloqueio de agenda fora do acesso", async s => {
  await expect(reabrirAgenda("bloqueio", s)).rejects.toMatchObject({ status: 403 });
  expect(m.existe).toBe(true);expect(m.auditoria).toHaveLength(0);expect(eventos).toHaveLength(0);
});
it.each(["GERENTE", "RECEPCAO", "BARBEIRO"] as const)("mantém revogação individual de %s e não altera o bloqueio", async papel => {
  m.individual = [{ permissao: "bloquear_agenda", permitido: false }];
  await expect(reabrirAgenda("bloqueio", ator(papel, "proprio"))).rejects.toMatchObject({ status: 403 });
  expect(m.existe).toBe(true);expect(m.auditoria).toHaveLength(0);
});
it("bloqueio inexistente retorna 404 sem auditoria ou evento falso", async () => {
  m.existe = false;await expect(reabrirAgenda("ausente", ator("DONO"))).rejects.toMatchObject({ status: 404 });
  expect(m.auditoria).toHaveLength(0);expect(eventos).toHaveLength(0);
});
