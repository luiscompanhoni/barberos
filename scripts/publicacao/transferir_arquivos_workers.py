"""Leitura/restauração antes de transferir quatro arquivos históricos para guarda externa.

Remoção é uma etapa separada, exige autorização do dono e recibos conferidos pelo
operador. Este script não verifica a autenticidade de um recibo do GitHub sozinho.
"""
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

APP_ESPERADO = "sha256:000bf3cac4db8ce701711ebfbf3b50c7607c20602cddf9c8a4306f931e07148e"
ALVOS = {
    "workers-1793679730688481207.tar.gz": {
        "bytes": 1352603053, "sha256": "d6237c0f53ade25cc022f3ee27e64be26c91070c95c805e998ace359b12751f4",
        "imagens": [
            {"tag": "barberos-video-worker:55ee09e462437a5fe6951232b89c5be53845f760", "id": "sha256:77a98a390f240c96884ccaecd169d613cb28765a68d88ef0bb1e4572e4d208df"},
            {"tag": "barberos-video-worker:44ef999960b1739431c3333c4746556e02d11082", "id": "sha256:5d24c0148f9af6d5444dad04b6e7e1bbf31d4f655ec08881baefc994dd559c3d"},
            {"tag": "barberos-video-worker:df76e4fa0f1484cd2b2e4997c4babf38269baac7", "id": "sha256:5c85faf33eee831a942cc16af94daa9f388a97b8cd715091e11e212c11bc77ac"}]},
    "workers-1793719396708289953.tar.gz": {
        "bytes": 1352579621, "sha256": "c61a5790e5fa9726afc7124aa43265e4b8152eb2a453fb98e58c9f51696601b7",
        "imagens": [
            {"tag": "barberos-video-worker:7a7d3e9cfd834ba933e54eadcb63f653b8a236f6", "id": "sha256:881c6f444a2340a6e94c74dee6495691cb158efe304d7d916072b683eccd0b48"},
            {"tag": "barberos-video-worker:d2d7af8e56976b81d123c2f08b9c55f3d6dee970", "id": "sha256:6812c1107be2ef4d8f891751cccd015df973586f276f29838a705dec9d3b7325"},
            {"tag": "barberos-video-worker:ea5b5222b488f2aa45f9884e15624f501b7e9250", "id": "sha256:09f74be21c11ddb60834ee0a0029b033210b3ab4106e74bbe6a49790f63e12f0"}]},
    "workers-1793825938203932356.tar.gz": {
        "bytes": 1352604044, "sha256": "44622ecb32ff0e0cc5492ffb6b8e3ea8eaa8aa35bf4e03c3f340cbc5400885f0",
        "imagens": [
            {"tag": "barberos-video-worker:38afc027c4826730b5c0328f839a90ea30ed2110", "id": "sha256:5bb58f44c8940507e6c0d34921caa7805d05e64a214b089d3ba361af1fe9be68"},
            {"tag": "barberos-video-worker:085fc5b8c85b274e18e9e4b9c4e3ae0a0a63b1c1", "id": "sha256:6ff5bd3a4115f9671d9361f30bc6998cbbdfa04d9b9013ff1b1f3d1df5691e13"},
            {"tag": "barberos-video-worker:9d170a722ecbc9b48870a2fec1327712fc407a90", "id": "sha256:def533867b6778e0aa7440684670bdad774c926b95d7a53778f79a89bfdbeac0"}]},
    "workers-1793893835032522907.tar.gz": {
        "bytes": 504590203, "sha256": "4028538187afaa9b549eec8a81e5ee95a1009a8bde688300f60c1a1282f4f63e",
        "imagens": [{"tag": "barberos-video-worker:f7968a11b1892b07eaad46b659ad7c5d18bb9bd4", "id": "sha256:32855fc2a5d7d791a154ca309cb212526c0791c6f1395819357be43432afa1ce"}]},
}


def alvo(nome):
    if nome not in ALVOS:
        raise RuntimeError("Arquivo fora dos quatro alvos revisados.")
    return {"arquivo": nome, **ALVOS[nome]}


def pasta_segura(base):
    if not base.is_absolute() or ".." in base.parts:
        raise RuntimeError("Base inválida.")
    for p in [base, *base.parents]:
        if p.is_symlink():
            raise RuntimeError("Base redirecionada.")
    pasta = base / "worker-archives"
    if pasta.is_symlink() or not pasta.is_dir() or pasta.resolve() != base.resolve() / "worker-archives":
        raise RuntimeError("Pasta de arquivos inesperada.")
    return pasta


def abrir_seguro(path):
    # O_NOFOLLOW é obrigatório no servidor Linux; não degradar a proteção.
    if not hasattr(os, "O_NOFOLLOW"):
        raise RuntimeError("A abertura segura exige Linux.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise RuntimeError("Esperado arquivo regular.")
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise


def ler_json(path):
    with abrir_seguro(path) as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise RuntimeError("Registro acima do limite.")
    return json.loads(raw)


def conferir_registro(pasta, esperado):
    registro = ler_json(pasta / (esperado["arquivo"] + ".json"))
    if any(registro.get(k) != esperado[k] for k in ("arquivo", "sha256", "bytes", "imagens")):
        raise RuntimeError("Registro do arquivo divergiu do inventário.")


def conferir_stream(stream, esperado):
    antes = os.fstat(stream.fileno())
    if antes.st_size != esperado["bytes"]:
        raise RuntimeError("Tamanho divergente.")
    if hashlib.file_digest(stream, "sha256").hexdigest() != esperado["sha256"]:
        raise RuntimeError("Hash divergente.")
    depois = os.fstat(stream.fileno())
    if (antes.st_dev, antes.st_ino, antes.st_size, antes.st_mtime_ns) != (depois.st_dev, depois.st_ino, depois.st_size, depois.st_mtime_ns):
        raise RuntimeError("Arquivo mudou durante a leitura.")
    stream.seek(0)
    return antes


def exportar(base, nome, destino):
    esperado, pasta = alvo(nome), pasta_segura(base)
    conferir_registro(pasta, esperado)
    with abrir_seguro(pasta / nome) as stream:
        conferir_stream(stream, esperado)
        shutil.copyfileobj(stream, destino, length=1024 * 1024)
    return esperado


def conferir_app():
    raw = subprocess.check_output(["docker", "inspect", "barberos-app-1"], stderr=subprocess.PIPE, timeout=20)
    app = json.loads(raw)[0]
    if app["Image"] != APP_ESPERADO or app["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("A instalação mudou ou não está saudável.")


def validar_comprovante(esperado, comprovante):
    if comprovante.get("formato") != 1 or comprovante.get("autorizacaoDono") != "REMOVER_SOMENTE_COPIA_VPS_DOS_QUATRO_ARQUIVOS":
        raise RuntimeError("Autorização específica ausente.")
    copia, ci = comprovante.get("copiaLocal", {}), comprovante.get("restauracaoCI", {})
    if copia.get("validada") is not True or copia.get("armazenamento") != "LOCAL_PRIVADO_PERSISTENTE":
        raise RuntimeError("Cópia local persistente não comprovada.")
    if any(copia.get(k) != esperado[k] for k in ("arquivo", "sha256", "bytes")):
        raise RuntimeError("Cópia local não corresponde ao arquivo.")
    if ci.get("conclusao") != "success" or ci.get("repositorio") != "luiscompanhoni/barberos" or ci.get("workflow") != "validar-arquivos-workers.yml":
        raise RuntimeError("Restauração CI não comprovada.")
    if not isinstance(ci.get("runId"), int) or isinstance(ci.get("runId"), bool) or ci["runId"] <= 0 or not re.fullmatch(r"[a-f0-9]{40}", ci.get("commit", "")):
        raise RuntimeError("Identidade da execução CI inválida.")
    for k in ("arquivo", "sha256", "bytes", "imagens"):
        if ci.get(k) != esperado[k]:
            raise RuntimeError("CI corresponde a outro arquivo.")
    if ci.get("restauracaoIsoladaValidada") is not True or ci.get("renderSinteticoValidado") is not True:
        raise RuntimeError("Imagem ou render não comprovados.")


def gravar_exclusivo(path, valor):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf8") as stream:
        json.dump(valor, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())


def sincronizar(pasta):
    fd = os.open(pasta, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def remover_copia_vps(base, nome, comprovante):
    """Somente após autorização e autenticidade dos recibos conferidas pelo operador."""
    esperado, pasta = alvo(nome), pasta_segura(base)
    validar_comprovante(esperado, comprovante)
    conferir_app()
    conferir_registro(pasta, esperado)
    registro = pasta / (nome + ".transferido.json")
    concluido = pasta / (nome + ".transferido-concluido.json")
    operacao = {"formato": 1, "alvo": esperado, "comprovante": comprovante}
    arquivo = pasta / nome
    presente = arquivo.exists() or arquivo.is_symlink()
    if not presente and not (registro.exists() or registro.is_symlink()):
        raise RuntimeError("Arquivo ausente sem registro de transferência.")
    if concluido.exists() or concluido.is_symlink():
        if ler_json(concluido) != operacao or presente:
            raise RuntimeError("Conclusão anterior divergente ou arquivo reposto; não remover.")
    # Primeiro valida o arquivo presente; só então pode criar o WAL de remoção.
    if presente:
        with abrir_seguro(arquivo) as stream:
            antes = conferir_stream(stream, esperado)
    # WAL durável precede a única remoção; uma interrupção pode ser retomada.
    if registro.exists() or registro.is_symlink():
        if ler_json(registro) != operacao:
            raise RuntimeError("Recibo anterior divergente; não remover.")
    else:
        gravar_exclusivo(registro, operacao)
        sincronizar(pasta)
    if presente:
        with abrir_seguro(arquivo) as stream:
            conferido = conferir_stream(stream, esperado)
            if (antes.st_dev, antes.st_ino, antes.st_size, antes.st_mtime_ns) != (conferido.st_dev, conferido.st_ino, conferido.st_size, conferido.st_mtime_ns):
                raise RuntimeError("Arquivo substituído antes da remoção.")
            atual = arquivo.lstat()
            if (atual.st_dev, atual.st_ino, atual.st_size, atual.st_mtime_ns) != (antes.st_dev, antes.st_ino, antes.st_size, antes.st_mtime_ns) or not stat.S_ISREG(atual.st_mode):
                raise RuntimeError("Arquivo substituído; não remover.")
            arquivo.unlink()
        sincronizar(pasta)
    elif not registro.exists():
        raise RuntimeError("Arquivo ausente sem registro de transferência.")
    if not concluido.exists():
        gravar_exclusivo(concluido, operacao)
        sincronizar(pasta)
    conferir_app()
    return {"concluido": True, **esperado, "copiaLocalPreservada": True,
            "registroOriginalPreservado": True, "livreBytes": shutil.disk_usage(base).free}


if __name__ == "__main__":
    if sys.argv[1:] == ["--inventario"]:
        print(json.dumps(ALVOS))
        raise SystemExit(0)
    import fcntl
    modo, diretorio, nome = sys.argv[1:]
    base = Path(diretorio)
    if os.geteuid() != 0 or diretorio != "/opt/barberos":
        raise SystemExit("Instalação esperada não confirmada.")
    if modo == "exportar":
        exportar(base, nome, sys.stdout.buffer)
    elif modo == "remover-copia-vps":
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            raise SystemExit("Comprovante acima do limite.")
        lock = base / ".publicacao.lock"
        with os.fdopen(os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), "a+") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(remover_copia_vps(base, nome, json.loads(raw))))
    else:
        raise SystemExit("Operação inválida.")
