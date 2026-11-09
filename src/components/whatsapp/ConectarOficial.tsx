"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/cliente-api";

export type Cadastro = { appId: string; configId: string; versao: string };
type SdkFacebook = {
  init(o: Record<string, unknown>): void;
  login(cb: (r: { authResponse?: { code?: string } | null }) => void, o: Record<string, unknown>): void;
};
type JanelaFb = Window & { FB?: SdkFacebook; fbAsyncInit?: () => void };

function carregarSdk(c: Cadastro): Promise<SdkFacebook> {
  const w = window as JanelaFb;
  if (w.FB) return Promise.resolve(w.FB);
  return new Promise((ok, falha) => {
    w.fbAsyncInit = () => {
      w.FB!.init({ appId: c.appId, autoLogAppEvents: true, xfbml: false, version: c.versao });
      ok(w.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/pt_BR/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => falha(new Error("Não consegui carregar o Facebook. Confira a internet ou desligue o bloqueador de anúncios."));
    document.body.appendChild(s);
  });
}

const daMeta = (origem: string) => {
  try {
    const h = new URL(origem).hostname;
    return h === "facebook.com" || h.endsWith(".facebook.com");
  } catch {
    return false;
  }
};

/**
 * Cadastro incorporado da Meta com coexistencia: o dono escolhe o WhatsApp Business do celular,
 * confirma no app e o BarberOS recebe o codigo (vale 30 s) e a conta para concluir no servidor.
 */
export function ConectarOficial({ cadastro, onConectado }: { cadastro: Cadastro; onConectado: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const sessao = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({});

  async function concluirSePronto() {
    const { code, wabaId, phoneNumberId } = sessao.current;
    if (!code || !wabaId) return;
    sessao.current = {};
    try {
      const r = await api<{ numero: string | null; sincronizacaoErro: string | null }>("/api/whatsapp/oficial", { method: "POST", body: { code, wabaId, phoneNumberId } });
      setAviso({
        ok: !r.sincronizacaoErro,
        texto: r.sincronizacaoErro
          ? `Conectado, mas a cópia do histórico falhou: ${r.sincronizacaoErro}`
          : "Conectado! Deixe o WhatsApp Business aberto no celular por alguns minutos enquanto as conversas são copiadas.",
      });
      onConectado();
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  useEffect(() => {
    function ouvir(ev: MessageEvent) {
      if (!daMeta(ev.origin) || typeof ev.data !== "string") return;
      let d: { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string; error_message?: string } };
      try {
        d = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (d.type !== "WA_EMBEDDED_SIGNUP") return;
      if (d.event?.startsWith("FINISH")) {
        sessao.current.wabaId = d.data?.waba_id;
        sessao.current.phoneNumberId = d.data?.phone_number_id;
        concluirSePronto();
      } else if (d.event === "CANCEL" || d.event === "ERROR") {
        setOcupado(false);
        setAviso({ ok: false, texto: d.data?.error_message ?? "Conexão interrompida antes do fim." });
      }
    }
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function conectar() {
    setAviso(null);
    setOcupado(true);
    sessao.current = {};
    try {
      const fb = await carregarSdk(cadastro);
      fb.login(
        (r) => {
          const code = r.authResponse?.code;
          if (!code) {
            setOcupado(false);
            setAviso({ ok: false, texto: "A Meta não devolveu a autorização. Vá até o fim e toque em Concluir." });
            return;
          }
          sessao.current.code = code;
          concluirSePronto();
        },
        {
          config_id: cadastro.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
        },
      );
    } catch (e) {
      setOcupado(false);
      setAviso({ ok: false, texto: (e as Error).message });
    }
  }

  return (
    <section className="cartao space-y-3">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 shrink-0 text-ouro" size={20} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Conectar a API oficial mantendo o celular</h2>
          <p className="text-sm text-zinc-500">
            O número continua no WhatsApp Business do celular e passa a funcionar também pela API da Meta, sem risco de bloqueio.
            Os aparelhos conectados (inclusive o modo não oficial) são desligados na hora; dá para conectar o WhatsApp Web de novo depois.
          </p>
        </div>
      </div>
      <ol className="space-y-1 text-sm text-zinc-600">
        <li>1. Tenha o celular da barbearia em mãos, com o WhatsApp Business aberto.</li>
        <li>2. Entre com o Facebook e escolha <b>conectar o WhatsApp Business existente</b>.</li>
        <li>3. Confirme a mensagem que chega no app, cole o código e toque em <b>Concluir</b>.</li>
      </ol>
      <button className="btn-primario" disabled={ocupado} onClick={conectar}>
        {ocupado ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />} Conectar com o Facebook
      </button>
      {aviso && <p className={`text-sm ${aviso.ok ? "text-emerald-600" : "text-red-600"}`}>{aviso.texto}</p>}
    </section>
  );
}
