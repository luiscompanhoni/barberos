import { describe, expect, it } from "vitest";
import { validarMudancaDeAcesso } from "@/lib/auth/equipe-regras";
import { zCriarUsuario, zEditarUsuario } from "@/lib/auth/equipe-schemas";

const dono = { proprio: false, papelAtual: "DONO" as const, ativoAtual: true, papel: "GERENTE" as const, ativo: true, donosAtivos: 1 };

describe("proteção dos acessos", () => {
  it("último dono não pode perder a função nem ser desativado", () => {
    expect(() => validarMudancaDeAcesso(dono)).toThrow("pelo menos um dono");
    expect(() => validarMudancaDeAcesso({ ...dono, papel: "DONO", ativo: false })).toThrow("pelo menos um dono");
  });
  it("segundo dono pode ser rebaixado por outro, mas não perde a própria sessão por engano", () => {
    expect(() => validarMudancaDeAcesso({ ...dono, donosAtivos: 2 })).not.toThrow();
    expect(() => validarMudancaDeAcesso({ ...dono, donosAtivos: 2, proprio: true })).toThrow("Outro dono");
  });
  it("editar os próprios dados sem retirar acesso é permitido", () => {
    expect(() => validarMudancaDeAcesso({ ...dono, proprio: true, papel: "DONO" })).not.toThrow();
  });
  it("promoção de barbeiro é permitida; cliente não pode ser promovido por esta operação", () => {
    expect(() => validarMudancaDeAcesso({ ...dono, papelAtual: "BARBEIRO", papel: "LIDER" })).not.toThrow();
    expect(() => validarMudancaDeAcesso({ ...dono, papelAtual: "CLIENTE" })).toThrow("cadastro de clientes");
  });
});

describe("dados de acesso", () => {
  it("aceita função de líder com agenda e permissões específicas", () => {
    expect(zEditarUsuario.parse({ papel: "LIDER", atende: true, permissoes: { bloquear_agenda: false, lucro: null } })).toMatchObject({ papel: "LIDER", atende: true });
  });
  it("recusa campos de senha e permissões desconhecidas", () => {
    expect(zEditarUsuario.safeParse({ senhaHash: "inventada" }).success).toBe(false);
    expect(zEditarUsuario.safeParse({ permissoes: { superadmin: true } }).success).toBe(false);
  });
  it("novo acesso exige identificação e não aceita cliente", () => {
    expect(zCriarUsuario.safeParse({ nome: "João", telefone: "11999999999", papel: "LIDER" }).success).toBe(true);
    expect(zCriarUsuario.safeParse({ papel: "BARBEIRO" }).success).toBe(false);
    expect(zCriarUsuario.safeParse({ nome: "João", telefone: "11999999999", papel: "CLIENTE" }).success).toBe(false);
  });
});
