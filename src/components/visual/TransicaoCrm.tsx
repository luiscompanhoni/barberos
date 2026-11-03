"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { observarSubabasCrm } from "./subabas-crm";

/** Anima os blocos que chegam sem remontar páginas, formulários ou assinaturas SSE. */
export function TransicaoCrm({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = raiz.current;
    if (!node || typeof node.animate !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const subabas = observarSubabasCrm(node);
    const animados = new WeakSet<Element>();
    const animacoes = new Set<Animation>();
    let frame = 0;
    function animar() {
      if (!node || media.matches) return;
      const blocos = Array.from(node.children).flatMap(pagina => {
        const seletor = ".cartao, .cartao-destaque, .crm-card, .crm-operation-card, .crm-collection:not(.grid), .crm-person-card, [data-crm-reveal]";
        const titulos = Array.from(pagina.querySelectorAll<HTMLElement>(".crm-page-header, .cabecalho-gestao, header")).filter(n => !n.parentElement?.closest(seletor));
        const cartoes = Array.from(pagina.querySelectorAll<HTMLElement>(seletor)).filter(n => !n.parentElement?.closest(seletor));
        const filhos = [...titulos, ...cartoes];
        return filhos.length ? filhos : pagina instanceof HTMLElement ? [pagina] : [];
      }).slice(0, 16);
      let ordem = 0;
      for (const bloco of blocos) {
        if (animados.has(bloco)) continue;
        animados.add(bloco);
        const a = bloco.animate([
          { opacity: .35, transform: "translate3d(0, 8px, 0)" },
          { opacity: 1, transform: "translate3d(0, 0, 0)" },
        ], { duration: 350, delay: Math.min(ordem++ * 90, 360), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
        animacoes.add(a);
        node.dataset.crmEntering = "true";
        const terminar = () => {
          animacoes.delete(a);
          if (!animacoes.size) delete node.dataset.crmEntering;
        };
        a.onfinish = terminar;
        a.oncancel = terminar;
      }
    }
    const cancelar = () => { if (media.matches) for (const a of animacoes) a.cancel(); };
    function agendar() {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; animar(); subabas.atualizar(); });
    }
    animar();
    // Também cobre conteúdo que chega depois e trocas de subaba, sem remontar formulários.
    const observer = new MutationObserver(registros => {
      // Contadores só alteram texto; não precisam de nova busca dos cartões.
      if (registros.some(r => r.type === "attributes" || Array.from(r.addedNodes).some(n => n.nodeType === Node.ELEMENT_NODE))) agendar();
    });
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-current", "aria-pressed", "aria-selected"] });
    media.addEventListener("change", cancelar);
    return () => {
      cancelAnimationFrame(frame); subabas.desligar(); observer.disconnect(); media.removeEventListener("change", cancelar);
      for (const a of animacoes) a.cancel();
      delete node.dataset.crmEntering;
    };
  }, [pathname]);
  return <div ref={raiz} className="crm-page">{children}</div>;
}
