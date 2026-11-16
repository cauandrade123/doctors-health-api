// Testes de integração contra um MySQL real: exercitam o fluxo que o frontend executa,
// as queries de verdade e as garantias de concorrência.
//
// Só rodam quando TEST_MYSQL_DATABASE está definida (veja o README). O banco indicado
// é APAGADO e recriado a partir de test/schema.sql; por segurança, o nome precisa
// terminar em "_teste".
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import mysql from 'mysql2/promise';
import { criarPool } from '../src/database/connection.js';
import { gerarHash } from '../src/utils/senha.js';
import { SEM_LIMITES, subirApi, tokenAdmin } from './apoio.js';

const banco = process.env.TEST_MYSQL_DATABASE;
const credenciais = {
    host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_MYSQL_PORT ?? 3306),
    user: process.env.TEST_MYSQL_USER ?? 'root',
    password: process.env.TEST_MYSQL_PASSWORD ?? '',
};

const ANA = {
    nome: 'Ana Souza', nascimento: '1990-05-20', rg: '12.345.678-9',
    cpf: '529.982.247-25', telefone: '(11) 91234-5678', email: 'ana@exemplo.com',
};
const BRUNO = { ...ANA, nome: 'Bruno Lima', cpf: '111.444.777-35', telefone: '(11) 95555-0000', email: 'bruno@exemplo.com' };

describe('integração com MySQL', { skip: !banco && 'defina TEST_MYSQL_DATABASE para executar' }, () => {
    let pool;
    let api;
    const admin = tokenAdmin();

    before(async () => {
        assert.match(banco, /_teste$/, 'TEST_MYSQL_DATABASE precisa terminar em "_teste"');
        const conexao = await mysql.createConnection({ ...credenciais, multipleStatements: true });
        await conexao.query(`DROP DATABASE IF EXISTS \`${banco}\`; CREATE DATABASE \`${banco}\` CHARACTER SET utf8mb4; USE \`${banco}\`;`);
        await conexao.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
        await conexao.end();

        pool = criarPool({ ...credenciais, database: banco });
        api = await subirApi({ pool, limites: SEM_LIMITES });
    });

    after(async () => {
        await api?.fechar();
        await pool?.end();
    });

    beforeEach(async () => {
        for (const tabela of ['tb_cadastrado', 'consulta', 'tb_agenda', 'tb_auto_cadastro', 'tb_login']) {
            await pool.query(`DELETE FROM ${tabela}`);
        }
    });

    /** Executa as mesmas chamadas, na mesma ordem, da tela de autocadastro do frontend. */
    async function agendarComoPacienteNovo(paciente, dia, hora, metodo = 'Online ') {
        const agenda = await api.pedir('POST', '/agenda', { corpo: { dia, hora } });
        if (agenda.status !== 200) return { agenda }; // o frontend interrompe o fluxo no primeiro erro
        const cadastro = await api.pedir('POST', '/autocadastro', { corpo: paciente });
        const consulta = await api.pedir('POST', '/consultas', {
            corpo: { id_agenda: agenda.corpo.agendaId, tratamento: '', condicao: '', medicao: '', preco: '0', id_paciente: cadastro.corpo.pacienteId, metodo },
        });
        return { agenda, cadastro, consulta };
    }

    test('fluxo completo: paciente agenda, administrador atende e finaliza', async () => {
        // -- paciente novo --
        assert.deepEqual((await api.pedir('POST', '/verificar-cpf', { corpo: { cpf: ANA.cpf } })).corpo, { existe: false });
        assert.deepEqual((await api.pedir('POST', '/verificar-telefone', { corpo: { telefone: ANA.telefone } })).corpo, { existe: false });
        assert.deepEqual((await api.pedir('POST', '/horarios-ocupados', { corpo: { data: '2030-03-15' } })).corpo, { horariosOcupados: [] });

        const { agenda, cadastro, consulta } = await agendarComoPacienteNovo(ANA, '2030-03-15', '14:00');
        assert.equal(agenda.status, 200);
        assert.equal(cadastro.status, 200);
        assert.equal(consulta.status, 200);
        const tokenDaAna = cadastro.corpo.token;

        const envio = await api.pedir('POST', '/enviar', { corpo: { nome: ANA.nome, email: ANA.email, data: '2030-03-15', horario: '14:00' }, token: tokenDaAna });
        assert.equal(envio.status, 200);
        assert.equal(api.transporteEmail.enviados.at(-1).to, ANA.email);

        const minhas = await api.pedir('GET', '/MinhasConsultas', { token: tokenDaAna });
        assert.equal(minhas.corpo.length, 1);
        assert.equal(new Date(minhas.corpo[0].dia_horario).getTime(), new Date(2030, 2, 15, 14, 0).getTime());

        // -- o que as próximas telas do paciente consultam --
        assert.deepEqual((await api.pedir('POST', '/verificar-cpf', { corpo: { cpf: ANA.cpf } })).corpo, { existe: true });
        assert.deepEqual((await api.pedir('POST', '/verificar-telefone', { corpo: { telefone: ANA.telefone } })).corpo, { existe: true });
        assert.deepEqual((await api.pedir('GET', `/Id-do-paciente/${ANA.cpf}`)).corpo, { id_paciente: cadastro.corpo.pacienteId });
        assert.deepEqual((await api.pedir('GET', '/Id-do-paciente/000.000.000-00')).corpo, { message: 'Paciente não encontrado.' });
        const aberta = await api.pedir('GET', `/verificarconsulta/${ANA.cpf}`);
        assert.deepEqual(aberta.corpo, { message: 'Paciente já possui uma consulta agendada.', consulta: { id_consulta: consulta.corpo.consultaId }, hasConsulta: true });
        assert.deepEqual((await api.pedir('POST', '/horarios-ocupados', { corpo: { data: '2030-03-15' } })).corpo, { horariosOcupados: [[{ hora: '14:00:00' }]] });
        assert.deepEqual((await api.pedir('POST', '/horarios-ocupados', { corpo: { data: '2030-03-16' } })).corpo, { horariosOcupados: [] });

        // -- painel --
        await pool.query('INSERT INTO tb_login (email, senha) VALUES (?, ?), (?, ?)', ['legado@clinica.com', 'senha-antiga', 'novo@clinica.com', await gerarHash('senha-nova')]);
        assert.equal((await api.pedir('POST', '/login', { corpo: { email: 'legado@clinica.com', senha: 'senha-antiga' } })).status, 200);
        assert.equal((await api.pedir('POST', '/login', { corpo: { email: 'novo@clinica.com', senha: 'senha-nova' } })).status, 200);
        assert.equal((await api.pedir('POST', '/login', { corpo: { email: 'novo@clinica.com', senha: 'senha-antiga' } })).status, 401);

        const futuras = await api.pedir('GET', '/consultasFuturas', { token: admin });
        assert.equal(futuras.corpo.length, 1);
        const item = futuras.corpo[0];
        assert.deepEqual(Object.keys(item).sort(), ['condicao', 'cpf', 'dia_horario', 'email', 'finalizada', 'id', 'medicacao', 'metodo_consulta', 'nascimento', 'nome', 'preco', 'rg', 'tratamento']);
        assert.deepEqual(
            { id: item.id, nome: item.nome, cpf: item.cpf, rg: item.rg, email: item.email, tratamento: item.tratamento, medicacao: item.medicacao, preco: item.preco, finalizada: item.finalizada, metodo: item.metodo_consulta },
            { id: consulta.corpo.consultaId, nome: ANA.nome, cpf: ANA.cpf, rg: ANA.rg, email: ANA.email, tratamento: '', medicacao: null, preco: 0, finalizada: false, metodo: 'Online' },
        );
        assert.deepEqual((await api.pedir('GET', '/consultasPassadas', { token: admin })).corpo, []);

        assert.equal((await api.pedir('GET', '/consultasCpf/529.___.___-__', { token: admin })).corpo.length, 1);
        assert.equal((await api.pedir('GET', '/consultasCpf/999', { token: admin })).corpo.length, 0);
        assert.equal((await api.pedir('GET', '/agenda/consultas', { token: admin })).corpo.length, 1);

        const edicao = await api.pedir('PUT', `/consultas/${item.id}`, { corpo: { tratamento: 'Repouso', condicao: 'Gripe', medicacao: 'Dipirona', preco: '150.50' }, token: admin });
        assert.deepEqual([edicao.status, edicao.corpo], [200, 'Consulta editada!']);
        // Salvar de novo sem alterar nada ainda encontra o registro (não vira 404).
        assert.equal((await api.pedir('PUT', `/consultas/${item.id}`, { corpo: { tratamento: 'Repouso', condicao: 'Gripe', medicacao: 'Dipirona', preco: '150.50' }, token: admin })).status, 200);
        assert.equal((await api.pedir('PUT', '/consultas/999999', { corpo: { tratamento: 'x', condicao: 'x', medicacao: 'x', preco: 1 }, token: admin })).status, 404);

        assert.deepEqual((await api.pedir('GET', '/puxarfinanceiro/2030', { token: admin })).corpo, [{ mes: 3, valor_arrecadado: 150.5 }]);
        assert.deepEqual((await api.pedir('GET', '/puxarfinanceiro/2029', { token: admin })).corpo, []);
        assert.deepEqual((await api.pedir('POST', '/financeiro', { corpo: { mes: 3, ano: 2030 }, token: admin })).corpo, [{ mes: 3, ano: 2030, valor_total: 150.5 }]);

        const agendaDoPainel = await api.pedir('GET', '/pegardata', { token: admin });
        assert.deepEqual(Object.keys(agendaDoPainel.corpo[0]).sort(), ['dia_horario', 'id_agenda', 'titulo']);
        const estado = await api.pedir('GET', `/verfificarestadoFinalizadaAgenda/${agenda.corpo.agendaId}`, { token: admin });
        assert.equal(estado.corpo[0].finalizada, false);

        assert.deepEqual((await api.pedir('GET', `/consultaFinalizar/${ANA.cpf}`, { token: admin })).corpo, [{ finalizada: false }]);
        assert.deepEqual((await api.pedir('PUT', `/finalizarConsulta/${ANA.cpf}`, { token: admin })).corpo, { sucesso: 'Finalizada com sucesso' });
        assert.deepEqual((await api.pedir('GET', `/consultaFinalizar/${ANA.cpf}`, { token: admin })).corpo, [{ finalizada: true }]);
        assert.equal((await api.pedir('PUT', `/finalizarConsulta/${ANA.cpf}`, { token: admin })).status, 404);

        assert.equal((await api.pedir('GET', '/consultasPassadas', { token: admin })).corpo.length, 1);
        assert.deepEqual((await api.pedir('GET', '/consultasFuturas', { token: admin })).corpo, []);
        assert.deepEqual((await api.pedir('GET', `/verificarconsulta/${ANA.cpf}`)).corpo, { message: 'Nenhuma consulta encontrada para este CPF.', hasConsulta: false });
    });

    test('paciente já cadastrado agenda uma nova consulta depois de finalizar a anterior', async () => {
        const primeira = await agendarComoPacienteNovo(ANA, '2030-03-15', '14:00');
        const idPaciente = primeira.cadastro.corpo.pacienteId;
        const novoHorario = await api.pedir('POST', '/agenda', { corpo: { dia: '2030-04-01', hora: '15:00' } });
        const corpo = { id_agenda: novoHorario.corpo.agendaId, tratamento: '', condicao: '', medicao: '', preco: '0', id_paciente: idPaciente, metodo: 'Presencial' };

        assert.equal((await api.pedir('POST', '/consultas', { corpo })).status, 409, 'já existe consulta em aberto');
        await api.pedir('PUT', `/finalizarConsulta/${ANA.cpf}`, { token: admin });
        assert.equal((await api.pedir('POST', '/consultas', { corpo })).status, 200);

        const registro = await api.pedir('POST', '/cadastrado', { corpo: { id_paciente: idPaciente, metodo: 'Presencial', id_agenda: novoHorario.corpo.agendaId } });
        assert.equal(registro.status, 200);
        assert.equal(registro.corpo['confirmação'], 'Consulta agendada!');
    });

    test('duplicidade: CPF, telefone e horário', async () => {
        await agendarComoPacienteNovo(ANA, '2030-03-15', '14:00');

        assert.equal((await api.pedir('POST', '/autocadastro', { corpo: { ...BRUNO, cpf: ANA.cpf } })).status, 409);
        assert.equal((await api.pedir('POST', '/autocadastro', { corpo: { ...BRUNO, telefone: ANA.telefone } })).status, 409);
        assert.equal((await api.pedir('POST', '/agenda', { corpo: { dia: '2030-03-15', hora: '14:00' } })).status, 409, 'horário com consulta');
        assert.equal((await api.pedir('POST', '/agenda', { corpo: { dia: '2030-03-15', hora: '14:00:00' } })).status, 409, 'mesmo horário com segundos');

        const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM tb_auto_cadastro');
        assert.equal(total, 1);
    });

    test('horário órfão (agendamento que falhou no meio) é reaproveitado em vez de bloquear', async () => {
        const primeira = await api.pedir('POST', '/agenda', { corpo: { dia: '2030-05-02', hora: '16:00' } });
        const segunda = await api.pedir('POST', '/agenda', { corpo: { dia: '2030-05-02', hora: '16:00' } });
        assert.equal(segunda.status, 200);
        assert.equal(segunda.corpo.agendaId, primeira.corpo.agendaId);

        const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM tb_agenda');
        assert.equal(total, 1);

        // Compromisso com título (bloqueio manual da agenda) nunca é reaproveitado.
        await pool.query("INSERT INTO tb_agenda (dia_horario, titulo) VALUES ('2030-05-02 17:00', 'Congresso')");
        assert.equal((await api.pedir('POST', '/agenda', { corpo: { dia: '2030-05-02', hora: '17:00' } })).status, 409);
    });

    test('consulta exige agenda e paciente existentes', async () => {
        const { agenda, cadastro } = await agendarComoPacienteNovo(ANA, '2030-03-15', '14:00');
        const base = { tratamento: '', condicao: '', preco: '0', metodo: 'Online' };
        assert.equal((await api.pedir('POST', '/consultas', { corpo: { ...base, id_agenda: 999999, id_paciente: cadastro.corpo.pacienteId } })).status, 409);
        assert.equal((await api.pedir('POST', '/consultas', { corpo: { ...base, id_agenda: agenda.corpo.agendaId, id_paciente: 999999 } })).status, 409);
    });

    test('concorrência: 12 reservas simultâneas do mesmo horário geram uma única consulta', async () => {
        const pacientes = Array.from({ length: 12 }, (_, i) => ({
            ...ANA, cpf: cpfValido(i), telefone: `(11) 9${String(10000000 + i)}`, email: `p${i}@exemplo.com`,
        }));
        const resultados = await Promise.all(pacientes.map((p) => agendarComoPacienteNovo(p, '2030-06-10', '13:00')));

        // Quem perde a corrida é recusado com 409 ao reservar o horário ou ao criar a consulta,
        // conforme o instante em que chega; em nenhum caso há erro 5xx ou segunda consulta.
        const desfechos = resultados.map((r) => r.consulta?.status ?? r.agenda.status).sort();
        assert.deepEqual(desfechos, [200, ...Array(11).fill(409)]);

        const [[{ agendas }]] = await pool.query("SELECT COUNT(*) AS agendas FROM tb_agenda WHERE dia_horario = '2030-06-10 13:00'");
        const [[{ consultas }]] = await pool.query('SELECT COUNT(*) AS consultas FROM consulta');
        assert.deepEqual([agendas, consultas], [1, 1]);
    });

    test('concorrência: cadastros simultâneos com o mesmo CPF criam um único paciente', async () => {
        const respostas = await Promise.all(Array.from({ length: 10 }, () => api.pedir('POST', '/autocadastro', { corpo: ANA })));
        const status = respostas.map((r) => r.status).sort();
        assert.deepEqual(status, [200, ...Array(9).fill(409)]);

        const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM tb_auto_cadastro');
        assert.equal(total, 1);
    });

    test('remoção de agenda: só sem consulta vinculada', async () => {
        const { agenda } = await agendarComoPacienteNovo(ANA, '2030-03-15', '14:00');
        const livre = await api.pedir('POST', '/agenda', { corpo: { dia: '2030-07-01', hora: '12:00' } });

        assert.equal((await api.pedir('DELETE', `/remover/${agenda.corpo.agendaId}`, { token: admin })).status, 409);
        assert.equal((await api.pedir('DELETE', `/remover/${livre.corpo.agendaId}`, { token: admin })).status, 200);
        assert.equal((await api.pedir('DELETE', `/remover/${livre.corpo.agendaId}`, { token: admin })).status, 404);

        const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM tb_agenda');
        assert.equal(total, 1);
    });

    test('tentativas de injeção não alteram nem expõem dados', async () => {
        await agendarComoPacienteNovo(ANA, '2030-03-15', '14:00');
        await pool.query("INSERT INTO tb_login (email, senha) VALUES ('adm@clinica.com', 'segredo')");

        for (const email of ["' OR '1'='1", "adm@clinica.com' -- ", "' UNION SELECT 1, 'x' -- "]) {
            assert.equal((await api.pedir('POST', '/login', { corpo: { email, senha: 'x' } })).status, 401);
        }
        const nome = "Robert'); DROP TABLE consulta; --";
        const cadastro = await api.pedir('POST', '/autocadastro', { corpo: { ...BRUNO, nome } });
        assert.equal(cadastro.status, 200);
        const [[paciente]] = await pool.query('SELECT nome FROM tb_auto_cadastro WHERE id_paciente = ?', [cadastro.corpo.pacienteId]);
        assert.equal(paciente.nome, nome);
        assert.equal((await api.pedir('GET', '/consultasFuturas', { token: admin })).corpo.length, 1);
    });

    test('health consulta o banco de verdade', async () => {
        assert.deepEqual((await api.pedir('GET', '/health')).corpo, { status: 'ok' });
    });
});

/** Gera um CPF com dígitos verificadores corretos a partir de um índice. */
function cpfValido(indice) {
    const base = String(100000000 + indice * 7919).slice(0, 9).split('').map(Number);
    const verificador = (digitos) => {
        const soma = digitos.reduce((total, d, i) => total + d * (digitos.length + 1 - i), 0);
        return ((soma * 10) % 11) % 10;
    };
    const d1 = verificador(base);
    const d2 = verificador([...base, d1]);
    return [...base, d1, d2].join('');
}
