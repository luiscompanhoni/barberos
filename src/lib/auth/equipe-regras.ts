import type { Papel } from "@prisma/client";
import { ErroNegocio } from "@/lib/erros";

/** Não permite ao dono perder a própria sessão administrativa durante uma edição. */
export function validarMudancaDeAcesso(p: {
  proprio: boolean; papelAtual: Papel; ativoAtual: boolean; papel: Papel; ativo: boolean; donosAtivos: number;
}) {
  if (p.papelAtual === "CLIENTE" || p.papel === "CLIENTE") throw new ErroNegocio("Use o cadastro de clientes para este usuário.", 409);
  if (p.papelAtual === "DONO" && p.ativoAtual && (!p.ativo || p.papel !== "DONO") && p.donosAtivos <= 1) {
    throw new ErroNegocio("Mantenha pelo menos um dono ativo no sistema.", 409, "ultimo_dono");
  }
  if (p.proprio && (!p.ativo || p.papel !== "DONO")) {
    throw new ErroNegocio("Outro dono deve alterar sua função ou desativar seu acesso.", 409, "proprio_acesso");
  }
}
