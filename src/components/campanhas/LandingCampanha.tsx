"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Gift, Sparkles } from "lucide-react";
import { Marca } from "@/components/Marca";
import { RodaRoleta, rotacaoAlvo } from "@/components/roleta/RodaRoleta";
import { reais } from "@/lib/cliente-api";
import type { Landing } from "@/lib/campanhas/link";

type Premio = { premioId: string | null; rotulo: string; tipo: "CREDITO" | "BRINDE" | "NADA"; valorCentavos: number };

const enviar = (token: string, acao: "visita" | "girar") =>
  fetch(`/api/r/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao }) });

/**
 * Pagina do link da campanha (sem login). Avisa a visita pelo JavaScript (robo de previa de link nao conta).
 * Campanha da roleta: 1 giro de presente e o convite para agendar e usar. Campanha comum: vai direto para agendar.
 */
export function LandingCampanha({ token, dados }: { token: string; dados: Landing }) {
  const r = dados.roleta;
  useEffect(() => {
    const visita = enviar(token, "visita").catch(() => null);
    if (!r) visita.finally(() => window.location.replace("/c/agendar"));
  }, [token, r]);

  return (
    <main className="flex flex-1 items-start justify-center px-4 py-8">
      <section className="entrar-suave w-full max-w-md space-y-5">
        <div className="flex justify-center"><Marca nome={dados.barbearia} /></div>
        {!r ? (
          <div className="text-center">
            <p className="text-lg font-bold">{dados.nome ? `Oi, ${dados.nome}!` : "Oi!"}</p>
            <p className="mt-2 text-sm text-zinc-600">Abrindo a agenda da {dados.barbearia}…</p>
            <Link className="btn-primario mt-6 w-full py-3.5" href="/c/agendar"><CalendarPlus size={17} /> Agendar agora</Link>
          </div>
        ) : (
          <Roleta token={token} dados={dados} roleta={r} />
        )}
      </section>
    </main>
  );
}

function Roleta({ token, dados, roleta }: { token: string; dados: Landing; roleta: NonNullable<Landing["roleta"]> }) {
  const [rotacao, setRotacao] = useState(0);
  const [girando, setGirando] = useState(false);
  const [destaque, setDestaque] = useState<number | null>(null);
  const [premio, setPremio] = useState<Premio | null>(roleta.giro);
  const [mostrar, setMostrar] = useState(!!roleta.giro);
  const [erro, setErro] = useState("");
  const indice = useRef<number | null>(null);

  async function girar() {
    if (girando || premio) return;
    setErro("");
    try {
      const resp = await enviar(token, "girar");
      const corpo = await resp.json();
      if (!resp.ok) throw new Error(corpo.erro ?? "Não deu para girar agora.");
      const i = Math.max(0, roleta.premios.findIndex((p) => p.id === corpo.premioId));
      indice.current = i;
      setPremio({ premioId: corpo.premioId, rotulo: corpo.rotulo, tipo: corpo.tipo, valorCentavos: corpo.valorCentavos });
      setGirando(true);
      setRotacao((atual) => rotacaoAlvo(atual, i, roleta.premios.length, Math.random() * 2 - 1));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  function parou() {
    if (!girando) return;
    setGirando(false);
    setDestaque(indice.current);
    setMostrar(true);
  }

  const ganhou = premio && premio.tipo !== "NADA";
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-black">{dados.nome ? `${dados.nome}, ` : ""}você ganhou 1 giro! <Sparkles className="inline text-ouro" size={20} /></h1>
        <p className="mt-1 text-sm text-zinc-600">Presente da {dados.barbearia}. Gire e veja o que sai.</p>
      </div>

      {!roleta.ativa && !premio ? (
        <p className="cartao text-center text-sm">A roleta está pausada agora. Que tal já garantir seu horário?</p>
      ) : roleta.vencido ? (
        <p className="cartao text-center text-sm">Esse giro de presente venceu. Mas a agenda está aberta para você!</p>
      ) : (
        <section className="roleta-moldura rounded-2xl px-3 pb-4 pt-3">
          <RodaRoleta fatias={roleta.premios} rotacao={rotacao} girando={girando} destaque={destaque}
            onGirar={girar} podeGirar={!premio && !girando} aoParar={parou} />
        </section>
      )}

      {mostrar && premio && (
        <div className="cartao-destaque roleta-surgir text-center">
          {ganhou ? <Gift className="mx-auto text-ouro" size={26} /> : null}
          <p className="mt-1 text-xl font-black">
            {premio.tipo === "CREDITO" ? `+ ${reais(premio.valorCentavos)} para usar no seu corte` : premio.tipo === "BRINDE" ? premio.rotulo : "Não foi dessa vez!"}
          </p>
          <p className="mt-1 text-sm text-zinc-600">
            {premio.tipo === "CREDITO" ? "O valor já está guardado no seu número. É só agendar e usar no atendimento."
              : premio.tipo === "BRINDE" ? "Seu brinde fica guardado no seu número: retire na barbearia no dia do atendimento."
                : "Mas a agenda está aberta: garanta seu horário."}
          </p>
        </div>
      )}
      {erro && <p className="rounded-xl bg-red-50 p-3 text-center text-sm text-red-700">{erro}</p>}

      {(mostrar || !roleta.ativa || roleta.vencido) && (
        <Link className="btn-primario w-full py-3.5" href="/c/agendar">
          <CalendarPlus size={17} /> {ganhou ? "Agendar e usar meu prêmio" : "Agendar meu horário"}
        </Link>
      )}
      {mostrar && <p className="text-center text-xs text-zinc-500">Para agendar, entre com o seu número de WhatsApp: o prêmio já está nele.</p>}
    </div>
  );
}
