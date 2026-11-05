"""Conserva workers históricos em arquivo restaurável antes de descarregar imagens sem uso."""
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

TAGS = ["barberos-video-worker:f7968a11b1892b07eaad46b659ad7c5d18bb9bd4"]
# O inventário tem só o ID curto. O preflight precisa obter e preservar os 64 dígitos.
PREFIXO_ID = "sha256:32855fc2a5d7"

def cmd(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, timeout=180).decode()

def soma(p):
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""): h.update(b)
    return h.hexdigest()

def imagens():
    return set(cmd(["docker", "image", "ls", "--no-trunc", "--format", "{{.ID}} {{.Repository}}:{{.Tag}}"]).splitlines())

def retrato(base):
    arquivos = [base / ".env", *base.joinpath("backups").glob("*.sql.gz"), *base.joinpath("backups").glob("*.studio.tar.gz")]
    if base.joinpath(".env.estudio").exists(): arquivos.append(base / ".env.estudio")
    if any(p.is_symlink() or not p.is_file() for p in arquivos): raise RuntimeError("Arquivo preservado inesperado.")
    return {"imagens": sorted(imagens()),
            "containers": sorted(cmd(["docker", "ps", "-a", "--no-trunc", "--format", "{{.ID}} {{.Image}}"]).splitlines()),
            "volumes": sorted(cmd(["docker", "volume", "ls", "-q"]).splitlines()),
            "arquivos": {str(p): soma(p) for p in arquivos}}

def conferir_preservacao(antes, depois, tags=()):
    manter = [s for s in antes["imagens"] if not any(s.endswith(" " + t) for t in tags)]
    if not set(manter).issubset(depois["imagens"]): raise RuntimeError("Imagem preservada ausente.")
    for campo in ("containers", "volumes"):
        if set(antes[campo]) != set(depois[campo]): raise RuntimeError("Container ou volume mudou.")
    if any(depois["arquivos"].get(p) != h for p, h in antes["arquivos"].items()): raise RuntimeError("Backup ou configuração mudou.")

def conferir_app(projeto, esperada):
    ids = cmd(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + projeto, "--filter", "label=com.docker.compose.service=app"]).split()
    if len(ids) != 1: raise RuntimeError("Aplicação não confirmada.")
    app = json.loads(cmd(["docker", "inspect", ids[0]]))[0]
    if app["Image"] != esperada or app["State"].get("Health", {}).get("Status") != "healthy": raise RuntimeError("Aplicação mudou ou não está saudável.")

def candidatos():
    ids = cmd(["docker", "ps", "-aq"]).split()
    usados = {c["Image"] for c in json.loads(cmd(["docker", "inspect", *ids]))} if ids else set()
    lista = json.loads(cmd(["docker", "image", "inspect", *TAGS]))
    resultado = []
    for tag, img in zip(TAGS, lista, strict=True):
        if img["Id"] in usados or img.get("RepoTags") != [tag]: raise RuntimeError("Worker histórico em uso ou tag inesperada.")
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", img["Id"]) or not img["Id"].startswith(PREFIXO_ID):
            raise RuntimeError("ID do worker diverge do inventário autorizado.")
        resultado.append({"tag": tag, "id": img["Id"]})
    return resultado

def preparar(base, projeto, esperada):
    conferir_app(projeto, esperada)
    lista = candidatos()
    antes = retrato(base)
    if shutil.disk_usage(base).free < 3 * 1024**3: raise RuntimeError("Sem espaço para arquivar com segurança.")
    pasta = base / "worker-archives"
    if pasta.is_symlink(): raise RuntimeError("Diretório inesperado.")
    pasta.mkdir(mode=0o700, exist_ok=True)
    nome = f"workers-{time.time_ns()}.tar.gz"
    arquivo = pasta / nome
    proc = subprocess.Popen(["docker", "save", *TAGS], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    criado = False
    try:
        with arquivo.open("xb") as f:
            criado = True
            os.chmod(arquivo, 0o600)
            with gzip.GzipFile(fileobj=f, mode="wb", compresslevel=1) as gz:
                while b := proc.stdout.read(1024 * 1024):
                    if f.tell() > 2 * 1024**3 or shutil.disk_usage(base).free < 1024**3: raise RuntimeError("Limite de arquivo ou espaço atingido.")
                    gz.write(b)
        if proc.wait(timeout=30): raise RuntimeError("Arquivo não concluído.")
    except BaseException:
        proc.terminate()
        proc.wait(timeout=30)
        # Só remove o arquivo parcial recém-criado por esta operação.
        if criado: arquivo.unlink(missing_ok=True)
        raise
    conferir_preservacao(antes, retrato(base))
    r = {"arquivo": nome, "sha256": soma(arquivo), "bytes": arquivo.stat().st_size, "imagens": lista,
         "livreAntes": shutil.disk_usage(base).free + arquivo.stat().st_size, "antes": antes}
    with (pasta / (nome + ".json")).open("x") as f: json.dump(r, f)
    os.chmod(pasta / (nome + ".json"), 0o600)
    return {k: v for k, v in r.items() if k != "antes"}

def concluir(base, projeto, esperada, nome, checksum):
    if not re.fullmatch(r"workers-\d+\.tar\.gz", nome) or not re.fullmatch(r"[a-f0-9]{64}", checksum): raise RuntimeError("Arquivo inválido.")
    pasta = base / "worker-archives"
    arquivo = pasta / nome
    registro = pasta / (nome + ".json")
    if pasta.is_symlink() or arquivo.is_symlink() or registro.is_symlink(): raise RuntimeError("Arquivo inesperado.")
    r = json.loads(registro.read_text())
    if r["arquivo"] != nome or r["sha256"] != checksum or soma(arquivo) != checksum: raise RuntimeError("Arquivo mudou; imagens preservadas.")
    conferir_app(projeto, esperada)
    if candidatos() != r["imagens"]: raise RuntimeError("Imagens mudaram; cópias preservadas.")
    conferir_preservacao(r["antes"], retrato(base))
    # Chamado somente depois de docker load + conferência de IDs no executor isolado.
    cmd(["docker", "image", "rm", *TAGS])
    conferir_app(projeto, esperada)
    conferir_preservacao(r["antes"], retrato(base), TAGS)
    return {"concluido": True, "arquivo": str(arquivo), "sha256": checksum, "bytes": r["bytes"],
            "imagensArquivadas": r["imagens"], "livreAntes": r["livreAntes"], "livreDepois": shutil.disk_usage(base).free,
            "containersVolumesBackupsConfiguracaoPreservados": True}

if __name__ == "__main__":
    import fcntl
    modo, diretorio, projeto, imagem, *extras = sys.argv[1:]
    base = Path(diretorio)
    if os.geteuid() != 0 or not re.fullmatch(r"/[A-Za-z0-9_/-]+", diretorio) or ".." in base.parts or base.is_symlink() or base.joinpath("backups").is_symlink(): raise RuntimeError("Diretório inválido.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", projeto) or not re.fullmatch(r"sha256:[a-f0-9]{64}", imagem): raise RuntimeError("Identificação inválida.")
    trava = base / ".publicacao.lock"
    if trava.is_symlink(): raise RuntimeError("Trava inválida.")
    with trava.open("a") as f:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if modo == "preparar" and not extras: r = preparar(base, projeto, imagem)
        elif modo == "concluir" and len(extras) == 2: r = concluir(base, projeto, imagem, *extras)
        else: raise RuntimeError("Operação inválida.")
        print(json.dumps(r))

