import { CentralNotificacoes } from "@/components/notificacoes/CentralNotificacoes";
import { exigirCliente } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";
export default async function NotificacoesCliente() {
  await exigirCliente();
  return <CentralNotificacoes area="cliente" />;
}
