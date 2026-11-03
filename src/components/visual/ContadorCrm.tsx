"use client";

import { useEffect, useRef } from "react";
const numero = (v: number) => Math.round(v).toLocaleString("pt-BR");

/** O leitor de tela recebe o valor final; só a apresentação acompanha a entrada dos cartões. */
export function ContadorCrm({ valor, formatar = numero }: { valor: number; formatar?: (v: number) => string }) {
  const visual = useRef<HTMLSpanElement>(null), anterior = useRef(0);
  useEffect(() => {
    const node = visual.current;
    if (!node || !Number.isFinite(valor)) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let quadro = 0;
    const finalizar = () => { cancelAnimationFrame(quadro); anterior.current = valor; node.textContent = formatar(valor); };
    if (media.matches) { finalizar(); return; }
    const inicio = performance.now(), origem = anterior.current;
    const passo = (agora: number) => {
      const t = Math.min(1, Math.max(0, (agora - inicio) / 720));
      anterior.current = origem + (valor - origem) * (1 - (1 - t) ** 3);
      node.textContent = formatar(anterior.current);
      if (t < 1) quadro = requestAnimationFrame(passo);
      else finalizar();
    };
    quadro = requestAnimationFrame(passo);
    const mudar = () => { if (media.matches) finalizar(); };
    media.addEventListener("change", mudar);
    return () => { cancelAnimationFrame(quadro); media.removeEventListener("change", mudar); };
  }, [valor, formatar]);
  return <span><span className="sr-only">{formatar(valor)}</span><span aria-hidden="true" ref={visual}>{formatar(valor)}</span></span>;
}
