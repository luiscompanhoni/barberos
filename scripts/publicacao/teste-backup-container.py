"""Ensaio com banco/mídias sintéticos, container exclusivo e nenhuma porta publicada.

Pré-requisito: docker build -t barberos-backup-validacao:teste -f deploy/backup.Dockerfile deploy
Uso: python3 scripts/publicacao/teste-backup-container.py barberos-backup-validacao:teste
"""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import uuid


def executar(args, *, entrada=None, falha=False):
    r = subprocess.run(args, input=entrada, capture_output=True, text=True, timeout=120)
    if (r.returncode != 0) != falha:
        raise RuntimeError("Resultado inesperado no ensaio sintético: " + r.stdout[-1500:] + r.stderr[-1500:])
    return r.stdout


def main(imagem):
    if not re.fullmatch(r"barberos-backup-validacao:[a-zA-Z0-9_.-]+", imagem):
        raise ValueError("Informe apenas a imagem local de validação do backup.")
    nome = "barberos-backup-teste-" + uuid.uuid4().hex[:12]
    usuario = f"{os.getuid()}:{os.getgid()}"
    backup = ["docker", "exec", "--user", usuario, nome, "backup.sh"]
    with tempfile.TemporaryDirectory(prefix="barberos-backup-teste-") as d:
        p = Path(d)
        midias, backups = p / "midias", p / "backups"
        midias.mkdir()
        backups.mkdir()
        arquivo = "12345678-1234-1234-1234-123456789abc.mp4"
        dados = b"midia-sintetica" * 10
        (midias / arquivo).write_bytes(dados)
        digest = hashlib.sha256(dados).hexdigest()
        try:
            executar(["docker", "run", "-d", "--name", nome, "--network", "none",
                      "--label", "barberos.finalidade=teste-backup", "--memory", "512m",
                      "--tmpfs", "/worker/jobs:rw,nosuid,size=1m,uid=1000,gid=1000,mode=0700",
                      "--mount", f"type=bind,src={midias},dst=/media-estudio,readonly",
                      "--mount", f"type=bind,src={backups},dst=/backups",
                      "-e", "POSTGRES_PASSWORD=senha-exclusiva-fixture-descartavel", "-e", "POSTGRES_DB=backup_fixture",
                      "-e", "PGHOST=/var/run/postgresql", "-e", "PGUSER=postgres", "-e", "PGDATABASE=backup_fixture",
                      "-e", "BACKUP_ESTUDIO_MEDIA=/media-estudio",
                      "--entrypoint", "docker-entrypoint.sh", imagem, "postgres"])
            for _ in range(30):
                if subprocess.run(["docker", "exec", nome, "pg_isready", "-h", "127.0.0.1", "-q"], capture_output=True).returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Banco sintético não ficou pronto.")
            sql = f"""
CREATE TABLE clientes(id int); INSERT INTO clientes VALUES (1);
CREATE TABLE agendamentos(id int); INSERT INTO agendamentos VALUES (1);
CREATE TABLE _prisma_migrations(migration_name text, finished_at timestamptz);
INSERT INTO _prisma_migrations VALUES ('fixture_estudio', now());
CREATE TABLE estudio_clipes(arquivo text, bytes int);
CREATE TABLE estudio_versoes(arquivo text, bytes int, sha256 text);
INSERT INTO estudio_versoes VALUES ('{arquivo}', {len(dados)}, '{digest}');
CREATE TABLE backups(id text, tipo text, arquivo text, bytes bigint, restaurado bool,
conferencia text, "foraDoServidor" bool, erro text);
CREATE DATABASE barberos_teste_restauracao;
"""
            executar(["docker", "exec", "-i", nome, "psql", "-X", "-v", "ON_ERROR_STOP=1"], entrada=sql)
            executar(backup + ["agora"])
            dump = next(backups.glob("*.sql.gz"))
            par = backups / (dump.name.removesuffix(".sql.gz") + ".studio.tar.gz")
            assert par.is_file()
            consulta = ["docker", "exec", nome, "psql", "-X", "-At", "-c"]
            assert executar(consulta + ["SELECT restaurado AND erro IS NULL FROM backups"]).strip() == "t"
            executar(backup + ["verificar", "/backups/" + dump.name])
            executar(backup + ["restaurar", "/backups/" + dump.name])
            destino = backups / (dump.name.removesuffix(".sql.gz") + "-midias-restauradas")
            assert (destino / arquivo).read_bytes() == dados
            executar(backup + ["restaurar", "/backups/" + dump.name], falha=True)
            assert (destino / arquivo).read_bytes() == dados
            print("OK: dump e mídia restaurados; destinos existentes preservados.", flush=True)

            antigo = backups / "barberos-20000101-0300.sql.gz"
            antigo.write_bytes(dump.read_bytes())
            os.utime(antigo, (1, 1))
            (midias / arquivo).unlink()
            executar(backup + ["agora"], falha=True)
            assert antigo.exists(), "Falha de backup não pode remover backups anteriores."
            executar(["docker", "exec", "--user", usuario, "-e", "BACKUP_ESTUDIO_MEDIA=", nome, "backup.sh", "agora"], falha=True)
            assert executar(consulta + ["SELECT count(*) FROM backups WHERE NOT restaurado AND erro IS NOT NULL"]).strip() == "2"
            assert executar(consulta + ["SELECT count(*) FROM pg_database WHERE datname='barberos_teste_restauracao'"]).strip() == "1"
            print("OK: mídia ausente/volume omitido bloqueiam sucesso; backup e banco preexistentes preservados.", flush=True)

            codigo = """
from pathlib import Path
import errno
try:
    Path('/worker/jobs/limite').write_bytes(b'x' * (2 * 1024 * 1024))
except OSError as e:
    assert e.errno == errno.ENOSPC
else:
    raise AssertionError('tmpfs sem limite')
"""
            executar(["docker", "exec", "--user", "1000", nome, "python3", "-c", codigo])
            executar(["docker", "restart", nome])
            executar(["docker", "exec", "--user", "1000", nome, "python3", "-c",
                      "from pathlib import Path; assert not list(Path('/worker/jobs').iterdir())"])
            print("OK: tmpfs limita escrita e descarta temporários no reinício (ensaio de 1 MiB).", flush=True)
        finally:
            subprocess.run(["docker", "rm", "-fv", nome], capture_output=True)


if __name__ == "__main__":
    main(sys.argv[1])
