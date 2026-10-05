import { FormularioLogin } from "@/components/login/FormularioLogin";
import { configuracao } from "@/lib/agenda/carregar";

export const dynamic = "force-dynamic";

export default async function EntrarEquipe() {
  const cfg = await configuracao();
  return <FormularioLogin area="equipe" titulo={cfg.nomeBarbearia} subtitulo="Acesso da equipe" destinoPadrao="/" />;
}
