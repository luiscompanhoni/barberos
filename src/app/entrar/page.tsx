import { FormularioLogin } from "@/components/login/FormularioLogin";
import { configuracao } from "@/lib/agenda/carregar";
import { modoCodigoNaTela } from "@/lib/auth/otp";

export const dynamic = "force-dynamic";
export const metadata = { manifest: "/manifest-equipe.webmanifest" };

export default async function EntrarEquipe() {
  const cfg = await configuracao();
  return <FormularioLogin area="equipe" titulo={cfg.nomeBarbearia} subtitulo="Acesso da equipe" destinoPadrao="/" codigoDisponivel={modoCodigoNaTela() || process.env.OTP_PROVIDER === "whatsapp"} />;
}
