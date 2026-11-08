import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


BASH = shutil.which("bash")
if os.name == "nt":
    git_bash = Path("C:/Program Files/Git/bin/bash.exe")
    if git_bash.is_file():
        BASH = str(git_bash)
SCRIPT = Path(__file__).with_name("backup.sh")
if not SCRIPT.is_file():
    SCRIPT = Path(__file__).resolve().parents[2] / "deploy/backup.sh"


@unittest.skipUnless(BASH, "Bash necessário para executar o script real de backup sem banco.")
class BackupInicioTest(unittest.TestCase):
    def executar_inicio(self, quantidade, *, midias=True, antigo=False, sufixo_correto=True):
        with tempfile.TemporaryDirectory(prefix="backup-inicio-fixture-") as tmp:
            base = Path(tmp)
            arquivos = base / "backups"
            arquivos.mkdir()
            sufixo = ".studio.tar.gz" if midias else ".sql.gz"
            if not sufixo_correto:
                sufixo = ".ignorado"
            for i in range(quantidade):
                p = arquivos / ("barberos-20261108-120000-" + str(i).zfill(6) + sufixo)
                p.write_bytes(b"fixture somente para detectar recencia")
                if antigo:
                    data = time.time() - 3 * 86400
                    os.utime(p, (data, data))
            boot = base / "shell-carregado"
            sentinela = base / "tentou-consultar-pg"
            ambiente = base / "shell-fixture.sh"
            ambiente.write_text('printf loaded > "$TESTE_BOOT"\n'
                                'date() { printf "1200\\n"; }\n'
                                'sleep() { exit 0; }\n'
                                'pg_isready() { printf tentou > "$TESTE_SENTINELA"; return 1; }\n', encoding="utf8", newline="\n")
            env = {k: v for k, v in os.environ.items() if k.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"}}
            env.update(BASH_ENV=ambiente.as_posix(), TESTE_BOOT=boot.as_posix(), TESTE_SENTINELA=sentinela.as_posix(),
                       BACKUP_PASTA=arquivos.as_posix(), BACKUP_ESTUDIO_MEDIA="/fixture-sem-volume" if midias else "",
                       BACKUP_HORA="0300", BACKUP_S3_BUCKET="", PGDATABASE="barberos_teste_fixture_sem_pg")
            r = subprocess.run([BASH, "--noprofile", "--norc", SCRIPT.as_posix(), "loop"], env=env,
                               capture_output=True, timeout=15)
            self.assertEqual(r.returncode, 0, r.stderr.decode(errors="replace"))
            self.assertTrue(boot.is_file(), "Os stubs devem estar ativos antes do script.")
            return sentinela.exists()

    def test_35_backups_recentes_impedem_diario_na_primeira_subida(self):
        for midias in (False, True):
            with self.subTest(midias=midias):
                self.assertFalse(self.executar_inicio(35, midias=midias))

    def test_volume_grande_de_nomes_recentes_nao_inicia_diario_por_sigpipe(self):
        self.assertFalse(self.executar_inicio(2048))

    def test_ausencia_de_backup_recente_solicita_backup_inicial_sem_tocar_banco(self):
        self.assertTrue(self.executar_inicio(0))
        self.assertTrue(self.executar_inicio(35, antigo=True))

    def test_outros_arquivos_recentes_nao_satisfazem_o_padrao_de_backup(self):
        self.assertTrue(self.executar_inicio(35, sufixo_correto=False))


if __name__ == "__main__":
    unittest.main()
