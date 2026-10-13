import { notFound } from "next/navigation";
import { ChecklistPublico } from "@/components/checklist/ChecklistPublico";
import { Marca } from "@/components/Marca";
import { listaPublica } from "@/lib/checklist/servico";

export const dynamic = "force-dynamic";

/** Link pessoal do checklist, mandado no WhatsApp (sem login). */
export default async function ChecklistDoDia(props: PageProps<"/t/[token]">) {
  const { token } = await props.params;
  const l = await listaPublica(token);
  if (!l) notFound();
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-6 p-4 pb-10">
      <Marca nome={l.barbearia} />
      <ChecklistPublico token={token} nome={l.nome} data={l.data} itens={l.itens} pontos={l.pontos} />
    </main>
  );
}
