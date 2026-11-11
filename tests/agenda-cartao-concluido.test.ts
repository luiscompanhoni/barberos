import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Grade } from "@/components/agenda/Grade";
import type { AgendamentoApi } from "@/components/agenda/tipos";

const fuso = "America/Sao_Paulo";
const data = "2026-11-12";
const base: AgendamentoApi = {
  id: "ag-teste", barbeiroId: "barbeiro-teste", inicio: `${data}T15:00:00Z`, fim: `${data}T15:10:00Z`,
  status: "EM_ATENDIMENTO", origem: "RECEPCAO", precoCentavos: 4000, observacao: null, semPreferencia: false, assinante: false,
  cliente: { id: "cliente-teste", nome: "Cliente teste", telefone: "5511000000000", observacoes: null },
  servico: { id: "servico-teste", nome: "Corte" },
};

function grade(ag: AgendamentoApi) {
  return renderToStaticMarkup(createElement(Grade, {
    colunas: [{
      data, chave: `${ag.barbeiroId}|${data}`, barbeiroId: ag.barbeiroId, titulo: "Profissional teste",
      barbeiroNome: "Profissional teste", cor: "#d3ab45", fotoVersao: 0, janelas: [], bloqueios: [],
    }],
    agendamentos: [ag], fuso, granularidadeMin: 5, podeEditar: () => true, podeDuracao: true,
    intervaloEntreClientesMin: 0, onMover: async () => {}, onAbrir: () => {}, onVazio: () => {},
  }));
}

it("o cartão curto concluído é um botão nativo e anuncia a situação sem depender do verde", () => {
  const html = grade({ ...base, status: "CONCLUIDO" });
  expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-haspopup="dialog"[^>]*title="Cliente teste · Corte · Concluído"/);
  expect(html).toContain('class="sr-only">Concluído</span>');
  expect(html).not.toContain("cursor-ns-resize");
});

it("o atendimento em andamento mantém a situação e o controle de duração", () => {
  const html = grade(base);
  expect(html).toContain('title="Cliente teste · Corte · Na cadeira"');
  expect(html).toContain("cursor-ns-resize");
  expect(html).not.toContain("Concluído");
});
