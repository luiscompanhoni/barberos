import { FormularioLogin } from "@/components/login/FormularioLogin";
import { configuracao } from "@/lib/agenda/carregar";

// Nome da barbearia vem do banco: nao pode ser gerada no build.
export const dynamic = "force-dynamic";

export default async function EntrarCliente() {
  const cfg = await configuracao();
  return (
    <FormularioLogin
      area="cliente"
      titulo={cfg.nomeBarbearia}
      subtitulo="Entre com seu celular para agendar e ver seus horários"
      destinoPadrao="/c"
    />
  );
}
