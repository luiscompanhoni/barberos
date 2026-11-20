import { previaConvite, tokenDeConvite } from "@/lib/convites/link";
import { FormularioLogin } from "@/components/login/FormularioLogin";
import { configuracao } from "@/lib/agenda/carregar";
import { modoCodigoNaTela } from "@/lib/auth/otp";
import { provedoresDisponiveis } from "@/lib/auth/social-provedores";

// Nome da barbearia vem do banco: nao pode ser gerada no build.
export const dynamic = "force-dynamic";

async function tokenNaUrl(busca: PageProps<"/c/entrar">["searchParams"]) {
  const { convite } = await busca;
  return typeof convite === "string" && tokenDeConvite(convite) ? convite : undefined;
}

export async function generateMetadata({ searchParams }: PageProps<"/c/entrar">) {
  return previaConvite(await tokenNaUrl(searchParams));
}

export default async function EntrarCliente({ searchParams }: PageProps<"/c/entrar">) {
  const conviteApp = await tokenNaUrl(searchParams);
  const cfg = await configuracao();
  return (
    <FormularioLogin
      area="cliente"
      titulo={cfg.nomeBarbearia}
      subtitulo="Seu acesso à Black"
      conviteApp={conviteApp}
      destinoPadrao={conviteApp ? "/c/agendar" : "/c"} codigoDisponivel={modoCodigoNaTela() || process.env.OTP_PROVIDER === "whatsapp"}
      provedoresSociais={provedoresDisponiveis()}
    />
  );
}
