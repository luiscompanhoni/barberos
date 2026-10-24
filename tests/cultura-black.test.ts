import { describe, expect, it } from "vitest";
import { MANDAMENTOS, OBJETIVO_CULTURA, ROTINAS, VERSAO_CULTURA_BLACK } from "@/lib/cultura-black/conteudo";
import { linkDoChecklist } from "@/lib/cultura-black/checklist-link";

describe("Cultura Black", () => {
  it("mantém a primeira entrega com dez mandamentos e três rotinas identificáveis", () => {
    expect(VERSAO_CULTURA_BLACK).toBeTruthy();
    expect(OBJETIVO_CULTURA.texto).toContain("respeitadas");
    expect(MANDAMENTOS).toHaveLength(10);
    expect(new Set(MANDAMENTOS.map((m) => m.numero)).size).toBe(10);
    expect(MANDAMENTOS.every((m) => m.pratica.length > 0 && m.limite.length > 0)).toBe(true);
    expect(ROTINAS.map((r) => r.id)).toEqual(["preparacao", "entre-clientes", "encerramento"]);
    expect(ROTINAS.every((r) => r.passos.length > 0 && r.tarefa.length > 0)).toBe(true);
  });

  it("aponta a equipe aos destinos existentes do checklist conforme o papel", () => {
    expect(linkDoChecklist("DONO")).toBe("/checklist");
    expect(linkDoChecklist("GERENTE")).toBe("/checklist");
    expect(linkDoChecklist("RECEPCAO")).toBe("/checklist");
    expect(linkDoChecklist("BARBEIRO", "token real")).toBe("/t/token%20real");
    expect(linkDoChecklist("BARBEIRO")).toBeNull();
    expect(linkDoChecklist("CLIENTE")).toBeNull();
  });
});
