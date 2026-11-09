import { FormularioLogin } from "@/components/login/FormularioLogin";
import { configuracao } from "@/lib/agenda/carregar";
import { modoCodigoNaTela } from "@/lib/auth/otp";
import { provedoresDisponiveis } from "@/lib/auth/social-provedores";

export const dynamic = "force-dynamic";
export const metadata = { manifest: "/manifest-equipe.webmanifest" };

export default async function EntrarEquipe() {
  const cfg = await configuracao();
  return <FormularioLogin area="cliente" titulo={cfg.nomeBarbearia} subtitulo="Seu acesso à Black" destinoPadrao="/c" codigoDisponivel={modoCodigoNaTela() || process.env.OTP_PROVIDER === "whatsapp"} provedoresSociais={provedoresDisponiveis()} />;
}
