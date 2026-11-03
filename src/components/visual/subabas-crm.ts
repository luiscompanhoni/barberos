/** A seleção acompanha subabas reais; não troca rotas, foco ou estado dos módulos. */
export function observarSubabasCrm(raiz: HTMLElement) {
  const observados = new Set<Element>();
  let frame = 0;
  const resize = new ResizeObserver(agendar);
  function atualizar() {
    frame = 0;
    const barras = Array.from(raiz.querySelectorAll<HTMLElement>(".crm-subtabs"));
    const atuais = new Set<Element>(barras.flatMap(nav => [nav, ...Array.from(nav.children)]));
    for (const el of observados) if (!atuais.has(el)) { resize.unobserve(el); observados.delete(el); }
    for (const el of atuais) if (!observados.has(el)) { resize.observe(el); observados.add(el); }
    const medidas = barras.map(nav => {
      const ativo = Array.from(nav.children).find(el => el.matches('[aria-current="page"], [aria-pressed="true"], [aria-selected="true"]'));
      if (!(ativo instanceof HTMLElement)) return { nav, rect: null };
      const pai = nav.getBoundingClientRect();
      const item = ativo.getBoundingClientRect();
      return { nav, rect: { x: item.left - pai.left + nav.scrollLeft - nav.clientLeft,
        y: item.top - pai.top + nav.scrollTop - nav.clientTop, width: item.width, height: item.height } };
    });
    // Todas as leituras precedem as escritas, inclusive quando há várias barras na tela.
    for (const { nav, rect } of medidas) {
      if (!rect || !rect.width || !rect.height) { delete nav.dataset.crmPill; continue; }
      nav.style.setProperty("--crm-pill-x", `${rect.x}px`);
      nav.style.setProperty("--crm-pill-y", `${rect.y}px`);
      nav.style.setProperty("--crm-pill-width", `${rect.width}px`);
      nav.style.setProperty("--crm-pill-height", `${rect.height}px`);
      nav.dataset.crmPill = "true";
    }
  }
  function agendar() { if (!frame) frame = requestAnimationFrame(atualizar); }
  agendar();
  return { atualizar: agendar, desligar: () => { cancelAnimationFrame(frame); resize.disconnect(); } };
}
