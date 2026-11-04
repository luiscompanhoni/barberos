import { expect, it, vi } from "vitest";
import { fecharAgenda, removerExcecao, salvarExcecao, salvarExpediente, validarGruposNoFechamento } from "@/lib/agenda/expediente";

const m = vi.hoisted(() => ({ transacao: vi.fn(), permissao: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transacao } }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirPermissao: m.permissao }));

it("barbeiro não altera diretamente a agenda mesmo com permissão antiga", async () => {
  const s = { usuarioId: "u", barbeiroId: "b", papel: "BARBEIRO" } as never;
  await expect(salvarExpediente("b", [], s)).rejects.toMatchObject({ status: 403 });
  await expect(salvarExcecao("b", { data: "2099-01-01", tipo: "FOLGA" }, s)).rejects.toMatchObject({ status: 403 });
  await expect(removerExcecao("b", "2099-01-01", s)).rejects.toMatchObject({ status: 403 });
  await expect(fecharAgenda("b", { inicio: new Date(), fim: new Date(Date.now() + 3600000), confirmar: true }, s)).rejects.toMatchObject({ status: 403 });
  expect(m.transacao).not.toHaveBeenCalled();
});
it("bloqueia fechamento que afetaria o principal ou um serviço adicional", async () => {
  const contar = vi.fn().mockResolvedValue(1);
  const tx = { agendamento: { count: contar } } as never;
  await expect(validarGruposNoFechamento(tx, [{ id: "a", adicionalDeId: null }])).rejects.toMatchObject({ codigo: "grupo_nao_suportado", status: 409 });
  await expect(validarGruposNoFechamento(tx, [{ id: "b", adicionalDeId: "a" }])).rejects.toMatchObject({ codigo: "grupo_nao_suportado", status: 409 });
  contar.mockResolvedValue(0);
  await expect(validarGruposNoFechamento(tx, [{ id: "s", adicionalDeId: null }])).resolves.toBeUndefined();
});
