import { Router } from 'express';
import { assincrono } from '../middlewares/erros.js';
import { ErroHttp } from '../utils/erroHttp.js';
import * as validar from '../utils/validacao.js';

/** Rotas do paciente autenticado (token emitido em /autocadastro). */
export function criarRotasDoPaciente({ repositorio, email, autenticacao, limites }) {
    const rotas = Router();

    rotas.get('/MinhasConsultas', autenticacao.exigirPaciente, assincrono(async (req, res) => {
        res.json(await repositorio.listarConsultasDoPaciente(req.usuario.id));
    }));

    // O destinatário e o nome vêm do cadastro do paciente autenticado, nunca do corpo da
    // requisição: assim a rota não pode ser usada para enviar e-mail a terceiros.
    rotas.post('/enviar', autenticacao.exigirPaciente, limites.emailPaciente, assincrono(async (req, res) => {
        const data = validar.data(req.body.data, 'data');
        const horario = validar.hora(req.body.horario, 'horario');

        const paciente = await repositorio.buscarContatoDoPaciente(req.usuario.id);
        if (!paciente?.email) throw new ErroHttp(404, 'Paciente sem e-mail cadastrado.');

        await email.enviarConfirmacao({ nome: paciente.nome, email: paciente.email, data, horario });
        res.json({ mensagem: 'Email enviado com sucesso.' });
    }));

    return rotas;
}
