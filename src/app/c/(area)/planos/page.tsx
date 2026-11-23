import { PlanosCliente } from "@/components/cliente/PlanosCliente";
import { consultarOfertaPublicaDezembro } from "@/lib/oferta-dezembro/consulta";

export default async function Planos({ searchParams }: PageProps<"/c/planos">) {
  const { plano, leonel } = await searchParams;
  const planoId = typeof plano === "string" && plano.length > 0 && plano.length <= 40 ? plano : null;
  const conviteLeonel = planoId && typeof leonel === "string" && leonel.length <= 70 ? leonel : null;
  const mostrarOfertaDezembro = !planoId && Boolean(await consultarOfertaPublicaDezembro());
  return <PlanosCliente key={planoId} planoId={planoId} conviteLeonel={conviteLeonel} mostrarOfertaDezembro={mostrarOfertaDezembro} />;
}
