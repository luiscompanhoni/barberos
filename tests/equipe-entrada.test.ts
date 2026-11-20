import { describe, expect, it, vi } from "vitest";
import Inicio from "@/app/(app)/page";
import { manifestoApp } from "@/lib/pwa/manifesto";

const sessao = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/sessao", () => ({ sessaoAtual: sessao, GESTAO: ["DONO", "GERENTE"] }));
vi.mock("next/navigation", () => ({ redirect: (destino: string) => { throw new Error(destino); } }));

describe("entrada da equipe pela raiz e pelo aplicativo", () => {
  it.each([
    ["BARBEIRO", "profissional", "/minha-agenda"], ["BARBEIRO", null, "/conta"],
    ["LIDER", null, "/recepcao"], ["LIDER", "profissional", "/recepcao"],
  ])("%s com vínculo %s abre %s", async (papel, barbeiroId, destino) => {
    expect(manifestoApp("equipe").start_url).toBe("/");
    sessao.mockResolvedValue({ papel, barbeiroId });
    await expect(Inicio()).rejects.toThrow(new Error(destino!));
  });
});
