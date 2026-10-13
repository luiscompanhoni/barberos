import { FormularioLogin } from "@/components/login/FormularioLogin";
import { configuracao } from "@/lib/agenda/carregar";
import { modoCodigoNaTela } from "@/lib/auth/otp";

// Nome da barbearia vem do banco: nao pode ser gerada no build.
export const dynamic = "force-dynamic";

export default async function EntrarCliente() {
  const cfg = await configuracao();
  return (
    <FormularioLogin
      area="cliente"
      titulo={cfg.nomeBarbearia}
      subtitulo="Área do cliente"
      destinoPadrao="/c" codigoDisponivel={modoCodigoNaTela() || process.env.OTP_PROVIDER === "whatsapp"}
    />
  );
}
