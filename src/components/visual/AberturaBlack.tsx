"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Marca } from "@/components/Marca";

/** Apenas a abertura: não remonta formulários nem interfere nos dados da agenda. */
export function AberturaBlack({ area }: { area: "cliente" | "barbeiro" }) {
  const caminho = usePathname();
  const cliente = area === "cliente";
  if (cliente ? caminho !== "/c" : !["/meu-dia", "/minha-agenda", "/recepcao"].includes(caminho)) return null;

  return <section className={`black-welcome ${cliente ? "black-welcome--client" : ""}`} aria-label="Bem-vindo à Black Barber">
    <Image className="black-welcome-photo" src="/brand/black/fachada.webp" alt="" fill sizes={cliente ? "(max-width: 672px) 100vw, 672px" : "(max-width: 1023px) 100vw, 1200px"} preload />
    <div className="black-welcome-atmosphere" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => <span key={i} />)}
    </div>
    <div className="black-welcome-content">
      {cliente ? <Marca nome="Black Barber" tamanho="lg" /> : <p className="black-welcome-eyebrow">Seu espaço na Black</p>}
      <div>
        <h2>{cliente ? "Bem-vindo à Black." : "Seu dia começa aqui."}</h2>
        <p>{cliente ? "Cuidado que faz parte da sua rotina." : "Agenda organizada. Atenção em cada detalhe."}</p>
      </div>
      <Link className="btn-primario black-welcome-action" href={cliente ? "/c/agendar" : "/minha-agenda"}>
        {cliente ? "Agendar meu horário" : "Ver minha agenda"}<span aria-hidden="true">→</span>
      </Link>
    </div>
  </section>;
}
