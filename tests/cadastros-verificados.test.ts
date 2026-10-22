import { describe, expect, it } from "vitest";
import { cpfValido, diferencaAuditavel, nascimentoValido, planejarCadastros, type Cadastro, type FonteCadastro } from "../scripts/dados/cadastros-verificados";
const ex: Cadastro = { id: "1", nome: "Pessoa Exemplo", telefone: "5547999999999", cpf: null, email: null, dataNascimento: null };
const fonte = (p: Partial<FonteCadastro> = {}): FonteCadastro => ({ ...ex, fonte: "cashbarber", email: "pessoa@example.com", ...p });
describe("cadastros verificados", () => {
  it("audita apenas campos preenchidos e mascara CPF", () => {
    const d = diferencaAuditavel({ id: "1", antes: { ...ex, email: "mantido@example.com" }, depois: { cpf: "12345678901", email: null, dataNascimento: null }, fontes: [] });
    expect(d).toEqual({ antes: { cpf: null }, depois: { cpf: "***.***.***-01" } });
  });
  it("completa apenas dados ausentes e pode ser repetido", () => {
    const p = planejarCadastros([ex], [fonte()]);
    expect(p.atualizacoes).toHaveLength(1);
    expect(planejarCadastros([{ ...ex, email: "pessoa@example.com" }], [fonte()]).atualizacoes).toHaveLength(0);
  });
  it("nao mistura familiares pelo mesmo telefone", () => {
    const p = planejarCadastros([ex], [fonte(), fonte({ id: "2", nome: "Outra Pessoa" })]);
    expect(p.atualizacoes).toHaveLength(0); expect(p.novos).toHaveLength(0); expect(p.pendencias).toHaveLength(2);
  });
  it("bloqueia telefone cujo nome difere no destino", () => {
    expect(planejarCadastros([{ ...ex, nome: "Outra Pessoa" }], [fonte()]).atualizacoes).toHaveLength(0);
  });
  it("nao copia CPF ou email invalidos", () => {
    expect(cpfValido("111.111.111-11")).toBeNull();
    expect(planejarCadastros([ex], [fonte({ cpf: "11111111111", email: "N/A" })]).atualizacoes).toHaveLength(0);
  });
  it("rejeita datas normalizadas silenciosamente pelo JavaScript", () => {
    expect(nascimentoValido("31/02/2000")).toBeNull();
    expect(nascimentoValido("29/02/2000", new Date("2026-10-22"))).toBe("2000-02-29");
  });
  it("nao sobrescreve dados existentes", () => {
    const p = planejarCadastros([{ ...ex, email: "antigo@example.com" }], [fonte({ dataNascimento: "01/01/2000" })]);
    expect(p.atualizacoes[0].depois).toEqual({ cpf: null, email: null, dataNascimento: "2000-01-01" });
  });
  it("ret�m fontes que discordam", () => {
    expect(planejarCadastros([ex], [fonte(), fonte({ fonte: "celcoin", email: "outro@example.com" })]).atualizacoes).toHaveLength(0);
  });
  it("cria uma pessoa uma unica vez entre as fontes", () => {
    const p = planejarCadastros([], [fonte(), fonte({ fonte: "celcoin" })]);
    expect(p.novos).toHaveLength(1);
  });
  it("nao duplica pessoa com mesmo nome e outro telefone", () => {
    expect(planejarCadastros([ex], [fonte({ telefone: "5547988888888" })]).novos).toHaveLength(0);
    expect(planejarCadastros([], [fonte(), fonte({ telefone: "5547988888888" })]).novos).toHaveLength(0);
  });
  it("nao atribui email de terceiro nem repete email em dois novos", () => {
    expect(planejarCadastros([{ ...ex, id: "2", nome: "Outra Pessoa", telefone: "5547988888888", email: "pessoa@example.com" }], [fonte()]).novos).toHaveLength(0);
    const p = planejarCadastros([], [fonte(), fonte({ id: "2", nome: "Outra Pessoa", telefone: "5547988888888" })]);
    expect(p.novos).toHaveLength(0);
  });
});
