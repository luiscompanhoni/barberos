import copy
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import liberar_cache_build as cache


class CacheBuildTest(unittest.TestCase):
    def setUp(self):
        self.imagem = "sha256:" + "a" * 64
        self.comandos = []
        self.app = {"Image": self.imagem, "State": {"Health": {"Status": "healthy"}}}
        self.retrato = {"imagens": {"imagem antiga:rollback"}, "containers": {"app imagem"},
                        "volumes": {"banco"}, "arquivos": {"backup.sql.gz": "hash", ".env": "hash-config"}}

    def executar(self, args):
        self.comandos.append(args)
        if args[:2] == ["docker", "ps"]:
            return "container-atual\n"
        if args[:2] == ["docker", "inspect"]:
            return json.dumps([self.app])
        return ""

    def chamar(self, depois):
        with patch.object(cache, "executar", side_effect=self.executar), \
                patch.object(cache, "preservar", side_effect=[self.retrato, depois]), \
                patch.object(cache.shutil, "disk_usage", side_effect=[SimpleNamespace(free=5), SimpleNamespace(free=20)]):
            return cache.liberar(Path("/opt/barberos"), "barberos", self.imagem)

    def test_libera_apenas_cache_antigo_com_reserva_e_preserva_dados(self):
        depois = copy.deepcopy(self.retrato)
        depois["imagens"].add("outra imagem criada simultaneamente")
        r = self.chamar(depois)
        self.assertTrue(r["backupsConfiguracaoPreservados"])
        self.assertEqual(r["escopoCache"], "unused")
        self.assertEqual(r["livreDepois"], 20)
        mutacoes = [c for c in self.comandos if "prune" in c]
        self.assertEqual(mutacoes, [["docker", "builder", "prune", "--all", "--force", "--filter", "until=48h", "--keep-storage", "6GB"]])

    def test_imagem_ou_saude_diferente_impede_limpeza(self):
        for alteracao in ({"Image": "outra"}, {"State": {"Health": {"Status": "unhealthy"}}}):
            with self.subTest(alteracao=alteracao):
                self.setUp()
                self.app.update(alteracao)
                with self.assertRaisesRegex(RuntimeError, "cache preservado"):
                    self.chamar(copy.deepcopy(self.retrato))
                self.assertFalse(any("prune" in c for c in self.comandos))

    def test_imagens_containers_volumes_e_backups_removidos_bloqueiam_publicacao(self):
        for campo in self.retrato:
            with self.subTest(campo=campo):
                depois = copy.deepcopy(self.retrato)
                depois[campo].clear()
                with self.assertRaisesRegex(RuntimeError, "bloqueada"):
                    self.chamar(depois)

    def test_backup_ou_configuracao_modificados_bloqueiam_publicacao(self):
        for caminho in self.retrato["arquivos"]:
            with self.subTest(caminho=caminho):
                depois = copy.deepcopy(self.retrato)
                depois["arquivos"][caminho] = "outro-hash"
                with self.assertRaisesRegex(RuntimeError, "Arquivo preservado mudou"):
                    self.chamar(depois)


if __name__ == "__main__":
    unittest.main()

