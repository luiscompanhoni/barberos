import { z } from "zod";
import catalogo from "../../../workers/video/templates.json";

export const TEMPLATES = catalogo;
export const zPreset = z.enum(["black-vertical-v1", "black-recrutamento-v2", "black-servicos-v2", "black-equipe-v2"]);
export type Preset = z.infer<typeof zPreset>;
export const PRESET_PADRAO: Preset = "black-servicos-v2";
export const WORKER_1080 = "black-vertical-v2/hyperframes-0.8.198";
export const zTitulos = { titulo: z.string().trim().max(70), chamada: z.string().trim().max(70) };
export function formato(preset: unknown) { return TEMPLATES[zPreset.parse(preset)]; }
