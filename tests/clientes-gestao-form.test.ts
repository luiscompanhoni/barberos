import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { dadosFormularioCliente } from "@/lib/clientes/gestao-form";
import { zClienteGestao, zEditarClienteGestao } from "@/lib/clientes/gestao-regras";
import { EditorCliente } from "@/components/clientes/EditorCliente";
import type { CadastroCliente } from "@/components/clientes/tipos";

const legado: CadastroCliente = {
  id: "cliente-legado-teste", nome: "Cliente legado", telefone: "5511999990093", email: "não informado",
  cpfMascarado: "***.***.247-**", endereco: null, dataNascimento: null,
  observacoes: "Preferência ".repeat(60), criadoEm: "2025-01-01", fotoVersao: 0, temAcesso: false, cadastroCompleto: false,
};
function formulario(base = legado, mudancas: Record<string, string> = {}) {
  const form = new FormData();
  for (const k of ["nome", "telefone", "email", "endereco", "dataNascimento", "observacoes"] as const) form.set(k, base[k] ?? "");
  form.set("cpf", "");
  Object.entries(mudancas).forEach(([k, v]) => form.set(k, v));
  return form;
}

describe("edição pontual de cadastro legado no CRM", () => {
  it("permite salvar apenas nome com e-mail legado e notas longas intocados", () => {
    const delta = dadosFormularioCliente(formulario(legado, { nome: "Nome corrigido" }), legado);
    expect(delta).toEqual({ nome: "Nome corrigido" });
    expect(zEditarClienteGestao.parse(delta)).toEqual({ nome: "Nome corrigido" });
    expect(legado.email).toBe("não informado");
    expect(delta).not.toHaveProperty("observacoes"); expect(delta).not.toHaveProperty("cpf");
  });
  it("não transforma espaços ou quebras de linha da importação em alterações silenciosas", () => {
    const base = { ...legado, email: " não informado ", observacoes: " Linha 1\r\nLinha 2  " };
    expect(dadosFormularioCliente(formulario(base, { email: "não informado", observacoes: " Linha 1\nLinha 2  " }), base)).toEqual({});
  });
  it("continua recusando e-mail ou nome inválido quando o campo foi alterado", () => {
    expect(zEditarClienteGestao.safeParse(dadosFormularioCliente(formulario(legado, { email: "outro inválido" }), legado)).success).toBe(false);
    expect(zEditarClienteGestao.safeParse(dadosFormularioCliente(formulario(legado, { nome: "" }), legado)).success).toBe(false);
    expect(zEditarClienteGestao.safeParse(dadosFormularioCliente(formulario(legado, { email: "cliente@example.invalid" }), legado)).success).toBe(true);
  });
  it("preserva nota antiga fora do limite, mas valida nota nova e remoção explícita", () => {
    const base = { ...legado, observacoes: "x".repeat(1001) };
    expect(dadosFormularioCliente(formulario(base, { nome: "Novo nome" }), base)).toEqual({ nome: "Novo nome" });
    expect(zEditarClienteGestao.safeParse(dadosFormularioCliente(formulario(base, { observacoes: "y".repeat(1001) }), base)).success).toBe(false);
    expect(zEditarClienteGestao.parse(dadosFormularioCliente(formulario(base, { email: "", observacoes: "" }), base))).toEqual({ email: null, observacoes: null });
  });
  it("mantém cadastro novo completo e valida todos os valores enviados", () => {
    const novo = dadosFormularioCliente(formulario());
    expect(novo).toHaveProperty("email", "não informado");
    expect(zClienteGestao.safeParse(novo).success).toBe(false);
    expect(zClienteGestao.safeParse(dadosFormularioCliente(formulario(legado, { email: "cliente@example.invalid", observacoes: "" }))).success).toBe(true);
    expect(zClienteGestao.safeParse(dadosFormularioCliente(formulario(legado, { nome: "", telefone: "", email: "" }))).success).toBe(false);
  });
  it("desativa bloqueio HTML somente na edição e preserva a validação nativa no novo", () => {
    const props = { aoSalvar: vi.fn(), aoCancelar: vi.fn() };
    const editar = renderToStaticMarkup(createElement(EditorCliente, { ...props, cliente: legado }));
    const novo = renderToStaticMarkup(createElement(EditorCliente, props));
    expect(editar).toContain('noValidate=""'); expect(editar).toContain('type="email"');
    expect(novo).not.toContain('noValidate=""'); expect(novo.match(/required=""/g)).toHaveLength(2);
  });
});
