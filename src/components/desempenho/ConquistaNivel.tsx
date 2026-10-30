"use client";

import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { SeloNivel, type Nivel } from "@/components/checklist/SeloNivel";
import estilos from "@/components/checklist/niveis.module.css";

export function ConquistaNivel({ pessoaId, nivel }: { pessoaId: string; nivel: Nivel }) {
  const [mostrar, setMostrar] = useState(false);
  useEffect(() => {
    const niveis = ["ELITE", "PLATINA", "LEGEND"], chave = `barberos:nivel:${pessoaId}`;
    let timer: ReturnType<typeof setTimeout> | undefined, fechar: ReturnType<typeof setTimeout> | undefined;
    try {
      const anterior = window.localStorage.getItem(chave);
      window.localStorage.setItem(chave, nivel);
      if (anterior && niveis.indexOf(nivel) > niveis.indexOf(anterior)) {
        timer = setTimeout(() => setMostrar(true), 0);
        fechar = setTimeout(() => setMostrar(false), 6500);
      }
    } catch { /* A preferência visual é opcional quando o navegador bloqueia armazenamento. */ }
    return () => { clearTimeout(timer); clearTimeout(fechar); };
  }, [pessoaId, nivel]);
  if (!mostrar) return null;
  return <div className={estilos.conquista} role="status"><button className="absolute right-3 top-2 text-sm" aria-label="Fechar conquista" onClick={() => setMostrar(false)}>✕</button><Crown size={40} className="mx-auto mb-3" aria-hidden="true" /><p className="mb-3 text-xl font-bold">Uma nova conquista!</p><SeloNivel nivel={nivel} /><p className="mt-3 text-sm">Seu trabalho fez você avançar de faixa.</p></div>;
}
