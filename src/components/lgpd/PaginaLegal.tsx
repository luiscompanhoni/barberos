import Link from "next/link";
import { Marca } from "@/components/Marca";
import type { Controlador } from "@/lib/lgpd/textos";

/** Moldura das paginas publicas de Termos e Privacidade (site do cliente). */
export function PaginaLegal({ titulo, versao, controlador: c, children }: { titulo: string; versao: string; controlador: Controlador; children: React.ReactNode }) {
  const [a, m, d] = versao.split("-");
  return (
    <div className="min-h-full bg-fundo">
      <header className="border-b border-[rgba(255,255,255,0.05)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/assine"><Marca nome={c.nomeFantasia} /></Link>
          <Link href="/c" className="text-sm text-zinc-500 underline hover:text-zinc-900">Área do cliente</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">
        <p className="eyebrow">Privacidade e uso</p>
        <h1 className="titulo-marca mt-2 text-3xl">{titulo}</h1>
        <p className="mt-2 text-sm text-zinc-500">Versão de {d}/{m}/{a}</p>
        <div className="texto-legal mt-8 space-y-6 text-[15px] leading-7 text-zinc-700">{children}</div>
        <nav className="mt-12 flex gap-5 border-t border-[rgba(255,255,255,0.05)] pt-6 text-sm text-zinc-500">
          <Link href="/privacidade" className="underline hover:text-zinc-900">Política de privacidade</Link>
          <Link href="/termos" className="underline hover:text-zinc-900">Termos de uso</Link>
        </nav>
      </main>
    </div>
  );
}

/** Bloco "quem somos e como falar com a gente", igual nas duas paginas. */
export function Contato({ c }: { c: Controlador }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li><b className="text-zinc-900">{c.nome}</b>{c.nome !== c.nomeFantasia ? ` (${c.nomeFantasia})` : ""}{c.cnpj ? `, CNPJ ${c.cnpj}` : ""}</li>
      {c.endereco && <li>Endereço: {c.endereco}</li>}
      {c.whatsapp && <li>WhatsApp: <a className="text-ouro underline" href={c.whatsappLink!} target="_blank" rel="noreferrer">{c.whatsapp}</a></li>}
      {c.email && <li>E-mail: <a className="text-ouro underline" href={`mailto:${c.email}`}>{c.email}</a></li>}
    </ul>
  );
}

export const Secao = ({ t, children }: { t: string; children: React.ReactNode }) => (
  <section className="space-y-3"><h2 className="text-lg font-semibold text-zinc-900">{t}</h2>{children}</section>
);
