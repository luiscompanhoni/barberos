import {
  BadgeCheck, Bot, Camera, ChartColumnIncreasing, CircleDot, ClipboardList,
  Compass, Crosshair, Image, Link2, Megaphone, MessageCircleMore, MousePointer2, Send,
} from "lucide-react";
import type { Canal, TipoEtapa, TipoEvento } from "@/lib/campanhas/rotas-demo";

export const ICONE_CANAL = {
  instagramAds: Camera, chatgpt: Bot, instagramOrganico: Camera, outra: Compass,
} satisfies Record<Canal, typeof Camera>;

export const ICONE_ETAPA = {
  criativo: Image,
  trafego: Megaphone,
  origem: MousePointer2,
  whatsapp: MessageCircleMore,
  direct: Send,
  link: Link2,
  venda: BadgeCheck,
  relatorio: ChartColumnIncreasing,
  tarefa: ClipboardList,
} satisfies Record<TipoEtapa, typeof Camera>;

export const ICONE_EVENTO = {
  entrada: Crosshair, whatsapp: MessageCircleMore, direct: Send, link: Link2, venda: BadgeCheck,
} satisfies Record<TipoEvento, typeof CircleDot>;
