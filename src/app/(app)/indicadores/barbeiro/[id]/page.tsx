import { redirect } from "next/navigation";
import { BarbeiroTela } from "@/components/indicadores/BarbeiroTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function IndicadoresBarbeiro(props: PageProps<"/indicadores/barbeiro/[id]">) {
  const { id } = await props.params;
  const periodo = (await props.searchParams).periodo;
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO" && !(s.papel === "BARBEIRO" && s.barbeiroId === id)) redirect("/");
  return <BarbeiroTela id={id} periodoInicial={typeof periodo === "string" ? periodo : "30d"} voltar={s.papel === "DONO" ? "/indicadores" : null} />;
}
