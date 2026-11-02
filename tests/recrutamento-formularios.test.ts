import { describe, it, expect } from "vitest";
import { zDefinicao, zFormulario, publico, validarRespostas, perguntasVisiveis, calcularAvaliacao } from "@/lib/recrutamento/formularios-regras";
import { MODELOS } from "@/lib/recrutamento/modelos-formularios";
import { hashesCandidatura } from "@/lib/recrutamento/hash-candidatura";
import { zCandidatura } from "@/lib/recrutamento/regras";
const base = () => structuredClone(MODELOS[0].definicao);
const preenchidas = () => base().criterios.map(c => ({ id: c.id, nivel: 2, evidencia: "Descreveu as etapas e a conferência." }));
describe("formulários profissionais versionados", () => {
  it.each(MODELOS)("valida o modelo inicial $funcao sem limitar a cinco perguntas", m => {
    expect(zFormulario.safeParse(m).success).toBe(true); expect(m.definicao.perguntas.length).toBeGreaterThan(5);
  });
  it("não serializa rubrica, pesos nem critérios na visão pública", () => {
    const p = publico({ ...MODELOS[0], id: "versao" });
    expect(Object.keys(p).sort()).toEqual(["funcao", "id", "perguntas", "titulo"]);
    expect(JSON.stringify(p)).not.toMatch(/rubrica|criterios|critico|peso|aprovadoPor/);
  });
  it.each(["__proto__", "prototype", "constructor"])("recusa identificador reservado %s", id => { const d = base(); d.perguntas[0].id = id; expect(zDefinicao.safeParse(d).success).toBe(false); });
  it("separa os cinco serviços e mantém notas fora da visão pública", () => {
    const p = MODELOS[0].definicao.perguntas.filter(p => /^p5(?:_|$)/.test(p.id));
    expect(p).toHaveLength(5); expect(p.every(x => x.tipo === "UNICA")).toBe(true);
    expect(p.every(x => x.opcoes.every(o => !/^[0-9]/.test(o)))).toBe(true);
  });
  it("normaliza espaços opcionais sem transformar obrigatório vazio em resposta", () => {
    const d = base(); d.perguntas = [{ ...d.perguntas[0], obrigatoria: false }];
    expect(validarRespostas(d, { [d.perguntas[0].id]: "   " })).toEqual({});
    d.perguntas[0].obrigatoria = true; expect(() => validarRespostas(d, { [d.perguntas[0].id]: "   " })).toThrow();
  });
  it("não calcula nota com evidência composta só de espaços ou nível fora da escala", () => {
    const a = preenchidas(); a[0].evidencia = "     "; expect(() => calcularAvaliacao(base(), a)).toThrow();
    a[0].evidencia = "Evidência profissional"; a[0].nivel = 4; expect(() => calcularAvaliacao(base(), a)).toThrow();
  });
  it("hash não depende da ordem das chaves ou das múltiplas escolhas", () => {
    const b = zCandidatura.parse({ envioId: "37f1774b-6347-481c-b685-b0b0cf4f61ab", nome: "Pessoa teste", telefone: "11999998888", cidade: "Rio do Sul", experienciaMeses: 0, servicos: ["Barba", "Degradê"], disponibilidade: "Segunda", cienciaPrivacidade: true, formularioId: "f", respostas: { a: ["Um", "Dois"], b: "Resposta" } });
    const c = { ...b, servicos: [...b.servicos].reverse(), respostas: { b: "Resposta", a: ["Dois", "Um"] } };
    expect(hashesCandidatura("v", b).conteudoHash).toBe(hashesCandidatura("v", c).conteudoHash);
    expect(hashesCandidatura("v", { ...c, nome: "Outra pessoa" }).conteudoHash).not.toBe(hashesCandidatura("v", b).conteudoHash);
  });
  it("recusa pesos inválidos e vínculos quebrados", () => {
    const d = base(); d.criterios[0].peso++; expect(zDefinicao.safeParse(d).success).toBe(false);
    d.criterios[0].peso--; d.criterios[0].perguntas = ["inexistente"]; expect(zDefinicao.safeParse(d).success).toBe(false);
  });
  it("recusa ids duplicados, opções iguais e ciclos", () => {
    const d = base(); d.perguntas[1].id = d.perguntas[0].id; expect(zDefinicao.safeParse(d).success).toBe(false);
    const e = base(); e.perguntas[0].tipo = "UNICA"; e.perguntas[0].opcoes = ["Sim", "Sim"]; expect(zDefinicao.safeParse(e).success).toBe(false);
    const f = base(); f.perguntas[0].condicao = { perguntaId: f.perguntas[1].id, valor: "Sim" }; expect(zDefinicao.safeParse(f).success).toBe(false);
  });
  it("não aceita resposta oculta, arbitrária, obrigatória ausente ou link inseguro", () => {
    const d = base(); d.perguntas = [{ ...d.perguntas[0], tipo: "LINK", obrigatoria: true }];
    expect(() => validarRespostas(d, {})).toThrow();
    expect(() => validarRespostas(d, { [d.perguntas[0].id]: "javascript:alert(1)" })).toThrow();
    expect(() => validarRespostas(d, { [d.perguntas[0].id]: "https://teste.com", extra: "nota 10" })).toThrow();
  });
  it("respeita ramificações encadeadas e impede respostas ocultas", () => {
    const d = base(); const [a,b,c] = d.perguntas;
    a.tipo = "UNICA"; a.opcoes = ["Sim", "Não"]; b.tipo = "UNICA"; b.opcoes = ["Sim", "Não"]; b.condicao = { perguntaId: a.id, valor: "Sim" }; c.condicao = { perguntaId: b.id, valor: "Sim" }; d.perguntas = [a,b,c];
    expect(perguntasVisiveis(d.perguntas, { [a.id]: "Não", [b.id]: "Sim" }).map(p => p.id)).toEqual([a.id]);
    expect(() => validarRespostas(d, { [a.id]: "Não", [b.id]: "Sim" })).toThrow();
    expect(validarRespostas(d, { [a.id]: "Não" })).toEqual({ [a.id]: "Não" });
  });
  it("pendente não é zero; notas usam pesos e evidências", () => {
    const d = base(); const itens: { id: string; nivel: number | null; evidencia: string }[] = preenchidas();
    itens[0].nivel = null; expect(calcularAvaliacao(d, itens).nota).toBeNull();
    itens.forEach(i => { i.nivel = 0; }); expect(calcularAvaliacao(d, itens).nota).toBe(0);
    itens.forEach(i => { i.nivel = 3; }); expect(calcularAvaliacao(d, itens).nota).toBe(10);
    itens[0].nivel = 0; expect(calcularAvaliacao(d, itens).nota).toBe(6.5);
    itens[0].evidencia = ""; expect(() => calcularAvaliacao(d, itens)).toThrow();
  });
  it("destaca competência crítica mesmo com média alta", () => {
    const d = base(); const itens = preenchidas(); itens.forEach(i => { i.nivel = 3; });
    const index = d.criterios.findIndex(c => c.critico); itens[index].nivel = 1;
    expect(calcularAvaliacao(d, itens).criticosPendentes).toEqual([d.criterios[index].nome]);
  });
  it("recusa critérios repetidos e não exige serviços de barbeiro no modelo por função", () => {
    expect(() => calcularAvaliacao(base(), [preenchidas()[0], ...preenchidas().slice(0,3)])).toThrow();
    const b = { envioId: "37f1774b-6347-481c-b685-b0b0cf4f61ab", nome: "Pessoa teste", telefone: "11999998888", cidade: "Rio do Sul", experienciaMeses: 0, servicos: [], disponibilidade: "Segunda-feira", cienciaPrivacidade: true };
    expect(zCandidatura.safeParse(b).success).toBe(false);
    expect(zCandidatura.safeParse({ ...b, formularioId: "versao", respostas: {} }).success).toBe(true);
  });
});
