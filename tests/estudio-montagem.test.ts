import { describe, expect, it } from "vitest";
import { alterada, conferida, emConflito, iniciarMontagem, reduzirMontagem, type Montagem } from "@/components/estudio/montagem";

const inicial: Montagem = { revisao: 2, nome: "Montagem Black", preset: "black-servicos-v2", titulo: "Corte", chamada: "Agende", clipes: [{ id: "a", nome: "a.mp4", bytes: 10, pronto: true, duracao: 3, inicio: 0, fim: 3, texto: "Original" }] };
describe("preservação da edição e revisão humana", () => {
  it("mantém rascunho e revisão original quando outra sessão salva; exige descarte explícito", () => {
    let e = reduzirMontagem(iniciarMontagem(inicial), { tipo: "alterar", campos: { titulo: "Meu título" } });
    e = reduzirMontagem(e, { tipo: "receber", montagem: { ...inicial, revisao: 3, titulo: "Outra sessão" } });
    expect(e.rascunho.titulo).toBe("Meu título"); expect(e.base.revisao).toBe(2); expect(emConflito(e)).toBe(true);
    e = reduzirMontagem(e, { tipo: "descartar" });
    expect(e.rascunho.titulo).toBe("Outra sessão"); expect(e.base.revisao).toBe(3); expect(alterada(e)).toBe(false);
  });
  it("atualiza formulário limpo sem aceitar resposta antiga", () => {
    let e = reduzirMontagem(iniciarMontagem(inicial), { tipo: "receber", montagem: { ...inicial, revisao: 4, nome: "Atualizado" } });
    e = reduzirMontagem(e, { tipo: "receber", montagem: inicial });
    expect(e.rascunho.nome).toBe("Atualizado"); expect(alterada(e)).toBe(false);
  });
  it("ao desfazer a própria edição adota a revisão mais recente já recebida", () => {
    let e = reduzirMontagem(iniciarMontagem(inicial), { tipo: "alterar", campos: { titulo: "Rascunho" } });
    e = reduzirMontagem(e, { tipo: "receber", montagem: { ...inicial, revisao: 3, titulo: "Servidor" } });
    e = reduzirMontagem(e, { tipo: "alterar", campos: { titulo: inicial.titulo } });
    expect(e.base.revisao).toBe(3); expect(e.rascunho.titulo).toBe("Servidor"); expect(alterada(e)).toBe(false);
  });
  it("confirma gravação sem reverter o avanço de outra sessão", () => {
    let e = reduzirMontagem(iniciarMontagem(inicial), { tipo: "alterar", campos: { chamada: "Novo convite" } });
    const salvo = { ...e.rascunho, revisao: 3 };
    e = reduzirMontagem(e, { tipo: "receber", montagem: { ...salvo, revisao: 4, nome: "Depois da gravação" } });
    e = reduzirMontagem(e, { tipo: "salvo", montagem: salvo });
    expect(e.base.revisao).toBe(4); expect(e.rascunho.nome).toBe("Depois da gravação"); expect(emConflito(e)).toBe(false);
  });
  it("não perde cortes ou ordem dos clipes durante atualização", () => {
    const b = { ...inicial.clipes[0], id: "b" };
    let e = iniciarMontagem({ ...inicial, clipes: [...inicial.clipes, b] });
    e = reduzirMontagem(e, { tipo: "alterar", campos: { clipes: [{ ...b, inicio: 0.2, fim: 0.3 }, ...inicial.clipes] } });
    e = reduzirMontagem(e, { tipo: "receber", montagem: { ...inicial, revisao: 3 } });
    expect(e.rascunho.clipes[0]).toMatchObject({ id: "b", inicio: 0.2, fim: 0.3 }); expect(emConflito(e)).toBe(true);
  });
  it("confirmação de imagem, texto e áudio não vale para uma nova versão", () => {
    let e = reduzirMontagem(iniciarMontagem(inicial), { tipo: "conferir", versaoId: "v1" });
    expect(conferida(e, "v1")).toBe(true); expect(conferida(e, "v2")).toBe(false);
    e = reduzirMontagem(e, { tipo: "conferir", versaoId: "v2" });
    expect(conferida(e, "v2")).toBe(true);
    e = reduzirMontagem(e, { tipo: "conferir", versaoId: null });
    expect(conferida(e, "v2")).toBe(false);
  });
});
