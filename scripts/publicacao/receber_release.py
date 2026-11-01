"""Recebe pacote de código em diretório novo, sem substituir a instalação anterior."""
import hashlib
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path


def receber(base, commit, sha256, origem):
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or not re.fullmatch(r"[a-f0-9]{64}", sha256):
        raise ValueError("Identificação inválida")
    if base.is_symlink() or not (base / ".env").is_file():
        raise ValueError("Instalação não confirmada")
    releases = base / "releases"
    if releases.is_symlink():
        raise ValueError("Pasta inesperada")
    releases.mkdir(mode=0o700, exist_ok=True)
    destino = releases / commit
    if destino.exists():
        raise ValueError("Release já recebida; conferir a execução anterior")
    with tempfile.TemporaryDirectory(prefix=".recebendo-", dir=releases) as temporario:
        pasta = Path(temporario)
        entrega = pasta / "entrega.tar.gz"
        with entrega.open("wb") as f:
            total = 0
            while pedaco := origem.read(1024 * 1024):
                total += len(pedaco)
                if total > 32 * 1024 * 1024:
                    raise ValueError("Pacote acima do limite")
                f.write(pedaco)
        if hashlib.sha256(entrega.read_bytes()).hexdigest() != sha256:
            raise ValueError("Checksum divergente")
        with tarfile.open(entrega) as tar:
            membros = tar.getmembers()
            if sorted(m.name for m in membros) != ["codigo.tar.gz", "versao.json"] or any(not m.isfile() or m.size > 32 * 1024 * 1024 for m in membros):
                raise ValueError("Envelope inválido")
            tar.extractall(pasta, members=membros, filter="data")
        manifesto = json.loads((pasta / "versao.json").read_text())
        if manifesto["commit"] != commit or hashlib.sha256((pasta / "codigo.tar.gz").read_bytes()).hexdigest() != manifesto["codigoSha256"]:
            raise ValueError("Manifesto divergente")
        with tarfile.open(pasta / "codigo.tar.gz") as tar:
            for m in tar.getmembers():
                p = Path(m.name)
                if p.is_absolute() or ".." in p.parts or not p.parts or p.parts[0] != "barberos" or not (m.isfile() or m.isdir()) or m.size > 32 * 1024 * 1024:
                    raise ValueError("Caminho inseguro no código")
            tar.extractall(pasta, filter="data")
        entrega.unlink()
        # Renomeação no mesmo filesystem; destino não existente.
        os.rename(pasta, destino)
    return destino


if __name__ == "__main__":
    os.umask(0o077)
    try:
        receber(Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.stdin.buffer)
        print("PACOTE_RECEBIDO")
    except Exception:
        raise SystemExit("Pacote não recebido; instalação anterior preservada.") from None
