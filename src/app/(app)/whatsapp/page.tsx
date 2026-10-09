import { redirect } from "next/navigation";
import { ConexaoWhatsApp } from "@/components/whatsapp/ConexaoWhatsApp";
import { sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** Conexao do WhatsApp (so o dono). */
export default async function WhatsApp() {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO") redirect("/");
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <p className="eyebrow">Configurações</p>
        <h1 className="titulo-marca text-2xl">WhatsApp</h1>
      </div>
      <ConexaoWhatsApp />
    </div>
  );
}
