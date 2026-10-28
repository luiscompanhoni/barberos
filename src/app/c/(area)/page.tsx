import { MeusHorarios } from "@/components/cliente/MeusHorarios";
import { ChamadaAvaliacao } from "@/components/avaliacoes/ChamadaAvaliacao";
import { RecomprasCliente } from "@/components/recompras/RecomprasCliente";

export default function InicioCliente() {
  return <div className="space-y-4"><ChamadaAvaliacao /><RecomprasCliente /><MeusHorarios /></div>;
}
