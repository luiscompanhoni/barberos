import Image from "next/image";

/** Marca do sistema; o nome configurado continua identificando a barbearia. */
export function Marca({ nome, tamanho = "md" }: { nome: string; tamanho?: "md" | "lg" }) {
  return <span className={`black-brand barberos-brand ${tamanho === "lg" ? "black-brand--large" : ""}`}>
    <span className="black-brand-seal" aria-hidden="true"><Image src="/brand/barberos-app.svg" alt="" width={58} height={58} unoptimized /></span>
    <span className="black-brand-name"><Image src="/brand/barberos-wordmark.svg" alt="BarberOS" width={160} height={29} unoptimized /><small>{nome}</small></span>
  </span>;
}
