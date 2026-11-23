import json
import os
import subprocess
import sys
import unittest
from itertools import combinations
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).parent))
import deploy_vps_comum as comum


class MigracoesPublicacaoTest(unittest.TestCase):
    def test_previa_20261123_aceita_qualquer_subconjunto_nominal(self):
        nomes = (
            "20261121010000_jornadas_leonel",
            "20261122010000_instagram_direct",
            "20261122020000_oferta_dezembro",
            "20261122030000_recuperacao_entrada_instagram",
        )
        for quantidade in range(len(nomes) + 1):
            for subconjunto in combinations(nomes, quantidade):
                with self.subTest(pendentes=subconjunto):
                    comum.exigir_migracoes_da_publicacao(subconjunto)
        for extra in (*[nome + "_extra" for nome in nomes], "20261122040000_nao_revisada"):
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "fora do escopo"):
                comum.exigir_migracoes_da_publicacao([*nomes, extra])

    def test_prazo_de_lock_e_adicionado_ao_ambiente_do_prisma(self):
        fonte = "postgresql://teste:fixture@db:5432/barberos?schema=operacao&options=-c%20lock_timeout%3D120s%20-c%20statement_timeout%3D20s"
        filho = ["node", "-e", "console.log(JSON.stringify(process.env.DATABASE_URL));process.exitCode=7"]
        r = subprocess.run([*comum.COMANDO_MIGRACAO[:3], *filho], env={**os.environ, "DATABASE_URL": fonte},
                           capture_output=True, text=True, timeout=10)
        self.assertEqual(r.returncode, 7)
        url = urlsplit(json.loads(r.stdout))
        self.assertEqual(url.netloc, "teste:fixture@db:5432")
        self.assertEqual(url.path, "/barberos")
        self.assertEqual(parse_qs(url.query), {
            "schema": ["operacao"],
            "options": ["-c lock_timeout=120s -c statement_timeout=20s -c lock_timeout=5s"],
        })
