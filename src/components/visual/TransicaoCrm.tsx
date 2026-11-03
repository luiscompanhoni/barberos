"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Anima os blocos que chegam sem remontar páginas, formulários ou assinaturas SSE. */
export function TransicaoCrm({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = raiz.current;
    if (!node || typeof node.animate !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const animados = new WeakSet<Element>();
    const animacoes = new Set<Animation>();
    function animar() {
      if (!node || media.matches) return;
      const blocos = Array.from(node.children).flatMap(pagina => {
        const seletor = ".cartao, .cartao-destaque, .crm-card, [data-crm-reveal]";
        const titulos = Array.from(pagina.children).filter((n): n is HTMLElement => n instanceof HTMLElement && n.tagName === "HEADER");
        const cartoes = Array.from(pagina.querySelectorAll<HTMLElement>(seletor)).filter(n => !n.parentElement?.closest(seletor));
        const filhos = [...titulos, ...cartoes];
        return filhos.length ? filhos : pagina instanceof HTMLElement ? [pagina] : [];
      }).slice(0, 16);
      let ordem = 0;
      for (const bloco of blocos) {
        if (animados.has(bloco)) continue;
        animados.add(bloco);
        const a = bloco.animate([
          { opacity: .35, transform: "translate3d(0, 8px, 0)", filter: "blur(3px)" },
          { opacity: 1, transform: "translate3d(0, 0, 0)", filter: "blur(0)" },
        ], { duration: 350, delay: Math.min(ordem++ * 90, 360), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
        animacoes.add(a);
        a.onfinish = () => animacoes.delete(a);
      }
    }
    const cancelar = () => { if (media.matches) for (const a of animacoes) a.cancel(); };
    animar();
    // As telas carregam dados após montar: observa apenas os primeiros blocos inseridos.
    const observer = new MutationObserver(registros => {
      // Contadores só alteram texto; não precisam de nova busca dos cartões.
      if (registros.some(r => Array.from(r.addedNodes).some(n => n.nodeType === Node.ELEMENT_NODE))) animar();
    });
    observer.observe(node, { childList: true, subtree: true });
    const limite = window.setTimeout(() => observer.disconnect(), 8000);
    media.addEventListener("change", cancelar);
    return () => {
      window.clearTimeout(limite); observer.disconnect(); media.removeEventListener("change", cancelar);
      for (const a of animacoes) a.cancel();
    };
  }, [pathname]);
  return <div ref={raiz} className="crm-page">{children}</div>;
}
