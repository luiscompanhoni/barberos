import { describe, expect, it } from "vitest";
import { destinoAposLogin } from "@/lib/auth/destino";

describe("destino depois da autenticação", () => {
  it.each([
    "/\\outside.example.test", "//outside.example.test", "///outside.example.test", "https://outside.example.test",
    "javascript:alert(1)", "/\n/outside.example.test", "/\t/outside.example.test", "/\r/outside.example.test",
    "/c/..//outside.example.test", "/%5coutside.example.test", "/%2foutside.example.test", "/%00/outside.example.test", "/%zz",
  ])("rejeita destino ambíguo ou externo %j", (destino) => {
    expect(destinoAposLogin(destino, "/c")).toBe("/c");
  });
  it.each([
    ["/c/agendar?servico=corte#horarios", "/c/agendar?servico=corte#horarios"],
    ["/c/planos?plano=teste%20local&outro=1", "/c/planos?plano=teste%20local&outro=1"],
    ["/c/../clientes?pagina=2", "/clientes?pagina=2"], ["/", "/"],
  ])("preserva caminho local e query %s", (destino, esperado) => {
    const seguro = destinoAposLogin(destino, "/c");
    expect(seguro).toBe(esperado); expect(new URL(seguro, "https://cliente.example.test").origin).toBe("https://cliente.example.test");
  });
  it("retorno inválido da equipe usa o destino da equipe", () => {
    expect(destinoAposLogin("/\\outside.example.test", "/agenda")).toBe("/agenda");
  });
});
