/** Assinatura tipográfica; mantém o nome configurado sem substituir a logo oficial. */
export function Marca({ nome, tamanho = "md" }: { nome: string; tamanho?: "md" | "lg" }) {
  const black = /^black(?:\s|$)/i.test(nome.trim());
  return <span className={`black-brand ${tamanho === "lg" ? "black-brand--large" : ""}`}>
    <span className="black-brand-seal" aria-hidden="true">{nome.trim()[0]?.toUpperCase() || "B"}<small>{black ? "BLACK" : "BARBER"}</small></span>
    <span className="black-brand-name">{black ? <>BLACK<small>BARBER</small><span className="sr-only">{nome.trim().replace(/^black\s*(barber)?/i, "")}</span></> : nome}</span>
  </span>;
}
