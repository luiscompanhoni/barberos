import { CampanhasEquipe } from "@/components/campanhas/CampanhasEquipe";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
export default async function Page() { const s = await exigirSessao(); return <CampanhasEquipe gestao={GESTAO.includes(s.papel)} barbeiro={!!s.barbeiroId} />; }
