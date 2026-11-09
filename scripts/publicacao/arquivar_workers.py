"""Arquiva uma tag histórica por operação; nunca publica ou descarta dados da instalação."""
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

# O modo antigo mantém o inventário f796, separado dos três alvos novos.
TAGS = ["barberos-video-worker:f7968a11b1892b07eaad46b659ad7c5d18bb9bd4"]
PREFIXO_ID = "sha256:32855fc2a5d7"
APP_ESPERADO = "sha256:a2a78e0a4ab504fa65cb72c9c21130e05a261c2b4134bc3b41532fc407a187d6"
ALVOS = {
    "d833182db751a74d3ce52017f11a2824fcb6c735": ("sha256:4d5728f7035eb38b0cb29c752936637047f997cf0e6eb240285c956a6f13b87e", 1948259798),
    "7f8c8f2e3dc77a1ffe39e01fc4cf1c00a752dd10": ("sha256:412eeeb7c3f1f1f555a5420d10a55311bd6a81c5b965f5c40fc5e354104466ab", 1948279454),
    "7efefa8daf285b2b46b8bb9d8e57663c2a2b6a8a": ("sha256:3a226008e7aeb5897ea669d64e22b12ae3a42ba7eb5a29bcdf27668476ce1568", 1948299299),
}
MAX_ARQUIVO_BYTES = 2_000_000_000
MIN_LIVRE_BYTES = 1024**3


def cmd(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, timeout=180).decode()


def soma(p):
    with p.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def tags_alvo(alvo=None):
    if alvo is None:
        return TAGS
    if alvo not in ALVOS:
        raise RuntimeError("Selecione exatamente um alvo do inventário autorizado.")
    return ["barberos-video-worker:" + alvo]


def validar_app_alvo(esperada, alvo):
    tags_alvo(alvo)
    if alvo is not None and esperada != APP_ESPERADO:
        raise RuntimeError("Imagem atual difere do inventário desta operação.")


def imagens():
    return set(cmd(["docker", "image", "ls", "--no-trunc", "--format", "{{.ID}} {{.Repository}}:{{.Tag}}"]).splitlines())


def retrato(base):
    arquivos = [base / ".env"]
    if (base / ".env.estudio").exists():
        arquivos.append(base / ".env.estudio")
    for pasta in (base / "backups", base / "worker-archives"):
        if pasta.is_symlink():
            raise RuntimeError("Diretório preservado inesperado.")
        for p in pasta.rglob("*"):
            if p.is_symlink():
                raise RuntimeError("Arquivo preservado inesperado.")
            if p.is_file():
                arquivos.append(p)
    if any(p.is_symlink() or not p.is_file() for p in arquivos):
        raise RuntimeError("Arquivo preservado inesperado.")
    return {"imagens": sorted(imagens()),
            "containers": sorted(cmd(["docker", "ps", "-a", "--no-trunc", "--format", "{{.ID}} {{.Image}} {{.State}}"]).splitlines()),
            "volumes": sorted(cmd(["docker", "volume", "ls", "-q"]).splitlines()),
            "arquivos": {str(p): soma(p) for p in arquivos}}


def conferir_preservacao(antes, depois, tags=()):
    manter = [s for s in antes["imagens"] if not any(s.endswith(" " + t) for t in tags)]
    if not set(manter).issubset(depois["imagens"]):
        raise RuntimeError("Imagem preservada ausente.")
    for campo in ("containers", "volumes"):
        if set(antes[campo]) != set(depois[campo]):
            raise RuntimeError("Container ou volume mudou.")
    if any(depois["arquivos"].get(p) != h for p, h in antes["arquivos"].items()):
        raise RuntimeError("Backup, arquivo anterior ou configuração mudou.")


def conferir_app(projeto, esperada):
    ids = cmd(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + projeto,
               "--filter", "label=com.docker.compose.service=app"]).split()
    if len(ids) != 1:
        raise RuntimeError("Aplicação não confirmada.")
    app = json.loads(cmd(["docker", "inspect", ids[0]]))[0]
    if app["Image"] != esperada or app["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("Aplicação mudou ou não está saudável.")


def candidatos(alvo=None):
    tags = tags_alvo(alvo)
    ids = cmd(["docker", "ps", "-aq"]).split()
    usados = {c["Image"] for c in json.loads(cmd(["docker", "inspect", *ids]))} if ids else set()
    lista = json.loads(cmd(["docker", "image", "inspect", *tags]))
    resultado = []
    for tag, img in zip(tags, lista, strict=True):
        if img["Id"] in usados or img.get("RepoTags") != [tag]:
            raise RuntimeError("Worker histórico em uso ou tag inesperada.")
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", img["Id"]):
            raise RuntimeError("ID do worker inválido.")
        if alvo is None:
            if not img["Id"].startswith(PREFIXO_ID):
                raise RuntimeError("ID do worker diverge do inventário histórico.")
            resultado.append({"tag": tag, "id": img["Id"]})
        else:
            esperado, tamanho = ALVOS[alvo]
            if img["Id"] != esperado or img.get("Size") != tamanho:
                raise RuntimeError("ID ou tamanho do worker diverge do inventário autorizado.")
            resultado.append({"tag": tag, "id": esperado, "bytesImagem": tamanho})
    return resultado


def limites(base, tamanho, alvo):
    maximo = MAX_ARQUIVO_BYTES if alvo is not None else 2 * 1024**3
    if tamanho > maximo or shutil.disk_usage(base).free < MIN_LIVRE_BYTES:
        raise RuntimeError("Limite de arquivo ou reserva de 1 GiB atingido; imagens preservadas.")


def gravar_json(path, valor):
    with open(path, "x", encoding="utf8", opener=lambda p, f: os.open(p, f | getattr(os, "O_NOFOLLOW", 0), 0o600)) as f:
        json.dump(valor, f)
        f.flush()
        os.fsync(f.fileno())


def preparar(base, projeto, esperada, alvo=None):
    validar_app_alvo(esperada, alvo)
    pasta = base / "worker-archives"
    marcador = pasta / ("alvo-" + alvo + ".json") if alvo is not None else None
    if pasta.is_symlink() or (marcador and (marcador.exists() or marcador.is_symlink())):
        raise RuntimeError("Alvo já preparado ou concluído; revisar o registro antes de nova operação.")
    conferir_app(projeto, esperada)
    lista = candidatos(alvo)
    antes = retrato(base)
    livre_antes = shutil.disk_usage(base).free
    if alvo is None and livre_antes < 3 * 1024**3:
        raise RuntimeError("Sem espaço para o arquivamento histórico.")
    limites(base, 0, alvo)
    pasta.mkdir(mode=0o700, exist_ok=True)
    nome = f"workers-{time.time_ns()}.tar.gz"
    arquivo = pasta / nome
    proc = subprocess.Popen(["docker", "save", *tags_alvo(alvo)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    temporizador = threading.Timer(600, proc.kill)
    temporizador.daemon = True
    temporizador.start()
    criado = False
    try:
        with arquivo.open("xb") as f:
            criado = True
            os.chmod(arquivo, 0o600)
            with gzip.GzipFile(fileobj=f, mode="wb", compresslevel=1) as gz:
                while b := proc.stdout.read(1024 * 1024):
                    gz.write(b)
                    limites(base, f.tell(), alvo)
            f.flush()
            os.fsync(f.fileno())
            limites(base, f.tell(), alvo)  # inclui o último bloco e o rodapé gzip
        if proc.wait(timeout=30):
            raise RuntimeError("Arquivo não concluído.")
    except BaseException:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=30)
        # Só o parcial novo; nenhuma imagem ou arquivo anterior é removido.
        if criado:
            arquivo.unlink(missing_ok=True)
        raise
    finally:
        temporizador.cancel()
        proc.stdout.close()
    conferir_preservacao(antes, retrato(base))
    limites(base, arquivo.stat().st_size, alvo)
    r = {"arquivo": nome, "sha256": soma(arquivo), "bytes": arquivo.stat().st_size,
         "imagens": lista, "livreAntes": livre_antes, "antes": antes}
    if alvo is not None:
        r.update(formato=2, alvo=alvo, imagemApp=esperada)
    gravar_json(pasta / (nome + ".json"), r)
    if marcador:
        gravar_json(marcador, {"alvo": alvo, "arquivo": nome, "sha256": r["sha256"], "concluido": False})
    return {k: v for k, v in r.items() if k != "antes"}


def concluir(base, projeto, esperada, nome, checksum, alvo=None):
    validar_app_alvo(esperada, alvo)
    if not re.fullmatch(r"workers-\d+\.tar\.gz", nome) or not re.fullmatch(r"[a-f0-9]{64}", checksum):
        raise RuntimeError("Arquivo inválido.")
    pasta, tags = base / "worker-archives", tags_alvo(alvo)
    arquivo, registro = pasta / nome, pasta / (nome + ".json")
    if pasta.is_symlink() or arquivo.is_symlink() or registro.is_symlink():
        raise RuntimeError("Arquivo inesperado.")
    r = json.loads(registro.read_text(encoding="utf8"))
    if r["arquivo"] != nome or r["sha256"] != checksum or soma(arquivo) != checksum or r["bytes"] != arquivo.stat().st_size:
        raise RuntimeError("Arquivo mudou; imagens preservadas.")
    marcador = pasta / ("alvo-" + alvo + ".json") if alvo is not None else None
    if marcador:
        if marcador.is_symlink() or r.get("formato") != 2 or r.get("alvo") != alvo or r.get("imagemApp") != esperada:
            raise RuntimeError("Registro de outro alvo; imagens preservadas.")
        estado = json.loads(marcador.read_text(encoding="utf8"))
        if estado != {"alvo": alvo, "arquivo": nome, "sha256": checksum, "concluido": False}:
            raise RuntimeError("Alvo já concluído ou registro divergente.")
    elif r.get("alvo") is not None:
        raise RuntimeError("Registro selecionado não pertence ao modo histórico.")
    limites(base, r["bytes"], alvo)
    conferir_app(projeto, esperada)
    if candidatos(alvo) != r["imagens"]:
        raise RuntimeError("Imagens mudaram; cópias preservadas.")
    conferir_preservacao(r["antes"], retrato(base))
    limites(base, arquivo.stat().st_size, alvo)
    # Só depois de transporte, Docker Load e render sintético no executor isolado.
    cmd(["docker", "image", "rm", *tags])
    conferir_app(projeto, esperada)
    depois = retrato(base)
    conferir_preservacao(r["antes"], depois, tags)
    if any(s.endswith(" " + tags[0]) for s in depois["imagens"]):
        raise RuntimeError("Tag selecionada ainda presente; conclusão não comprovada.")
    resultado = {"concluido": True, "arquivo": str(arquivo), "sha256": checksum, "bytes": r["bytes"],
                 "imagensArquivadas": r["imagens"], "livreAntes": r["livreAntes"],
                 "livreDepois": shutil.disk_usage(base).free, "espacoRecuperadoPrometido": False,
                 "containersVolumesBackupsConfiguracaoPreservados": True}
    if marcador:
        temporario = marcador.with_suffix(".concluido.tmp")
        gravar_json(temporario, {"alvo": alvo, "arquivo": nome, "sha256": checksum, "concluido": True})
        os.replace(temporario, marcador)
        resultado["alvo"] = alvo
    return resultado


if __name__ == "__main__":
    import fcntl
    modo, diretorio, projeto, imagem, *extras = sys.argv[1:]
    base = Path(diretorio)
    if os.geteuid() != 0 or not re.fullmatch(r"/[A-Za-z0-9_/-]+", diretorio) or ".." in base.parts or base.is_symlink() or base.joinpath("backups").is_symlink():
        raise RuntimeError("Diretório inválido.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", projeto) or not re.fullmatch(r"sha256:[a-f0-9]{64}", imagem):
        raise RuntimeError("Identificação inválida.")
    trava = base / ".publicacao.lock"
    if trava.is_symlink():
        raise RuntimeError("Trava inválida.")
    with trava.open("a") as f:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if modo == "preparar" and not extras:
            r = preparar(base, projeto, imagem)
        elif modo == "concluir" and len(extras) == 2:
            r = concluir(base, projeto, imagem, *extras)
        elif modo == "preparar-alvo" and len(extras) == 1:
            r = preparar(base, projeto, imagem, extras[0])
        elif modo == "concluir-alvo" and len(extras) == 3:
            r = concluir(base, projeto, imagem, extras[1], extras[2], extras[0])
        else:
            raise RuntimeError("Operação inválida.")
        print(json.dumps(r))
