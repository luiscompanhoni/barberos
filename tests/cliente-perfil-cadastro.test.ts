import { describe, expect, it } from "vitest";
import { cadastroCompleto, zDadosCadastroCliente, zAtualizacaoCadastroCliente } from "@/lib/clientes/perfil-cadastro";

const dados = { nome: "Cliente Exemplo", telefone: "(47) 99999-0000", cpf: "529.982.247-25", email: " Cliente@EXAMPLE.test ", endereco: "Rua de Teste, 100, Centro", dataNascimento: "1990-06-20" };
describe("cadastro completo", () => {
  it("normaliza os campos e aceita foto ausente", () => {
    const r = zDadosCadastroCliente.parse(dados);
    expect(r.cpf).toBe("52998224725"); expect(r.email).toBe("cliente@example.test"); expect(r.telefone).toMatch(/^55/);
    expect(r.dataNascimento).toEqual(new Date("1990-06-20T00:00:00Z"));
    expect(cadastroCompleto(r)).toBe(true);
  });
  it.each(["1990-02-31", "2030-01-01", "", "1990-13-10"])("recusa nascimento inválido %s", (dataNascimento) => {
    expect(zDadosCadastroCliente.safeParse({ ...dados, dataNascimento }).success).toBe(false);
  });
  it("recusa CPF e endereço inválidos", () => {
    expect(zDadosCadastroCliente.safeParse({ ...dados, cpf: "11111111111" }).success).toBe(false);
    expect(zDadosCadastroCliente.safeParse({ ...dados, endereco: "Rua" }).success).toBe(false);
  });
  it("cadastros legados incompletos podem atualizar um campo sem preencher todos via API", () => {
    expect(zAtualizacaoCadastroCliente.parse({ nome: "Novo Nome" })).toEqual({ nome: "Novo Nome" });
    expect(cadastroCompleto({ nome: "Nome", telefone: "5547999990000", cpf: null, email: null, endereco: null, dataNascimento: null })).toBe(false);
  });
});
