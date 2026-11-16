import { Router } from 'express';
import { assincrono } from '../middlewares/erros.js';
import { ErroHttp } from '../utils/erroHttp.js';
import * as validar from '../utils/validacao.js';

const HOST_DA_TELECONSULTA = 'meet.jit.si';

/** Aceita apenas links https da sala de teleconsulta; retorna a URL normalizada. */
function validarLinkDaConsulta(valor) {
    const link = validar.texto(valor, 'link', { max: 500 });
    const url = URL.canParse(link) ? new URL(link) : null;
    if (url?.protocol !== 'https:' || url.hostname !== HOST_DA_TELECONSULTA || url.username || url.password) {
        throw new ErroHttp(400, "O campo 'link' é inválido.");
    }
    return url.href;
}

/** Painel administrativo. Todas as rotas deste router exigem token de administrador. */
export function criarRotasAdministrativas({ repositorio, email, autenticacao, limites }) {
    const rotas = Router();
    rotas.use(autenticacao.exigirAdmin);

    // ---- Consultas ----

    rotas.get('/consultasPassadas', assincrono(async (req, res) => {
        res.json(await repositorio.listarConsultasPorSituacao(true));
    }));

    rotas.get('/consultasFuturas', assincrono(async (req, res) => {
        res.json(await repositorio.listarConsultasPorSituacao(false));
    }));

    rotas.get('/consultasCpf/:cpf', assincrono(async (req, res) => {
        const prefixo = validar.cpfParaBusca(req.params.cpf);
        res.json(await repositorio.listarConsultasPorPrefixoDeCpf(prefixo));
    }));

    rotas.get('/agenda/consultas', assincrono(async (req, res) => {
        res.json(await repositorio.listarTodasAsConsultas());
    }));

    rotas.put('/consultas/:id', assincrono(async (req, res) => {
        const id = validar.inteiro(req.params.id, 'id');
        const alteradas = await repositorio.atualizarConsulta(id, {
            tratamento: validar.texto(req.body.tratamento, 'tratamento', { max: 2000, obrigatorio: false }),
            condicao: validar.texto(req.body.condicao, 'condicao', { max: 2000, obrigatorio: false }),
            medicacao: validar.texto(req.body.medicacao, 'medicacao', { max: 2000, obrigatorio: false }),
            preco: validar.decimal(req.body.preco, 'preco', { obrigatorio: false }),
        });
        if (alteradas === 0) throw new ErroHttp(404, 'Nenhum registro encontrado.');

        res.send('Consulta editada!');
    }));

    rotas.get('/consultaFinalizar/:cpf', assincrono(async (req, res) => {
        const cpf = validar.cpfParaBusca(req.params.cpf);
        res.json(await repositorio.listarSituacaoDasConsultasPorCpf(cpf));
    }));

    rotas.put('/finalizarConsulta/:cpf', assincrono(async (req, res) => {
        const cpf = validar.cpfParaBusca(req.params.cpf);
        const finalizadas = await repositorio.finalizarConsultasPorCpf(cpf);
        if (finalizadas === 0) throw new ErroHttp(404, 'Nenhuma consulta em aberto para este CPF.');

        res.json({ sucesso: 'Finalizada com sucesso' });
    }));

    // ---- Agenda ----

    rotas.get('/pegardata', assincrono(async (req, res) => {
        res.json(await repositorio.listarAgenda());
    }));

    rotas.get('/verfificarestadoFinalizadaAgenda/:id_agenda', assincrono(async (req, res) => {
        const idAgenda = validar.inteiro(req.params.id_agenda, 'id_agenda');
        res.json(await repositorio.buscarEstadoDaAgenda(idAgenda));
    }));

    rotas.delete('/remover/:id_agenda', assincrono(async (req, res) => {
        const idAgenda = validar.inteiro(req.params.id_agenda, 'id_agenda');
        const resultado = await repositorio.removerAgenda(idAgenda);

        if (resultado === 'inexistente') throw new ErroHttp(404, 'Agenda não encontrada.');
        if (resultado === 'em_uso') throw new ErroHttp(409, 'A agenda possui consulta vinculada e não pode ser removida.');
        res.json({ sucesso: 'Agenda removida.' });
    }));

    // ---- Financeiro ----

    rotas.get('/puxarfinanceiro/:ano', assincrono(async (req, res) => {
        const ano = validar.inteiro(req.params.ano, 'ano', { min: 1900, max: 2100 });
        res.json(await repositorio.listarFaturamentoMensal(ano));
    }));

    rotas.post('/financeiro', assincrono(async (req, res) => {
        const mes = validar.inteiro(req.body.mes, 'mes', { min: 1, max: 12 });
        const ano = validar.inteiro(req.body.ano, 'ano', { min: 1900, max: 2100 });
        res.json(await repositorio.listarFaturamentoDoMes(mes, ano));
    }));

    // ---- E-mail ----

    rotas.post('/enviar-call', limites.emailAdmin, assincrono(async (req, res) => {
        await email.enviarLinkDaConsulta({
            nome: validar.texto(req.body.nome, 'nome', { max: 150 }),
            email: validar.email(req.body.email),
            link: validarLinkDaConsulta(req.body.link),
        });
        res.json({ mensagem: 'Email enviado com sucesso.' });
    }));

    return rotas;
}
