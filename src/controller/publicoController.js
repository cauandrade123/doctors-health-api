import { Router } from 'express';
import { assincrono } from '../middlewares/erros.js';
import { ErroHttp } from '../utils/erroHttp.js';
import * as validar from '../utils/validacao.js';

/**
 * Login do painel e fluxo de agendamento do paciente, que não exige conta.
 * Por não haver autenticação, toda rota daqui declara o seu limite de requisições.
 */
export function criarRotasPublicas({ repositorio, auth, limites }) {
    const rotas = Router();

    rotas.post('/login', limites.login, assincrono(async (req, res) => {
        const email = validar.texto(req.body.email, 'email', { max: 254 });
        const senha = validar.senha(req.body.senha);

        res.json({ token: await auth.login(email, senha) });
    }));

    rotas.post('/verificar-cpf', limites.publico, assincrono(async (req, res) => {
        const cpf = validar.cpfParaBusca(req.body.cpf);
        const idPaciente = await repositorio.buscarIdPacientePorCpf(cpf);

        res.json({ existe: idPaciente !== null });
    }));

    rotas.post('/verificar-telefone', limites.publico, assincrono(async (req, res) => {
        const telefone = validar.telefoneParaBusca(req.body.telefone);

        res.json({ existe: await repositorio.telefoneExiste(telefone) });
    }));

    rotas.get('/Id-do-paciente/:cpf', limites.publico, assincrono(async (req, res) => {
        const cpf = validar.cpfParaBusca(req.params.cpf);
        const idPaciente = await repositorio.buscarIdPacientePorCpf(cpf);

        if (idPaciente === null) return res.json({ message: 'Paciente não encontrado.' });
        res.json({ id_paciente: idPaciente });
    }));

    rotas.get('/verificarconsulta/:cpf', limites.publico, assincrono(async (req, res) => {
        const cpf = validar.cpfParaBusca(req.params.cpf);
        const consulta = await repositorio.buscarConsultaAbertaPorCpf(cpf);

        if (!consulta) {
            return res.json({ message: 'Nenhuma consulta encontrada para este CPF.', hasConsulta: false });
        }
        res.json({ message: 'Paciente já possui uma consulta agendada.', consulta, hasConsulta: true });
    }));

    rotas.post('/horarios-ocupados', limites.publico, assincrono(async (req, res) => {
        const dia = validar.data(req.body.data, 'data');
        const horarios = await repositorio.listarHorariosOcupados(dia);

        // Contrato esperado pelo frontend: lista vazia, ou as linhas dentro de um array.
        res.json({ horariosOcupados: horarios.length > 0 ? [horarios] : [] });
    }));

    rotas.post('/autocadastro', limites.cadastro, assincrono(async (req, res) => {
        const paciente = {
            nome: validar.texto(req.body.nome, 'nome', { max: 150 }),
            nascimento: validar.nascimentoDeAdulto(req.body.nascimento),
            rg: validar.texto(req.body.rg, 'rg', { max: 20 }),
            cpf: validar.cpfNovo(req.body.cpf),
            telefone: validar.telefoneNovo(req.body.telefone),
            email: validar.email(req.body.email),
        };

        const id = await repositorio.inserirPaciente(paciente);
        if (id === null) throw new ErroHttp(409, 'CPF ou telefone já cadastrado.');

        res.json({
            confirmação: 'Consulta agendada!',
            pacienteId: id,
            token: auth.emitirToken('paciente', id),
        });
    }));

    rotas.post('/agenda', limites.cadastro, assincrono(async (req, res) => {
        const dia = validar.data(req.body.dia, 'dia');
        const hora = validar.hora(req.body.hora, 'hora');

        const id = await repositorio.reservarHorario(`${dia} ${hora}`);
        if (id === null) throw new ErroHttp(409, 'Horário indisponível.');

        res.json({ agendaId: id });
    }));

    rotas.post('/consultas', limites.cadastro, assincrono(async (req, res) => {
        const id = await repositorio.criarConsulta({
            idAgenda: validar.inteiro(req.body.id_agenda, 'id_agenda'),
            idPaciente: validar.inteiro(req.body.id_paciente, 'id_paciente'),
            tratamento: validar.texto(req.body.tratamento, 'tratamento', { max: 2000, obrigatorio: false }),
            condicao: validar.texto(req.body.condicao, 'condicao', { max: 2000, obrigatorio: false }),
            medicacao: validar.texto(req.body.medicacao, 'medicacao', { max: 2000, obrigatorio: false }),
            preco: validar.decimal(req.body.preco, 'preco', { obrigatorio: false }),
            metodo: validar.texto(req.body.metodo, 'metodo', { max: 30, obrigatorio: false }),
        });
        if (id === null) {
            throw new ErroHttp(409, 'Não foi possível agendar: horário indisponível ou paciente já possui consulta em aberto.');
        }

        res.json({ consultaId: id });
    }));

    rotas.post('/cadastrado', limites.cadastro, assincrono(async (req, res) => {
        const id = await repositorio.registrarCadastrado({
            idPaciente: validar.inteiro(req.body.id_paciente, 'id_paciente'),
            metodo: validar.texto(req.body.metodo, 'metodo', { max: 30, obrigatorio: false }),
            idAgenda: validar.inteiro(req.body.id_agenda, 'id_agenda'),
        });

        res.json({ confirmação: 'Consulta agendada!', pacienteId: id });
    }));

    return rotas;
}
