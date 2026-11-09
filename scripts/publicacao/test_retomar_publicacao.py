import copy
import unittest
from retomar_publicacao import validar_registro, REVISAO, IMAGEM, PENDENTES


class RetomadaTest(unittest.TestCase):
    def test_so_aceita_parada_exata_antes_de_isolar(self):
        r = dict(revisao=REVISAO, etapa="preservar", concluido=False, rollback=None,
                 agendaEquipeAntes=True, imagemAnterior=IMAGEM, backupAnterior="backup",
                 composeAnterior=["compose"], migracoesPendentes=PENDENTES, backupAnteriorPreservado=True)
        validar_registro(r)
        for campo, valor in [("etapa", "isolar_escritores"), ("etapa", "migracao_producao"),
                             ("concluido", True), ("imagemAnterior", "outra"), ("revisao", "outra"),
                             ("rollback", False), ("migracoesPendentes", []), ("servicosParados", []),
                             ("agendaEquipeAntes", False), ("backupAnteriorPreservado", False)]:
            with self.subTest(campo=campo, valor=valor), self.assertRaises(RuntimeError):
                validar_registro({**copy.deepcopy(r), campo: valor})
        for campo in r:
            parcial = dict(r)
            del parcial[campo]
            with self.assertRaises(RuntimeError):
                validar_registro(parcial)


if __name__ == "__main__":
    unittest.main()
