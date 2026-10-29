/**
 * LGPD: versao dos Termos de uso e da Politica de privacidade e quem e o controlador dos dados.
 * Ao mudar o texto das paginas /termos ou /privacidade de forma relevante, suba a VERSAO: o cliente aceita de novo.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { formatarTelefone } from "@/lib/telefone";

export const VERSAO_TERMOS = "2026-10-27";

/** Dados de quem responde pelos dados (vem da configuracao e do .env do servidor; CNPJ quando informado). */
export async function controlador() {
  const cfg = await configuracao();
  const env = (k: string) => process.env[k]?.trim() || null;
  const cidade = [env("COBRANCA_CIDADE"), env("COBRANCA_UF")].filter(Boolean).join(" - ");
  const whatsapp = env("WHATSAPP_NUMERO_PUBLICO");
  return {
    nome: env("EMPRESA_RAZAO_SOCIAL") ?? cfg.nomeBarbearia,
    nomeFantasia: cfg.nomeBarbearia,
    cnpj: env("EMPRESA_CNPJ"),
    endereco: [env("COBRANCA_ENDERECO"), cidade].filter(Boolean).join(", ") || null,
    whatsapp: whatsapp ? formatarTelefone(whatsapp) : null,
    whatsappLink: whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, "")}` : null,
    email: env("EMPRESA_EMAIL_PRIVACIDADE") ?? env("EMAIL_BALCAO"),
  };
}

export type Controlador = Awaited<ReturnType<typeof controlador>>;
