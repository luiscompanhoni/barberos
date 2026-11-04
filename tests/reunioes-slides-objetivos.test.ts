import { describe, expect, it } from "vitest";
import { slidesDaReuniao } from "@/components/reunioes/Apresentacao";
import type { ReuniaoResposta } from "@/lib/reunioes/tipos";

const reuniao = {
  titulo: "Semanal", inicio: "2026-10-26", fim: "2026-11-01", tipo: "SEMANAL", conteudo: "", acoes: [],
  snapshot: { atual: { atendimentos: 30, faturamentoCentavos: 100000, ocupacao: .75 }, anterior: { faturamentoCentavos: 90000 }, leituras: [] },
} as unknown as ReuniaoResposta;

describe("apresentação concisa da reunião", () => {
  it("mostra situação e objetivos pendentes sem dados pessoais nem itens concluídos", () => {
    const slides = slidesDaReuniao(reuniao, [
      { id: "1", tipo: "OBJETIVO", texto: "Melhorar a pontualidade", concluido: false, versao: 1 },
      { id: "2", tipo: "AVISO", texto: "Varrer após atender", concluido: false, versao: 1 },
      { id: "3", tipo: "AVISO", texto: "Já foi concluído", concluido: true, versao: 2 },
    ]);
    expect(slides.find(s => s.titulo === "Onde estamos")?.linhas).toContain("30 atendimentos concluídos");
    expect(slides.find(s => s.titulo === "Onde queremos chegar")?.linhas).toContain("Melhorar a pontualidade");
    expect(slides.find(s => s.titulo === "Avisos para a equipe")?.linhas).toContain("Varrer após atender");
    expect(JSON.stringify(slides)).not.toContain("Já foi concluído");
    expect(slides.every(s => s.linhas.length <= 4)).toBe(true);
  });
  it("não inventa meta quando a gestão ainda não registrou um objetivo", () => {
    const slide = slidesDaReuniao(reuniao).find(s => s.titulo === "Onde queremos chegar");
    expect(slide?.linhas[0]).toContain("ainda não informado");
  });
});
