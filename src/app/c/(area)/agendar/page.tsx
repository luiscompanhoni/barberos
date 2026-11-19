import { VisitaConvite } from "@/components/convites/VisitaConvite";
import { Suspense } from "react";
import { AgendarTela } from "@/components/cliente/AgendarTela";

export default function Agendar() {
  return (
    <Suspense>
      <VisitaConvite etapa="agenda" />
      <AgendarTela lembreteDisponivel={process.env.LEMBRETE_ABANDONO_PREVIA === "true"} />
    </Suspense>
  );
}
