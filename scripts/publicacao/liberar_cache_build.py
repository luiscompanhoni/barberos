"""Recupera espaço de cache descartável antigo sem remover imagens ou dados da instalação."""
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def executar(args):
    r = subprocess.run(args, capture_output=True, text=True, timeout=180, check=False)
    if r.returncode:
        raise RuntimeError("Conferência ou limpeza de cache não concluiu.")
    return r.stdout


def preservar(base):
    backups = base / "backups"
    if base.is_symlink() or backups.is_symlink() or not backups.is_dir():
        raise RuntimeError("Diretório de backup inesperado.")
    arquivos = [base / ".env", *backups.glob("*.sql.gz"), *backups.glob("*.studio.tar.gz")]
    if (base / ".env.estudio").exists():
        arquivos.append(base / ".env.estudio")
    if any(p.is_symlink() or not p.is_file() for p in arquivos):
        raise RuntimeError("Arquivo preservado inesperado.")
    return {
        "imagens": set(executar(["docker", "image", "ls", "--no-trunc", "--format", "{{.ID}} {{.Repository}}:{{.Tag}}"]).splitlines()),
        "containers": set(executar(["docker", "ps", "-a", "--no-trunc", "--format", "{{.ID}} {{.Image}}"]).splitlines()),
        "volumes": set(executar(["docker", "volume", "ls", "-q"]).splitlines()),
        "arquivos": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in arquivos},
    }


def liberar(base, projeto, imagem):
    ids = executar(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + projeto,
                    "--filter", "label=com.docker.compose.service=app"]).split()
    if len(ids) != 1:
        raise RuntimeError("Aplicação atual não confirmada.")
    app = json.loads(executar(["docker", "inspect", ids[0]]))[0]
    if app["Image"] != imagem or app["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("Versão ou saúde mudou; cache preservado.")
    antes = preservar(base)
    livre = shutil.disk_usage(base).free
    # Sem --all: apenas cache dangling; não usa image/system/volume prune.
    executar(["docker", "builder", "prune", "--force", "--filter", "until=48h", "--keep-storage", "8GB"])
    depois = preservar(base)
    for campo in ("imagens", "containers", "volumes"):
        if not antes[campo].issubset(depois[campo]):
            raise RuntimeError("Preservação não confirmada após limpar cache; publicação bloqueada.")
    if any(depois["arquivos"].get(p) != soma for p, soma in antes["arquivos"].items()):
        raise RuntimeError("Arquivo preservado mudou; publicação bloqueada.")
    return {"livreAntes": livre, "livreDepois": shutil.disk_usage(base).free,
            "imagensPreservadas": True, "containersPreservados": True,
            "volumesPreservados": True, "backupsConfiguracaoPreservados": True,
            "filtro": "until=48h", "reservaCache": "8GB"}


if __name__ == "__main__":
    import argparse
    import fcntl
    import os
    import re
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("projeto")
    parser.add_argument("imagem")
    args = parser.parse_args()
    base = Path(args.base)
    if os.geteuid() != 0 or not re.fullmatch(r"/[A-Za-z0-9_/-]+", args.base) or ".." in base.parts or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", args.projeto) or not re.fullmatch(r"sha256:[a-f0-9]{64}", args.imagem):
        raise SystemExit("Parâmetros inválidos.")
    trava = base / ".publicacao.lock"
    if trava.is_symlink():
        raise SystemExit("Trava inesperada.")
    with open(trava, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(liberar(base, args.projeto, args.imagem)))

