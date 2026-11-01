import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("midias", Path(__file__).resolve().parents[2] / "deploy/backup-estudio.py")
midias = importlib.util.module_from_spec(spec)
spec.loader.exec_module(midias)


class BackupEstudioTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.p = Path(self.tmp.name)
        self.media = self.p / "originais"
        self.media.mkdir()
        self.dump = self.p / "banco.sql.gz"
        self.dump.write_bytes(b"dump-sintetico")
        self.nome = "12345678-1234-1234-1234-123456789abc.mp4"
        self.dados = b"video-sintetico" * 10
        (self.media / self.nome).write_bytes(self.dados)
        self.refs = {self.nome: {"arquivo": self.nome, "bytes": len(self.dados),
                                 "sha256": hashlib.sha256(self.dados).hexdigest()}}
        self.arquivo = self.p / "midias.tar.gz"

    def criar(self):
        midias.criar(self.dump, self.refs, self.arquivo, self.media)

    def test_restauracao_reconstitui_arquivo_exato_e_ignora_orfaos(self):
        (self.media / "nao-referenciado.part").write_text("nao-copiar")
        self.criar()
        self.assertEqual(midias.restaurar(self.dump, self.refs, self.arquivo, self.p / "restauradas"), 1)
        self.assertEqual((self.p / "restauradas" / self.nome).read_bytes(), self.dados)
        self.assertEqual(list((self.p / "restauradas").iterdir()), [self.p / "restauradas" / self.nome])
        self.assertEqual(self.arquivo.stat().st_mode & 0o777, 0o600)

    def test_nao_sobrescreve_backup_ou_destino_existente(self):
        self.criar()
        antes = self.arquivo.read_bytes()
        with self.assertRaises(FileExistsError):
            self.criar()
        self.assertEqual(self.arquivo.read_bytes(), antes)
        with self.assertRaises(FileExistsError):
            midias.restaurar(self.dump, self.refs, self.arquivo, self.media)
        self.assertEqual((self.media / self.nome).read_bytes(), self.dados)

    def test_arquivo_ausente_ou_hash_divergente_impede_copia(self):
        (self.media / self.nome).unlink()
        with self.assertRaises(FileNotFoundError):
            self.criar()
        (self.media / self.nome).write_bytes(b"x" * len(self.dados))
        with self.assertRaises(ValueError):
            self.criar()
        self.assertFalse(self.arquivo.exists())

    def test_link_na_origem_nao_le_dados_fora_do_volume(self):
        (self.media / self.nome).unlink()
        (self.media / self.nome).symlink_to(self.dump)
        with self.assertRaises(OSError):
            self.criar()
        self.assertFalse(self.arquivo.exists())

    def test_par_de_banco_errado_ou_referencia_ausente_e_recusado(self):
        self.criar()
        self.dump.write_bytes(b"outro-dump")
        with self.assertRaises(ValueError):
            midias.restaurar(self.dump, self.refs, self.arquivo, self.p / "outro")
        with self.assertRaises(ValueError):
            midias.restaurar(self.dump, {}, self.arquivo, self.p / "sem-ref")

    def test_arquivo_adulterado_travessia_e_links_sao_recusados(self):
        for i, nome in enumerate([self.nome, "../fora.mp4", "link"]):
            with tarfile.open(self.arquivo, "w:gz") as tar:
                item = tarfile.TarInfo(nome)
                item.size = len(self.dados)
                if nome == "link":
                    item.type, item.linkname = tarfile.SYMTYPE, "../fora.mp4"
                    tar.addfile(item)
                else:
                    tar.addfile(item, io.BytesIO(b"x" * len(self.dados)))
            with self.assertRaises(ValueError):
                midias.restaurar(self.dump, self.refs, self.arquivo, self.p / str(i))
        self.assertFalse((self.p / "fora.mp4").exists())
        with tarfile.open(self.arquivo, "w:gz") as tar:
            for _ in range(2):
                item = tarfile.TarInfo("manifesto.json")
                item.size = 4
                tar.addfile(item, io.BytesIO(b"null"))
        with self.assertRaises(ValueError):
            midias.restaurar(self.dump, {}, self.arquivo, self.p / "duplicado")

    def test_sem_volume_configurado_so_aceita_banco_sem_midias(self):
        with patch.object(midias, "referencias", return_value=self.refs):
            with self.assertRaises(ValueError):
                midias.main(["exigir-vazio", str(self.dump), "banco-teste", "-"])
        with patch.object(midias, "referencias", return_value={}):
            midias.main(["exigir-vazio", str(self.dump), "banco-teste", "-"])

    def test_referencias_invalidas_do_banco_sao_recusadas(self):
        linha = {"arquivo": "../privado", "bytes": 20, "sha256": None}
        with patch.object(midias, "consulta", side_effect=["2", json.dumps([linha])]):
            with self.assertRaises(ValueError):
                midias.referencias("banco-teste")
