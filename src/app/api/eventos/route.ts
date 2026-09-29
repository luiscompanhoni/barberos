import { exigirSessao } from "@/lib/auth/sessao";
import { assinar } from "@/lib/eventos";
import { rota } from "@/lib/erros";

export const dynamic = "force-dynamic";

/** Server-Sent Events: as telas de agenda recarregam quando algo muda. */
export const GET = rota(async (req: Request) => {
  await exigirSessao();
  const enc = new TextEncoder();
  let cancelar = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const enviar = (texto: string) => {
        try {
          controller.enqueue(enc.encode(texto));
        } catch {
          cancelar();
        }
      };
      enviar("retry: 3000\n\n");
      const desinscrever = assinar((ev) => enviar(`data: ${JSON.stringify(ev)}\n\n`));
      const pulso = setInterval(() => enviar(": ping\n\n"), 25_000);
      cancelar = () => {
        clearInterval(pulso);
        desinscrever();
      };
      req.signal.addEventListener("abort", () => {
        cancelar();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cancelar();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
