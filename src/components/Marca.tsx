import Image from "next/image";

/** Os aplicativos usam a arte original da Black; a gestão identifica o BarberOS. */
export function Marca({ nome, tamanho = "md", identidade = "black" }: {
  nome: string; tamanho?: "md" | "lg"; identidade?: "black" | "barberos";
}) {
  if (identidade === "black") return <span className={`black-logo ${tamanho === "lg" ? "black-logo--large" : ""}`}>
    <Image src="/brand/black/logo-original.png" alt={nome} width={144} height={144} unoptimized />
  </span>;
  return <span className={`black-brand barberos-brand ${tamanho === "lg" ? "black-brand--large" : ""}`}>
    <span className="black-brand-seal" aria-hidden="true"><Image src="/brand/barberos-app.svg" alt="" width={58} height={58} unoptimized /></span>
    <span className="black-brand-name"><Image src="/brand/barberos-wordmark.svg" alt="BarberOS" width={160} height={29} unoptimized /><small>{nome}</small></span>
  </span>;
}
