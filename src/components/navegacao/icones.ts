import {
  Bell, Bot, BriefcaseBusiness, CalendarDays, CalendarRange, ChartLine, Clapperboard, ClipboardCheck, Clock3,
  CreditCard, Dices, Gift, HandCoins, HeartHandshake, Landmark, LayoutDashboard, ListChecks, Megaphone,
  MessageCircle, Package, Presentation, ReceiptText, RotateCcw, Settings2, ShieldCheck, Smartphone,
  Star, UserRound, UserRoundPlus, UsersRound, type LucideIcon,
} from "lucide-react";
const ICONES: Record<string, LucideIcon> = {
  "/painel": LayoutDashboard, "/agentes": Bot, "/recepcao": CalendarDays, "/meu-dia": ClipboardCheck,
  "/minha-agenda": CalendarDays, "/semana": CalendarRange, "/comandas": ReceiptText,
  "/caixa": HandCoins, "/conversas": MessageCircle, "/financeiro": Landmark,
  "/estudio": Clapperboard, "/estoque": Package, "/assinaturas": CreditCard,
  "/planos": ListChecks, "/campanhas": Megaphone, "/recompras": RotateCcw, "/jogos": Dices,
  "/reunioes": Presentation, "/desempenho": ChartLine, "/avaliacoes": Star,
  "/checklist": ClipboardCheck, "/rh": BriefcaseBusiness, "/recrutamento": UserRoundPlus,
  "/expediente": Clock3, "/campanhas-equipe": Gift, "/cultura-black": HeartHandshake,
  "/equipe": Settings2, "/whatsapp": Smartphone, "/notificacoes": Bell,
  "/auditoria": ShieldCheck, "/simulador": Smartphone,
};
const GRUPOS: Record<string, LucideIcon> = { Agenda: CalendarDays, Equipe: UsersRound, Relacionamento: CreditCard, Configurações: Settings2 };
export const iconeDaRota = (href: string) => ICONES[href.split("?")[0]] ?? (href.startsWith("/indicadores") ? ChartLine : UserRound);
export const iconeDoGrupo = (titulo: string) => GRUPOS[titulo] ?? ListChecks;
