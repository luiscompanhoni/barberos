"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, LogOut, QrCode, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Estado = "conectado" | "conectando" | "desconectado" | "sem_instancia" | "fora_do_ar";
type Info = { modo: "cloud" | "evolution" | "simulador"; estado: Estado | null; numeroOficial: string | null; temChaveBot: boolean };

const MODOS = {
  evolution: { nome: "WhatsApp não oficial (QR code)", desc: "Conecta o número da barbearia lendo um QR code, como o WhatsApp Web. Sem custo por mensagem." },
  cloud: { nome: "WhatsApp oficial (API da Meta)", desc: "Conta verificada pela Meta, sem risco de bloqueio. Avisos fora das 24h usam modelos aprovados." },
  simulador: { nome: "Simulador", desc: "Nada sai do servidor: as mensagens aparecem só na tela Simulador, para testar." },
};

const TEXTO_ESTADO: Record<Estado, string> = {
  conectado: "Conectado",
  conectando: "Aguardando a leitura do QR code",
  desconectado: "Desconectado",
  sem_instancia: "Ainda não conectado",
  fora_do_ar: "Serviço do WhatsApp fora do ar",
};

/** Mostra o modo do WhatsApp e, no nao oficial, conecta/desconecta pelo QR code. */
export function ConexaoWhatsApp() {
  const [info, setInfo] = useState<Info | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const i = await api<Info>("/api/whatsapp/conexao").catch(() => null);
    if (i) setInfo(i);
    if (i?.estado === "conectado") setQr(null);
    return i;
  }, []);
  useEffect(() => {
    api<Info>("/api/whatsapp/conexao").then(setInfo).catch(() => {});
  }, []);

  // Enquanto o QR esta na tela, confere a cada 3s se o celular ja leu (e renova o QR a cada 30s).
  useEffect(() => {
    if (!qr) return;
    let n = 0;
    const t = setInterval(async () => {
      n++;
      const i = await carregar();
      if (i?.estado !== "conectado" && n % 10 === 0) acao("conectar");
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr, carregar]);

  async function acao(a: "conectar" | "desconectar") {
    setErro(null);
    setOcupado(true);
    try {
      const r = await api<{ estado: Estado; qr: string | null }>("/api/whatsapp/conexao", { method: "POST", body: { acao: a } });
      setQr(r.qr);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!info) return <div className="cartao text-sm text-zinc-500">Carregando…</div>;
  const modo = MODOS[info.modo];
  const conectado = info.modo === "cloud" || info.estado === "conectado";

  return (
    <>
      <section className="cartao space-y-3">
        <div className="flex items-start gap-3">
          {info.modo === "cloud" ? <ShieldCheck className="mt-0.5 shrink-0 text-ouro" size={20} /> : <Smartphone className="mt-0.5 shrink-0 text-ouro" size={20} />}
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{modo.nome}</h2>
            <p className="text-sm text-zinc-500">{modo.desc}</p>
          </div>
        </div>

        {info.modo === "evolution" && info.estado && (
          <p className={`flex items-center gap-2 text-sm font-semibold ${conectado ? "text-emerald-600" : "text-zinc-600"}`}>
            {conectado ? <CheckCircle2 size={16} /> : <span className="h-2 w-2 rounded-full bg-zinc-400" />}
            {TEXTO_ESTADO[info.estado]}
          </p>
        )}
        {info.modo === "cloud" && (
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
            <CheckCircle2 size={16} /> Ligado{info.numeroOficial ? ` · ${info.numeroOficial}` : ""}
          </p>
        )}

        {info.modo === "evolution" && (
          <div className="flex flex-wrap gap-2">
            {!conectado && (
              <button className="btn-primario" disabled={ocupado} onClick={() => acao("conectar")}>
                {ocupado ? <Loader2 className="animate-spin" size={16} /> : <QrCode size={16} />} {qr ? "Gerar outro QR code" : "Conectar pelo QR code"}
              </button>
            )}
            {conectado && (
              <button className="btn-perigo" disabled={ocupado} onClick={() => confirm("Desconectar o WhatsApp? O bot para de responder até conectar de novo.") && acao("desconectar")}>
                <LogOut size={16} /> Desconectar
              </button>
            )}
          </div>
        )}
        {erro && <p className="text-sm text-red-600">{erro}</p>}
      </section>

      {qr && !conectado && (
        <section className="cartao-destaque space-y-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code para conectar o WhatsApp" className="mx-auto w-64 max-w-full rounded-lg bg-white p-2" />
          <ol className="mx-auto max-w-sm space-y-1 text-left text-sm text-zinc-600">
            <li>1. No celular da barbearia, abra o WhatsApp (ou WhatsApp Business).</li>
            <li>2. Toque em <b>Configurações → Aparelhos conectados → Conectar aparelho</b>.</li>
            <li>3. Aponte a câmera para este QR code.</li>
          </ol>
        </section>
      )}

      {info.modo === "evolution" && (
        <p className="flex gap-2 text-xs text-zinc-500">
          <TriangleAlert className="shrink-0" size={14} />
          O modo não oficial não tem garantia da Meta: evite mensagens em massa para números que não falaram com a barbearia, senão o número pode ser bloqueado.
        </p>
      )}
      {!info.temChaveBot && info.modo !== "simulador" && (
        <p className="flex gap-2 text-xs text-amber-700">
          <TriangleAlert className="shrink-0" size={14} />
          Falta a chave da Anthropic (ANTHROPIC_API_KEY): as mensagens chegam em Conversas, mas o bot não responde sozinho.
        </p>
      )}
    </>
  );
}
