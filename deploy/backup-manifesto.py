"""Gera dump e manifesto no mesmo snapshot; confere somente uma restauração isolada."""
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location("conferencia", Path(__file__).with_name("backup-conferencia.py"))
conferencia = importlib.util.module_from_spec(spec)
spec.loader.exec_module(conferencia)


def hash_arquivo(caminho):
    with open(caminho, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def criar(banco, dump, manifesto):
    if Path(dump).exists() or Path(manifesto).exists():
        raise RuntimeError("Destino já existe; não sobrescrever backup.")
    exigir_capacidade(banco, Path(dump).parent)
    with tempfile.TemporaryFile() as stderr:
        exportador = subprocess.Popen(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-d", banco], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=stderr, text=True, encoding="utf8")
        try:
            exportador.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SELECT pg_export_snapshot();\n")
            exportador.stdin.flush()
            snapshot = exportador.stdout.readline().strip()
            if not re.fullmatch(r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+", snapshot):
                raise RuntimeError("Snapshot consistente não foi exportado.")
            with open(dump, "xb", opener=lambda p, f: os.open(p, f | os.O_NOFOLLOW, 0o600)) as destino:
                with gzip.GzipFile(fileobj=destino, mode="wb", mtime=0) as comprimido:
                    def copiar(origem):
                        while bloco := origem.read(64 * 1024):
                            comprimido.write(bloco)
                    conferencia.stream(["pg_dump", "-d", banco, "--snapshot=" + snapshot], copiar)
                destino.flush()
                os.fsync(destino.fileno())
            referencia = {"formato": 1, "dumpSha256": hash_arquivo(dump), "snapshotConsistente": True,
                          **conferencia.capturar(banco, snapshot),
                          "limites": "Sem valores de dados no manifesto; definições de sequências são comparadas e estados restaurados são conferidos contra os SETVAL do próprio dump, não contra a fonte viva."}
            with open(manifesto, "x", encoding="utf8", opener=lambda p, f: os.open(p, f | os.O_NOFOLLOW, 0o600)) as f:
                json.dump(referencia, f, ensure_ascii=False, sort_keys=True)
                f.flush()
                os.fsync(f.fileno())
        finally:
            if exportador.poll() is None:
                exportador.stdin.close()  # encerra a transação/exportação sem escrever no banco
                try:
                    exportador.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    exportador.kill()
                    exportador.wait(timeout=15)
            exportador.stdout.close()


def exigir_capacidade(banco, pasta):
    dados = Path(os.environ.get("BACKUP_PG_DATA", "/caminho-nao-configurado"))
    if not dados.is_dir() or dados.is_symlink():
        raise RuntimeError("Montagem somente leitura para medir espaço do PostgreSQL não configurada.")
    tamanho = int(conferencia.psql(banco, "SELECT pg_database_size(current_database())").strip())
    tabelas = conferencia.psql(banco, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('estudio_clipes','estudio_versoes')").strip()
    if tabelas not in {b"0", b"2"}:
        raise RuntimeError("Schema de mídia incompleto.")
    midias = int(conferencia.psql(banco, "SELECT coalesce(sum(bytes),0) FROM (SELECT bytes FROM estudio_clipes WHERE arquivo IS NOT NULL UNION ALL SELECT bytes FROM estudio_versoes WHERE arquivo IS NOT NULL) r").strip()) if tabelas == b"2" else 0
    gib = 1024**3
    locais = [(pasta, 4*tamanho + 3*midias + 2*gib), (dados, 3*tamanho + gib),
              (Path(tempfile.gettempdir()), max(2*tamanho, midias) + gib//4)]
    dispositivos = {}
    for local, necessario in locais:
        d = dispositivos.setdefault(local.stat().st_dev, {"livre": shutil.disk_usage(local).free, "necessario": 0})
        d["necessario"] += necessario
    if any(d["livre"] < d["necessario"] for d in dispositivos.values()):
        raise RuntimeError("Espaço insuficiente para backup, clone, mídia e criptografia temporária.")


def verificar(banco, dump, manifesto):
    if not re.fullmatch(r"barberos_teste_[A-Za-z0-9_]+|barberos_restaurado", banco):
        raise RuntimeError("Verificação exige um banco isolado de recuperação.")
    if Path(dump).is_symlink() or Path(manifesto).is_symlink():
        raise RuntimeError("Par de backup inesperado.")
    referencia = json.loads(Path(manifesto).read_text(encoding="utf8"))
    if referencia.get("formato") != 1 or referencia.get("snapshotConsistente") is not True or referencia.get("dumpSha256") != hash_arquivo(dump):
        raise RuntimeError("Manifesto não corresponde ao snapshot do dump.")
    restaurado = conferencia.capturar(banco)
    conferencia.comparar(referencia, restaurado)
    sequencias = conferencia.conferir_sequencias(banco, dump, referencia["estrutura"].get("sequencias", []))
    auditoria = "public.auditoria" in referencia["tabelas"]
    if auditoria:
        conferencia.testar_auditoria(banco)
    return {"formato": 1, "dumpSha256": referencia["dumpSha256"], "tabelas": len(restaurado["tabelas"]),
            "linhasIguais": True, "estruturaIgual": True, "sequenciasConferidasComDump": sequencias, "auditoriaImutavelTestada": auditoria}


if __name__ == "__main__":
    os.umask(0o077)
    try:
        if len(sys.argv) != 5 or sys.argv[1] not in {"criar", "verificar"} or not re.fullmatch(r"[A-Za-z0-9_]{1,63}", sys.argv[2]):
            raise ValueError("Argumentos inválidos.")
        acao, banco, dump, manifesto = sys.argv[1:]
        if acao == "criar":
            criar(banco, dump, manifesto)
        else:
            print(json.dumps(verificar(banco, dump, manifesto)))
    except Exception:
        print("Falha na conferência consistente do backup: conteúdo, schema, privilégios ou auditoria não comprovados.", file=sys.stderr)
        sys.exit(1)
