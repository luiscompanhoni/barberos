"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, Moon, Orbit, Sun } from "lucide-react";
import { resolverTema, temaValido, type Tema } from "@/lib/visual/tema";

const CHAVE = "barberos-tema";
const EVENTO = "barberos-tema-alterado";
const OPCOES = [
  { tema: "claro", nome: "Claro", Icone: Sun }, { tema: "escuro", nome: "Escuro", Icone: Moon },
  { tema: "espacial", nome: "Espacial", Icone: Orbit }, { tema: "automatico", nome: "Automático: dia às 6h, noite às 18h, espacial à meia-noite", Icone: Clock3 },
] as const;

/** Preferência local; o escopo CSS mantém os aplicativos da Black com a própria identidade. */
export function SeletorTema() {
  const [tema, setTema] = useState<Tema>("escuro");
  const preferencia = useRef<Tema>("escuro");
  useEffect(() => {
    const atualizar = (evento?: Event) => {
      let salvo: string | null = null;
      try { salvo = localStorage.getItem(CHAVE); } catch { salvo = preferencia.current; }
      if (evento instanceof CustomEvent && temaValido(evento.detail)) salvo = evento.detail;
      const escolhido = temaValido(salvo) ? salvo : "escuro";
      preferencia.current = escolhido;
      setTema(escolhido);
      document.documentElement.setAttribute("data-crm-tema", resolverTema(escolhido));
    };
    atualizar();
    const t = setInterval(atualizar, 30_000);
    window.addEventListener(EVENTO, atualizar);
    window.addEventListener("storage", atualizar);
    return () => { clearInterval(t); window.removeEventListener(EVENTO, atualizar); window.removeEventListener("storage", atualizar); };
  }, []);
  function escolher(valor: Tema) {
    setTema(valor);
    preferencia.current = valor;
    document.documentElement.setAttribute("data-crm-tema", resolverTema(valor));
    try { localStorage.setItem(CHAVE, valor); } catch { /* A seleção ainda funciona nesta página. */ }
    window.dispatchEvent(new CustomEvent(EVENTO, { detail: valor }));
  }
  return <div className="crm-theme-picker" role="group" aria-label="Aparência do painel">
    {OPCOES.map(({ tema: valor, nome, Icone }) => <button key={valor} type="button" aria-label={nome} title={nome} aria-pressed={tema === valor} onClick={() => escolher(valor)}><Icone size={18} aria-hidden="true" /></button>)}
  </div>;
}
