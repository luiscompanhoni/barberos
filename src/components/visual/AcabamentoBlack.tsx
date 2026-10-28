"use client";

import { useSyncExternalStore } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";

const consulta = "(prefers-reduced-motion: reduce)";
function assinarMovimento(atualizar: () => void) {
  const media = window.matchMedia(consulta);
  media.addEventListener("change", atualizar);
  return () => media.removeEventListener("change", atualizar);
}
const movimentoPermitido = () => !window.matchMedia(consulta).matches;
const semMovimentoNoServidor = () => false;

/** Detalhe decorativo de rolagem. Não representa conclusão de tarefas nem captura cliques. */
export function AcabamentoBlack() {
  const animar = useSyncExternalStore(assinarMovimento, movimentoPermitido, semMovimentoNoServidor);
  return animar ? <TrilhaDeCorte /> : null;
}

function TrilhaDeCorte() {
  const { scrollY, scrollYProgress } = useScroll();
  const progresso = useSpring(scrollYProgress, { stiffness: 170, damping: 32, restDelta: 0.001 });
  const posicao = useTransform(progresso, (v) => `${v * 100}%`);
  const abertura = useTransform(scrollY, (v) => 7 + Math.sin(v / 22) * 7);
  const outraLamina = useTransform(abertura, (v) => -v);

  return (
    <div className="black-scroll" aria-hidden="true">
      <motion.div className="black-scroll__topo" style={{ scaleX: progresso }} />
      <div className="black-scroll__trilho">
        <motion.div className="black-scroll__corte" style={{ top: posicao }}>
          <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <motion.g style={{ rotate: abertura, transformOrigin: "16px 16px" }}>
              <circle cx="10" cy="25" r="4" />
              <path d="m12 21 12-18-8 13" />
            </motion.g>
            <motion.g style={{ rotate: outraLamina, transformOrigin: "16px 16px" }}>
              <circle cx="22" cy="25" r="4" />
              <path d="M20 21 8 3l8 13" />
            </motion.g>
            <circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </motion.div>
      </div>
    </div>
  );
}
