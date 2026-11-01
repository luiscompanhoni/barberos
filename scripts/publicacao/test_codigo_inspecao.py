import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("inspecao", Path(__file__).with_name("inspecionar-vps.py"))
modulo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(modulo)


class CodigoInspecaoTest(unittest.TestCase):
    def test_hashes_sem_arquivos_privados_dados_ou_links(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            (base / "src").mkdir()
            (base / "src/rota.ts").write_text("conteudo do codigo")
            (base / ".env").write_text("sentinela-privada")
            (base / "src/.env.json").write_text("sentinela-privada")
            (base / "src/link.ts").symlink_to(base / ".env")
            (base / "src/node_modules").mkdir()
            (base / "src/node_modules/ignorar.ts").write_text("dependencia")
            (base / "src/atalho").symlink_to(base / "src/node_modules", target_is_directory=True)
            (base / "backups").mkdir()
            (base / "backups/privado.json").write_text("sentinela-privada")
            self.assertEqual(modulo.arquivos_codigo(base), [{"caminho": "src/rota.ts", "sha256": hashlib.sha256(b"conteudo do codigo").hexdigest()}])


if __name__ == "__main__":
    unittest.main()
