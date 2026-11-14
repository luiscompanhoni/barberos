import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import limpar_imagens_antigas as limpeza

A, B, C, D, E = ("a" * 40, "b" * 40, "c" * 40, "d" * 40, "e" * 40)


def img(repo, tag, ident, criada, tamanho=1000):
    return {"repo": repo, "tag": tag, "id": "sha256:" + ident * 64, "criada": criada, "bytes": tamanho}


# Publicações em ordem: E (mais antiga) ... A (mais nova, falhou e não está no ar); C está no ar.
IMAGENS = [
    img("barberos-app", A, "1", "2026-11-14T10:00:00Z"), img("barberos-video-worker", A, "2", "2026-11-14T10:00:00Z"),
    img("barberos-app", B, "3", "2026-11-13T10:00:00Z"),
    img("barberos-app", C, "4", "2026-11-12T10:00:00Z"), img("barberos-video-worker", C, "5", "2026-11-12T10:00:00Z"),
    img("barberos-app", D, "6", "2026-11-11T10:00:00Z"), img("barberos-video-worker", D, "7", "2026-11-11T10:00:00Z"),
    img("barberos-app", E, "8", "2026-11-10T10:00:00Z"),
    img("barberos-app", "antes-" + C, "6", "2026-11-11T10:00:00Z"),
    img("barberos-app", "antes-" + D, "8", "2026-11-10T10:00:00Z"),
    img("barberos-atendimento", E, "9", "2026-11-10T10:00:00Z"),
    img("barberos-app", "latest", "f", "2026-11-01T10:00:00Z"),
]


class EscolhaTest(unittest.TestCase):
    def plano(self, em_uso=("sha256:" + "4" * 64, "sha256:" + "5" * 64)):
        p = limpeza.escolher(IMAGENS, set(em_uso), C)
        return p, {(i["repo"], i["tag"]) for i in p["remover"]}

    def test_mantem_no_ar_duas_anteriores_e_ultima_copia_de_retorno(self):
        p, sai = self.plano()
        self.assertEqual(p["manterCommits"], sorted([A, B, C]))
        self.assertEqual(sai, {("barberos-app", D), ("barberos-video-worker", D), ("barberos-app", E), ("barberos-app", "antes-" + D)})

    def test_nunca_toca_outros_servicos_nem_tags_fora_do_padrao(self):
        _, sai = self.plano()
        self.assertNotIn(("barberos-atendimento", E), sai)
        self.assertNotIn(("barberos-app", "latest"), sai)

    def test_imagem_em_uso_por_container_parado_fica(self):
        _, sai = self.plano(em_uso=("sha256:" + "4" * 64, "sha256:" + "8" * 64))
        self.assertNotIn(("barberos-app", E), sai)
        self.assertNotIn(("barberos-app", "antes-" + D), sai)

    def test_tag_que_divide_id_com_mantida_nao_conta_como_espaco(self):
        p, _ = self.plano()
        por = {(i["repo"], i["tag"]): i["liberaEspaco"] for i in p["remover"]}
        # O app de D tem o mesmo id da cópia antes-C, que fica: tirar a tag não libera disco.
        self.assertFalse(por[("barberos-app", D)])
        self.assertTrue(por[("barberos-video-worker", D)])


class LimparTest(unittest.TestCase):
    def test_versao_diferente_nao_remove_nada(self):
        app = {"Image": "sha256:" + "0" * 64, "State": {"Health": {"Status": "healthy"}}}
        chamadas = []

        def falso(args):
            chamadas.append(args)
            if args[:2] == ["docker", "ps"]:
                return "id-app\n"
            if args[:2] == ["docker", "inspect"]:
                import json
                return json.dumps([app])
            raise AssertionError("não deveria chegar aqui")
        with patch.object(limpeza, "executar", falso):
            with self.assertRaises(RuntimeError):
                limpeza.limpar(Path("/opt/barberos"), "barberos", "sha256:" + "a" * 64, remover=True)
        self.assertFalse(any(a[:3] == ["docker", "image", "rm"] for a in chamadas))


if __name__ == "__main__":
    unittest.main()
