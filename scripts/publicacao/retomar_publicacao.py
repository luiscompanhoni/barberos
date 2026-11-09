"""Retomada única da publicação 102a391 parada antes de isolar escritores."""
import json
import os
import sys
from pathlib import Path

REVISAO = "102a3911fd6b38c635af9cf9cb7718e04f0796db"
IMAGEM = "sha256:a2a78e0a4ab504fa65cb72c9c21130e05a261c2b4134bc3b41532fc407a187d6"
PENDENTES = ["20261108193000_plano_venda_equipe", "20261108210000_crescimento_migracao"]


def validar_registro(r):
    campos = {"revisao", "etapa", "concluido", "rollback", "agendaEquipeAntes", "imagemAnterior",
              "backupAnterior", "composeAnterior", "migracoesPendentes", "backupAnteriorPreservado"}
    if (set(r) != campos or r["revisao"] != REVISAO or r["etapa"] != "preservar"
            or r["concluido"] is not False or r["rollback"] is not None
            or r["agendaEquipeAntes"] is not True or r["imagemAnterior"] != IMAGEM
            or r["migracoesPendentes"] != PENDENTES or r["backupAnteriorPreservado"] is not True):
        raise RuntimeError("Registro não corresponde à parada anterior ao isolamento.")


def retomar(base, projeto):
    pasta = base / "releases" / REVISAO
    sys.path.insert(0, str(pasta / "barberos/scripts/publicacao"))
    from deploy_vps import publicar
    from deploy_vps_comum import aguardar_saude, container, conferir_migracoes
    from protecao_operacao import conferir_capacidade, exigir_banco_isolavel, exigir_sem_recuperacao
    from deploy_vps_comum import migracoes
    exigir_sem_recuperacao(base)
    registro, anterior = pasta / "operacao.json", pasta / "operacao-interrompida-preservar.json"
    if registro.is_symlink() or anterior.exists() or anterior.is_symlink():
        raise RuntimeError("Registro já tratado ou inesperado; conferir manualmente.")
    r = json.loads(registro.read_text())
    validar_registro(r)
    app, banco, backup = aguardar_saude(projeto, prazo=30), container(projeto, "db"), container(projeto, "backup")
    if (app["Image"] != IMAGEM or backup["Image"] != r["backupAnterior"]
            or app["Config"]["Labels"]["com.docker.compose.project.config_files"].split(",") != r["composeAnterior"]):
        raise RuntimeError("Instalação mudou desde a tentativa interrompida.")
    if conferir_migracoes(migracoes(banco["Id"]), pasta / "barberos/prisma/migrations") != PENDENTES:
        raise RuntimeError("Migrações mudaram desde a tentativa interrompida.")
    conferir_capacidade(base, banco, app, projeto + "_estudio_media")
    exigir_banco_isolavel(projeto, banco)
    # Mantém integralmente a evidência da parada; só agora permite o publicador original.
    os.rename(registro, anterior)
    return publicar(base, projeto, REVISAO, IMAGEM)


if __name__ == "__main__":
    import fcntl
    os.umask(0o077)
    base, projeto = Path(sys.argv[1]), sys.argv[2]
    if os.geteuid() != 0 or str(base) != "/opt/barberos" or projeto != "barberos":
        raise SystemExit("Instalação inesperada.")
    resultado = {"concluido": False, "revisao": REVISAO}
    try:
        trava = base / ".publicacao.lock"
        if trava.is_symlink():
            raise RuntimeError("Trava inesperada.")
        with open(trava, "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            resultado = retomar(base, projeto)
    except BaseException:
        resultado["erro"] = "Retomada não concluída; consultar o registro privado."
    registro = base / "releases" / REVISAO / "operacao.json"
    print(json.dumps({"resultado": resultado, "registro": json.loads(registro.read_text()) if registro.is_file() else {}}))
    raise SystemExit(0 if resultado.get("concluido") else 1)
