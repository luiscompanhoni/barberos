/**
 * Homologacao (AMBIENTE=homologacao, ver deploy/docker-compose.homolog.yml): copia de testes do sistema.
 * Trava de seguranca: nela nada sai de verdade (WhatsApp, pagamentos e maquininha ficam simulados), seja qual for o .env.
 */
export const ehHomologacao = () => process.env.AMBIENTE === "homologacao";
