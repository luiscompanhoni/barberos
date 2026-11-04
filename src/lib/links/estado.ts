import type { LinkPagamento } from "@prisma/client";
import { linkAbsoluto } from "@/lib/assinaturas/cobrancas";
import { pixVencido, situacaoLink, type EstadoCheckout } from "@/lib/pagamentos/checkout-regras";

export function estadoCheckoutLink(l: LinkPagamento): EstadoCheckout {
  const sit = situacaoLink(l);
  const tentativa = !!(l.tentativaChave || l.gatewayId);
  const incerto = l.status === "PENDENTE" && tentativa && (!l.gatewayId || sit === "EXPIRADO" || (l.forma === "PIX" && (!l.pixCopiaECola || pixVencido(l.pixExpiraEm))) || l.tentativaChave?.startsWith("cancelar:") || l.tentativaChave?.startsWith("expirar:") || l.tentativaChave?.startsWith("conferir:"));
  const status = incerto ? "PENDENTE" : sit === "ESTORNADO" ? "CANCELADO" : sit;
  const aberto = status === "PENDENTE";
  const pix = aberto && !incerto && l.forma === "PIX" && l.pixCopiaECola && !pixVencido(l.pixExpiraEm)
    ? { copiaECola: l.pixCopiaECola, qrUrl: l.pixQrUrl, expiraEm: l.pixExpiraEm?.toISOString() ?? null }
    : null;
  const teste = aberto && !incerto && l.forma === "PIX" && l.gatewayId?.startsWith("sim") ? linkAbsoluto(`/c/pagamento-simulado/${l.gatewayId}`) : null;
  return {
    status, forma: l.forma === "BOLETO" ? null : l.forma, pix, link: teste,
    processando: !!incerto || (aberto && l.forma === "CARTAO" && !!l.gatewayId),
    mensagem: incerto ? "Pagamento em conferência. Não faça outra cobrança; aguarde a confirmação da barbearia." : null,
  };
}
