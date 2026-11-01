"""Copia e restaura as mídias referenciadas pelo banco de um dump já restaurado.

Não altera o banco nem o volume original. Conteúdo privado não aparece nos erros.
O par dump/arquivo de mídias é vinculado por SHA-256. Apenas nomes UUID são aceitos.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile
import tempfile

NOME = re.compile(r"^[a-f0-9-]{36}\.(mp4|webm|mov)$")
MANIFESTO = "manifesto.json"
LIMITE = 150 * 1024 * 1024


def sha256(caminho):
    with open(caminho, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def consulta(banco, sql):
    r = subprocess.run(["psql", "-X", "-d", banco, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
                       capture_output=True, text=True, check=True)
    return r.stdout.strip()


def referencias(banco):
    presentes = consulta(banco, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' "
                         "AND table_name IN ('estudio_clipes','estudio_versoes')")
    if presentes == "0":
        return {}
    if presentes != "2":
        raise ValueError("Schema do Estúdio incompleto no banco restaurado.")
    linhas = json.loads(consulta(banco, "SELECT coalesce(json_agg(r), '[]') FROM ("
                        "SELECT arquivo, bytes, null::text AS sha256 FROM estudio_clipes WHERE arquivo IS NOT NULL "
                        "UNION ALL SELECT arquivo, bytes, sha256 FROM estudio_versoes WHERE arquivo IS NOT NULL) r"))
    resultado = {}
    for r in linhas:
        nome, tamanho, digest = r["arquivo"], r["bytes"], r["sha256"]
        if not NOME.fullmatch(nome) or not isinstance(tamanho, int) or not 0 < tamanho <= LIMITE:
            raise ValueError("Referência de mídia inválida no banco restaurado.")
        if digest is not None and not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Hash de mídia inválido no banco restaurado.")
        if nome in resultado and resultado[nome] != r:
            raise ValueError("Referências de mídia conflitantes.")
        resultado[nome] = r
    return resultado


class LeitorComHash:
    def __init__(self, arquivo):
        self.arquivo = arquivo
        self.hash = hashlib.sha256()

    def read(self, tamanho):
        dados = self.arquivo.read(tamanho)
        self.hash.update(dados)
        return dados


def criar(dump, refs, destino, origem):
    origem, destino = Path(origem), Path(destino)
    if not origem.is_dir() or origem.is_symlink():
        raise ValueError("Volume de mídias indisponível.")
    # O destino parcial é privado; nunca sobrescrever um backup anterior.
    fd, parcial = tempfile.mkstemp(prefix=".studio-", dir=destino.parent)
    try:
        manifest = {"formato": 1, "dumpSha256": sha256(dump), "arquivos": {}}
        with os.fdopen(fd, "wb") as saida, tarfile.open(fileobj=saida, mode="w:gz", compresslevel=1) as tar:
            for nome, ref in sorted(refs.items()):
                with os.fdopen(os.open(origem / nome, os.O_RDONLY | os.O_NOFOLLOW), "rb") as f:
                    antes = os.fstat(f.fileno())
                    if not stat.S_ISREG(antes.st_mode) or antes.st_size != ref["bytes"]:
                        raise ValueError("Mídia ausente ou com tamanho divergente.")
                    item = tarfile.TarInfo(nome)
                    item.size, item.mode = antes.st_size, 0o600
                    leitor = LeitorComHash(f)
                    tar.addfile(item, leitor)
                    depois = os.fstat(f.fileno())
                    digest = leitor.hash.hexdigest()
                    if (antes.st_size, antes.st_mtime_ns, antes.st_ctime_ns) != (depois.st_size, depois.st_mtime_ns, depois.st_ctime_ns):
                        raise ValueError("Mídia alterada durante a cópia.")
                    if ref["sha256"] and ref["sha256"] != digest:
                        raise ValueError("Mídia divergente do hash registrado no banco.")
                    manifest["arquivos"][nome] = {"bytes": item.size, "sha256": digest}
            dados = json.dumps(manifest, sort_keys=True).encode()
            item = tarfile.TarInfo(MANIFESTO)
            item.size, item.mode = len(dados), 0o600
            tar.addfile(item, io.BytesIO(dados))
        # Restauração real em pasta descartável antes de publicar o arquivo final.
        with tempfile.TemporaryDirectory(prefix=".studio-conferencia-", dir=destino.parent) as tmp:
            restaurar(dump, refs, parcial, Path(tmp) / "media")
        os.link(parcial, destino)  # publicação sem substituir um arquivo existente
    finally:
        Path(parcial).unlink(missing_ok=True)


def restaurar(dump, refs, arquivo, destino):
    destino = Path(destino)
    destino.mkdir(mode=0o700)  # deve ser novo; nunca extrair sobre arquivos existentes
    encontrados, manifest, leu_manifesto = {}, None, False
    with tarfile.open(arquivo, "r:gz") as tar:
        for item in tar:
            if not item.isfile() or item.name in encontrados:
                raise ValueError("Entrada inválida ou repetida no backup de mídias.")
            if item.name == MANIFESTO:
                if leu_manifesto or item.size > 16 * 1024 * 1024:
                    raise ValueError("Manifesto inválido.")
                leu_manifesto = True
                manifest = json.load(tar.extractfile(item))
                continue
            ref = refs.get(item.name)
            if ref is None or not NOME.fullmatch(item.name) or item.size != ref["bytes"]:
                raise ValueError("Mídia não corresponde ao banco restaurado.")
            h = hashlib.sha256()
            with tar.extractfile(item) as origem, open(destino / item.name, "xb") as saida:
                os.chmod(destino / item.name, 0o600)
                while dados := origem.read(1024 * 1024):
                    saida.write(dados)
                    h.update(dados)
            encontrados[item.name] = {"bytes": item.size, "sha256": h.hexdigest()}
            if ref["sha256"] and ref["sha256"] != h.hexdigest():
                raise ValueError("Mídia restaurada diverge do banco.")
    if (not isinstance(manifest, dict) or manifest.get("formato") != 1
            or manifest.get("dumpSha256") != sha256(dump)
            or manifest.get("arquivos") != encontrados or set(refs) != set(encontrados)):
        raise ValueError("Par banco/mídias incompleto ou com integridade inválida.")
    # Ler novamente os arquivos materializados, não apenas o stream do tar.
    if any(sha256(destino / n) != r["sha256"] for n, r in encontrados.items()):
        raise ValueError("Falha ao conferir arquivos restaurados.")
    return len(encontrados)


def main(args):
    if len(args) not in (4, 5) or args[0] not in {"criar", "verificar", "restaurar", "exigir-vazio"}:
        raise ValueError("Uso: backup-estudio.py criar|verificar|restaurar DUMP BANCO ARQUIVO [PASTA]")
    acao, dump, banco, arquivo = args[:4]
    refs = referencias(banco)
    if acao == "exigir-vazio":
        if refs:
            raise ValueError("Há mídias no banco sem volume configurado para backup.")
        return
    if acao == "criar":
        criar(dump, refs, arquivo, args[4])
    elif acao == "restaurar":
        restaurar(dump, refs, arquivo, args[4])
    else:
        with tempfile.TemporaryDirectory(prefix=".studio-conferencia-", dir=Path(arquivo).parent) as tmp:
            restaurar(dump, refs, arquivo, Path(tmp) / "media")
    print(f"{len(refs)} mídias restauradas e conferidas por SHA-256")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main(sys.argv[1:])
    except Exception:
        print("Falha no backup/restauração do Estúdio: conferir volume, espaço livre, par de arquivos e referências do banco.", file=sys.stderr)
        sys.exit(1)
