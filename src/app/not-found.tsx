import Link from "next/link";
import { connection } from "next/server";
import { Marca } from "@/components/Marca";
import { configuracao } from "@/lib/agenda/carregar";

/**
 * Pagina de "nao encontrado" do site e do painel: link de pagamento ou de checklist que nao existe
 * mais (ou veio cortado), endereco digitado errado. Sem banco (ex.: fora do ar), mostra o nome padrao.
 */
export default async function NaoEncontrado() {
  await connection(); // nome da barbearia vem do banco: nao pode ser gerada no build
  const nome = await configuracao().then((c) => c.nomeBarbearia).catch(() => process.env.NOME_BARBEARIA || "BarberOS");
  const whatsapp = process.env.WHATSAPP_NUMERO_PUBLICO?.replace(/\D/g, "") || null;

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-12">
      <section className="entrar-suave w-full max-w-md text-center">
        <div className="flex justify-center"><Marca nome={nome} /></div>
        <p className="mt-12 text-5xl font-black text-ouro">404</p>
        <h1 className="mt-3 text-xl font-bold">Página não encontrada</h1>
        <p className="mt-3 text-sm text-zinc-600">
          Esse link não existe ou não vale mais. Se ele veio numa mensagem da barbearia, peça um novo pelo WhatsApp.
        </p>
        <div className="mt-8 space-y-3">
          {whatsapp && (
            <a className="btn-primario w-full py-3" href={`https://wa.me/${whatsapp}`}>Falar com a barbearia no WhatsApp</a>
          )}
          <Link className={`${whatsapp ? "btn" : "btn-primario"} w-full py-3`} href="/">Ir para o início</Link>
        </div>
      </section>
    </main>
  );
}
