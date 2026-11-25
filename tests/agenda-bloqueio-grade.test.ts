import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Grade } from "@/components/agenda/Grade";
function grade({ permitido = true, propria = true, id = "bloqueio" } = {}) {
  return renderToStaticMarkup(createElement(Grade, {
    colunas: [{ data: "2026-11-25", chave: "b|2026-11-25", barbeiroId: "b", titulo: "Profissional", barbeiroNome: "Profissional", cor: "#ddaa44", fotoVersao: 0,
      janelas: [], bloqueios: [{ id, inicio: "2026-11-25T13:00:00Z", fim: "2026-11-25T14:00:00Z", motivo: "Pausa" }] }],
    agendamentos: [], fuso: "America/Sao_Paulo", granularidadeMin: 5, podeEditar: () => propria, podeDuracao: true,
    podeBloquear: permitido, onAbrirBloqueio: () => {}, intervaloEntreClientesMin: 0, onMover: async () => {}, onAbrir: () => {}, onVazio: () => {},
  }));
}
it("o bloqueio pode ser aberto por botão acessível diretamente na agenda", () => {
  const html = grade();expect(html).toContain('aria-label="Abrir bloqueio de Profissional"');expect(html).toContain("Remover bloqueio");
});
it.each([{ permitido: false }, { propria: false }, { id: "entrevista:teste" }])("não oferece remoção sem permissão, em outra agenda ou em entrevista", entrada => {
  const html = grade(entrada);expect(html).toContain("Pausa");expect(html).not.toContain("Abrir bloqueio de Profissional");
});
