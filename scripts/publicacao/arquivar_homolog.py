"""Operação nominal do app legado; reutiliza o arquivador fixado na revisão 582."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path

CANONICO_SHA256 = "d355f9472f75ecf1c79584a7350572c20f22dd9db77564e163d1b13735c14897"
ALVO = "homolog-20261021"
TAG = "barberos-homolog:20261021"
ID = "sha256:2e71004d73bcdde1ca47aea01fab0a1c35df4ed226f84d3723a1fdaf62a6b2ba"
BYTES_IMAGEM = 716125086
ROOTFS = [
    "sha256:" + s for s in (
        "74d97c428c51a828f9051a7a40a53ff1fc99e54fc30323ce36760701b0b7f711",
        "72d3e05b9e525a1d24a2a9057bae2b276808e1d90f21db67fe3cf34fb1bf996a",
        "caefa24f31f0207dfdc7520d2a1510e7aadf2bc8ca4d25a67e6c6e1e02ab49d4",
        "690c35962e578d7b806464405458ec5c4a70ba26481c7759f049881d853f23cd",
        "e84858d43ea9dff1741c815c3c3ce18315c7d60ccf24087ea244a9bc2fc7e014",
        "e5eff1159dbdccc3db88f6263864ebf2c1167b0f3b3fa299bf119e28fac1696f",
        "810934d2ffb10d6451510c588ec0af332ac289ad39f3356098fae9f2b132a449",
        "e542f8918c8887aeb425fc2e2c2e5a5633f1112e3db3576bd8e204a79a34cf82",
        "fdf77ff1fe777817cfdee9f07607c77d267839b710918103f42380607e0d71de",
        "c22bd5cc42ff5f118e0f077ddfe99db8836225a86b46a1b6e6b3663a56654642",
        "34f9ace291acf4e1f77f2687e896e31e8ce62647ff14685b1c145cedec63f106",
        "d6853cbac6c84d1941af088bb853111827718c9d25b2c6c2029d94bff6415f1b",
        "e45d47a4cf239b3f1cddec3c7b133fdc950be5d6979505c11666198605404e72",
    )
]


def carregar_canonico(codigo):
    if not isinstance(codigo, str) or hashlib.sha256(codigo.encode()).hexdigest() != CANONICO_SHA256:
        raise RuntimeError("Fonte canônica difere da revisão autorizada.")
    ns = {"__name__": "arquivador_canonico_582"}
    exec(compile(codigo, "arquivar_workers_582.py", "exec"), ns)
    ns["ALVOS"] = {ALVO: (ID, BYTES_IMAGEM)}

    def tags_alvo(alvo=None):
        if alvo != ALVO:
            raise RuntimeError("Somente o app histórico nominal está autorizado.")
        return [TAG]

    ns["tags_alvo"] = tags_alvo
    candidatos_original, retrato_original = ns["candidatos"], ns["retrato"]

    def candidatos(alvo=None):
        resultado = candidatos_original(alvo)
        imagem = json.loads(ns["cmd"](["docker", "image", "inspect", TAG]))
        if (len(imagem) != 1 or imagem[0].get("Os") != "linux" or imagem[0].get("Architecture") != "amd64"
                or imagem[0].get("RootFS") != {"Type": "layers", "Layers": ROOTFS}):
            raise RuntimeError("Plataforma ou RootFS do app histórico mudou.")
        return resultado

    def retrato(base):
        estado = retrato_original(base)
        atendimento = base / ".env.atendimento"
        if atendimento.is_symlink() or not atendimento.is_file():
            raise RuntimeError("Configuração preservada de atendimento não confirmada.")
        estado["arquivos"][str(atendimento)] = ns["soma"](atendimento)
        return estado

    ns["candidatos"], ns["retrato"] = candidatos, retrato
    return ns


def executar(entrada):
    ns = carregar_canonico(entrada["codigoCanonico"])
    diretorio, projeto, imagem = entrada["base"], entrada["projeto"], entrada["imagemApp"]
    base = Path(diretorio)
    if (os.geteuid() != 0 or not re.fullmatch(r"/[A-Za-z0-9_/-]+", diretorio) or ".." in base.parts
            or base.is_symlink() or (base / "backups").is_symlink()):
        raise RuntimeError("Diretório inválido.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", projeto):
        raise RuntimeError("Projeto inválido.")
    ns["validar_app_alvo"](imagem, ALVO)
    modo = entrada["modo"]
    if modo not in ("preparar", "retomar", "concluir"):
        raise RuntimeError("Operação inválida.")
    import fcntl
    trava = base / ".publicacao.lock"
    if trava.is_symlink():
        raise RuntimeError("Trava inválida.")
    with trava.open("a") as f:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if modo == "concluir":
            return ns[modo](base, projeto, imagem, entrada["arquivo"], entrada["sha256"], ALVO)
        return ns[modo](base, projeto, imagem, ALVO)


if __name__ == "__main__":
    print(json.dumps(executar(json.load(sys.stdin))))
