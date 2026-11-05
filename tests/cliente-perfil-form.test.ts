import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { alteracoesPerfil } from "@/lib/clientes/perfil-form";
import { zAtualizacaoCadastroCliente } from "@/lib/clientes/perfil-cadastro";
import { CADASTRO_VAZIO, CamposCadastroCompleto } from "@/components/cliente/CamposCadastroCompleto";

const base = { nome: "Cliente legado", email: null, endereco: null, dataNascimento: null,
  observacoes: null, origem: null, origemDetalhe: null };
const campos = { ...CADASTRO_VAZIO, nome: base.nome };
const extras = { obs: "", origem: "", detalhe: "" };
const schema = zAtualizacaoCadastroCliente.extend({ observacoes: z.string().trim().max(300).optional() });

describe("edição parcial de perfil legado", () => {
  it("permite mudar preferência e nome sem exigir cadastro complementar", () => {
    const dados = alteracoesPerfil(base, { ...campos, nome: "Nome atualizado" }, { ...extras, obs: "Tesoura em cima" });
    expect(dados).toEqual({ nome: "Nome atualizado", observacoes: "Tesoura em cima" });
    expect(schema.safeParse(dados).success).toBe(true);
  });
  it("preserva observação longa do CRM e e-mail legado ao editar somente nome", () => {
    const obs = "Preferência ".repeat(60);
    const anterior = { ...base, email: "cadastro antigo sem email", observacoes: obs };
    const dados = alteracoesPerfil(anterior, { ...campos, nome: "Nome corrigido", email: anterior.email }, { ...extras, obs });
    expect(dados).toEqual({ nome: "Nome corrigido" });
    expect(schema.safeParse(dados).success).toBe(true);
  });
  it("não reenvia campos vazios nem CPF mascarado quando nada foi alterado", () => {
    expect(alteracoesPerfil(base, campos, extras)).toEqual({});
  });
  it("continua validando campo complementar que foi modificado", () => {
    const dados = alteracoesPerfil(base, { ...campos, email: "invalido", cpf: "123" }, extras);
    expect(schema.safeParse(dados).success).toBe(false);
    const validos = alteracoesPerfil(base, { ...campos, email: "cliente@example.invalid", cpf: "52998224725" }, extras);
    expect(schema.safeParse(validos).success).toBe(true);
  });
  it("mantém limite para uma nova preferência, sem truncar a antiga silenciosamente", () => {
    const dados = alteracoesPerfil(base, campos, { ...extras, obs: "x".repeat(301) });
    expect(dados.observacoes).toHaveLength(301);
    expect(schema.safeParse(dados).success).toBe(false);
  });
  it("exige os seis dados no cadastro novo e permite complementá-los aos poucos no perfil", () => {
    const cadastro = renderToStaticMarkup(createElement(CamposCadastroCompleto, { valor: CADASTRO_VAZIO, mudar: vi.fn() }));
    expect(cadastro.match(/required=""/g)).toHaveLength(6);
    const perfil = renderToStaticMarkup(createElement(CamposCadastroCompleto, { valor: CADASTRO_VAZIO, mudar: vi.fn(), identidade: false, obrigatorios: false }));
    expect(perfil).not.toContain('required=""');
    expect(perfil).toContain('type="date"');
    expect(perfil).toContain('type="email"');
  });
});

