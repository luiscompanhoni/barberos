import { CentralNotificacoes } from "@/components/notificacoes/CentralNotificacoes";
import { exigirSessao } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";
export default async function NotificacoesEquipe() {
  await exigirSessao();
  return <CentralNotificacoes area="equipe" />;
}
