import { configurarMeta } from "./meta";
import { execucaoHabilitada } from "./acesso";
import type { IntegracaoAgente } from "./tipos";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";

export function integracoesAgentes(): IntegracaoAgente[] {
  const meta = configurarMeta();
  return [
    { id: "modelo", nome: "Modelo de IA existente", disponivel: execucaoHabilitada(), detalhe: execucaoHabilitada() ? "Execução interna habilitada; usa o modelo do bot." : "Requer habilitação explícita da execução e configuração do modelo no servidor." },
    { id: "meta_ads", nome: "Meta Ads — leitura", disponivel: meta.disponivel, detalhe: meta.disponivel ? "Configuração presente; conexão será verificada na consulta. Publicação e gastos não estão habilitados." : meta.pendencias.join(" ") },
    { id: "whatsapp", nome: "WhatsApp operacional", disponivel: provedorWhatsApp() !== "simulador", detalhe: "O canal existente mantém suas regras. A central prepara textos e encaminha tarefas internas; não dispara mensagens." },
    { id: "geracao_midia", nome: "Imagens e vídeos por IA", disponivel: false, detalhe: "Fornecedor ainda não definido. Conteúdo entrega roteiro e direção criativa; mídia pode ser produzida e aprovada no Black Estúdio." },
    { id: "email", nome: "Caixa de e-mail", disponivel: false, detalhe: "Caixa não integrada à central. Trabalha sobre texto fornecido, sem ler ou enviar e-mails." },
    { id: "publicacao_social", nome: "Publicação em redes sociais", disponivel: false, detalhe: "Conector de publicação pendente; entrega plano e textos para revisão." },
    { id: "pesquisa_web", nome: "Pesquisa na web", disponivel: false, detalhe: "Pesquisa automática não conectada; não inventa resultados ou fontes externas." },
    { id: "repositorio", nome: "Repositório de programação", disponivel: false, detalhe: "Agente prepara especificações e diagnósticos; não modifica nem publica código a partir do painel." },
  ];
}
