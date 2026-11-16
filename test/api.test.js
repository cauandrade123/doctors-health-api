// Testes HTTP da API completa, com MySQL e SMTP substituídos por dublês.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { gerarHash } from '../src/utils/senha.js';
import { CONFIG, poolFalso, subirApi, tokenAdmin, tokenPaciente } from './apoio.js';

const ROTAS_ADMINISTRATIVAS = [
    ['GET', '/consultasPassadas'],
    ['GET', '/consultasFuturas'],
    ['GET', '/consultasCpf/123'],
    ['GET', '/agenda/consultas'],
    ['PUT', '/consultas/1'],
    ['GET', '/consultaFinalizar/529.982.247-25'],
    ['PUT', '/finalizarConsulta/529.982.247-25'],
    ['GET', '/pegardata'],
    ['GET', '/verfificarestadoFinalizadaAgenda/1'],
    ['DELETE', '/remover/1'],
    ['GET', '/puxarfinanceiro/2024'],
    ['POST', '/financeiro'],
    ['POST', '/enviar-call'],
];

describe('autenticação e autorização', () => {
    let api;
    before(async () => { api = await subirApi(); });
    after(() => api.fechar());

    for (const [metodo, caminho] of ROTAS_ADMINISTRATIVAS) {
        test(`${metodo} ${caminho} exige token de administrador`, async () => {
            const corpo = metodo === 'GET' || metodo === 'DELETE' ? undefined : {};
            const tokensRecusados = {
                'sem token': undefined,
                'token de paciente': tokenPaciente(),
                'token expirado': tokenAdmin({ expiresIn: -10 }),
                'perfil paciente assinado com o segredo de admin': jwt.sign({ id: 1, tipo: 'paciente' }, CONFIG.jwt.segredoAdmin),
                'algoritmo none': jwt.sign({ id: 1, tipo: 'admin' }, '', { algorithm: 'none' }),
                'assinatura adulterada': `${tokenAdmin().slice(0, -3)}abc`,
            };
            for (const [caso, token] of Object.entries(tokensRecusados)) {
                const resposta = await api.pedir(metodo, caminho, { corpo, token });
                assert.equal(resposta.status, 401, caso);
            }
            assert.equal(api.pool.chamadas.length, 0, 'nenhuma query pode rodar sem autenticação');
        });
    }

    test('token de administrador válido dá acesso', async () => {
        const resposta = await api.pedir('GET', '/consultasFuturas', { token: tokenAdmin() });
        assert.equal(resposta.status, 200);
        assert.deepEqual(resposta.corpo, []);
    });

    test('rota desconhecida não revela nada sem token e responde 404 com token', async () => {
        assert.equal((await api.pedir('GET', '/nao-existe')).status, 401);
        const resposta = await api.pedir('GET', '/nao-existe', { token: tokenAdmin() });
        assert.equal(resposta.status, 404);
        assert.equal(resposta.corpo.erro, 'Rota não encontrada.');
    });

    test('rotas do paciente recusam token de administrador', async () => {
        assert.equal((await api.pedir('GET', '/MinhasConsultas')).status, 401);
        assert.equal((await api.pedir('GET', '/MinhasConsultas', { token: tokenAdmin() })).status, 401);
        assert.equal((await api.pedir('POST', '/enviar', { corpo: {}, token: tokenAdmin() })).status, 401);
    });

    test('MinhasConsultas usa o id do token, não um valor informado pelo cliente', async () => {
        const resposta = await api.pedir('GET', '/MinhasConsultas?id_paciente=999', { token: tokenPaciente(7) });
        assert.equal(resposta.status, 200);
        assert.deepEqual(api.pool.chamadas.at(-1).parametros, [7]);
    });
});

describe('login', () => {
    const subirComUsuario = (senhaArmazenada) =>
        subirApi({ pool: poolFalso(() => (senhaArmazenada === null ? [] : [{ id_login: 3, senha: senhaArmazenada }])) });

    test('usuário inexistente recebe 401 (antes: 200 com token nulo)', async () => {
        const api = await subirComUsuario(null);
        const resposta = await api.pedir('POST', '/login', { corpo: { email: 'x@y.z', senha: 'qualquer' } });
        assert.equal(resposta.status, 401);
        assert.equal(resposta.corpo.token, undefined);
        await api.fechar();
    });

    test('senha legada em texto puro: correta entra, errada não', async () => {
        const api = await subirComUsuario('senha-antiga');
        assert.equal((await api.pedir('POST', '/login', { corpo: { email: 'adm', senha: 'errada' } })).status, 401);

        const resposta = await api.pedir('POST', '/login', { corpo: { email: 'adm', senha: 'senha-antiga' } });
        assert.equal(resposta.status, 200);
        const dados = jwt.verify(resposta.corpo.token, CONFIG.jwt.segredoAdmin, { algorithms: ['HS256'] });
        assert.equal(dados.id, 3);
        assert.equal(dados.tipo, 'admin');
        assert.equal(dados.exp - dados.iat, 8 * 3600);
        await api.fechar();
    });

    test('senha com hash scrypt', async () => {
        const api = await subirComUsuario(await gerarHash('nova-senha'));
        assert.equal((await api.pedir('POST', '/login', { corpo: { email: 'adm', senha: 'nova-senha' } })).status, 200);
        assert.equal((await api.pedir('POST', '/login', { corpo: { email: 'adm', senha: 'outra' } })).status, 401);
        await api.fechar();
    });

    test('entrada malformada é recusada antes de consultar o banco', async () => {
        const api = await subirComUsuario('x');
        for (const corpo of [{}, { email: 'adm' }, { email: { email: 1 }, senha: 'x' }, { email: 'adm', senha: ['x'] }, { email: 'adm', senha: 'x'.repeat(201) }]) {
            assert.equal((await api.pedir('POST', '/login', { corpo })).status, 400);
        }
        assert.equal(api.pool.chamadas.length, 0);
        await api.fechar();
    });

    test('bloqueia força bruta após 10 tentativas com falha', async () => {
        const api = await subirComUsuario('certa');
        for (let tentativa = 1; tentativa <= 10; tentativa++) {
            assert.equal((await api.pedir('POST', '/login', { corpo: { email: 'adm', senha: 'errada' } })).status, 401);
        }
        const bloqueada = await api.pedir('POST', '/login', { corpo: { email: 'adm', senha: 'certa' } });
        assert.equal(bloqueada.status, 429);
        await api.fechar();
    });
});

describe('fluxo público de agendamento', () => {
    const PACIENTE = {
        nome: 'Ana Souza', nascimento: '1990-05-20', rg: '12.345.678-9',
        cpf: '529.982.247-25', telefone: '(11) 91234-5678', email: 'ana@exemplo.com',
    };

    test('autocadastro mantém o contrato e emite token de paciente', async () => {
        const api = await subirApi({ pool: poolFalso(() => ({ affectedRows: 1, insertId: 15 })) });
        const resposta = await api.pedir('POST', '/autocadastro', { corpo: PACIENTE });

        assert.equal(resposta.status, 200);
        assert.equal(resposta.corpo['confirmação'], 'Consulta agendada!');
        assert.equal(resposta.corpo.pacienteId, 15);
        const dados = jwt.verify(resposta.corpo.token, CONFIG.jwt.segredoPaciente, { algorithms: ['HS256'] });
        assert.deepEqual([dados.id, dados.tipo, dados.exp - dados.iat], [15, 'paciente', 5 * 3600]);
        await api.fechar();
    });

    test('autocadastro responde 409 quando CPF ou telefone já existem', async () => {
        const api = await subirApi({ pool: poolFalso(() => ({ affectedRows: 0, insertId: 0 })) });
        assert.equal((await api.pedir('POST', '/autocadastro', { corpo: PACIENTE })).status, 409);
        await api.fechar();
    });

    test('autocadastro valida cada campo no servidor', async () => {
        const api = await subirApi();
        const invalidos = {
            cpf: '529.982.247-26', email: 'sem-arroba', telefone: '123', nascimento: '2015-01-01',
            nome: '', rg: 'x'.repeat(21),
        };
        for (const [campo, valor] of Object.entries(invalidos)) {
            const resposta = await api.pedir('POST', '/autocadastro', { corpo: { ...PACIENTE, [campo]: valor } });
            assert.equal(resposta.status, 400, campo);
        }
        assert.equal(api.pool.chamadas.length, 0);
        await api.fechar();
    });

    test('horarios-ocupados mantém o formato esperado pelo frontend', async () => {
        let linhas = [];
        const api = await subirApi({ pool: poolFalso(() => linhas) });

        assert.deepEqual((await api.pedir('POST', '/horarios-ocupados', { corpo: { data: '2030-01-10' } })).corpo, { horariosOcupados: [] });
        linhas = [{ hora: '14:00:00' }, { hora: '15:00:00' }];
        assert.deepEqual((await api.pedir('POST', '/horarios-ocupados', { corpo: { data: '2030-01-10' } })).corpo, { horariosOcupados: [linhas] });
        await api.fechar();
    });

    test('consultas aceita o corpo que o frontend envia hoje (campo "medicao", preço em texto)', async () => {
        const api = await subirApi({ pool: poolFalso(() => ({ affectedRows: 1, insertId: 9 })) });
        const corpo = { id_agenda: 4, tratamento: '', condicao: '', medicao: '', preco: '0', id_paciente: 15, metodo: 'Online ' };
        const resposta = await api.pedir('POST', '/consultas', { corpo });

        assert.deepEqual([resposta.status, resposta.corpo], [200, { consultaId: 9 }]);
        assert.deepEqual(api.pool.chamadas[0].parametros.slice(0, 7), [4, '', '', null, 0, 15, 'Online']);
        await api.fechar();
    });

    test('entradas maliciosas ou malformadas são recusadas sem tocar no banco', async () => {
        const api = await subirApi();
        const casos = [
            ['POST', '/verificar-cpf', { cpf: { cpf: 1 } }],
            ['POST', '/verificar-cpf', { cpf: "' OR 1=1 -- " }],
            ['POST', '/verificar-telefone', { telefone: ['1'] }],
            ['POST', '/horarios-ocupados', { data: "2030-01-10' OR '1'='1" }],
            ['POST', '/agenda', { dia: '2030-13-45', hora: '14:00' }],
            ['POST', '/agenda', { dia: '2030-01-10', hora: '25:00' }],
            ['POST', '/consultas', { id_agenda: '1 OR 1=1', id_paciente: 1 }],
            ['POST', '/consultas', { id_agenda: 1, id_paciente: 1, preco: -10 }],
            ['GET', '/Id-do-paciente/%25', undefined],
            ['GET', '/verificarconsulta/1%20OR%201=1', undefined],
        ];
        for (const [metodo, caminho, corpo] of casos) {
            assert.equal((await api.pedir(metodo, caminho, { corpo })).status, 400, `${metodo} ${caminho}`);
        }
        assert.equal(api.pool.chamadas.length, 0);
        await api.fechar();
    });
});

describe('painel administrativo', () => {
    test('busca por CPF aceita a máscara do painel e recusa curinga %', async () => {
        const api = await subirApi();
        const token = tokenAdmin();

        assert.equal((await api.pedir('GET', '/consultasCpf/123.___.___-__', { token })).status, 200);
        assert.deepEqual(api.pool.chamadas[0].parametros, ['123.___.___-__%']);
        assert.equal((await api.pedir('GET', '/consultasCpf/%25', { token })).status, 400);
        await api.fechar();
    });

    test('PUT /consultas/:id mantém as respostas e valida o preço', async () => {
        let afetadas = 1;
        const api = await subirApi({ pool: poolFalso(() => ({ affectedRows: afetadas })) });
        const token = tokenAdmin();
        const corpo = { tratamento: 'Repouso', condicao: 'Gripe', medicacao: '', preco: '150.50' };

        const ok = await api.pedir('PUT', '/consultas/8', { corpo, token });
        assert.deepEqual([ok.status, ok.corpo], [200, 'Consulta editada!']);
        assert.deepEqual(api.pool.chamadas[0].parametros, ['Repouso', 'Gripe', '', 150.5, 8]);

        afetadas = 0;
        assert.equal((await api.pedir('PUT', '/consultas/8', { corpo, token })).status, 404);
        assert.equal((await api.pedir('PUT', '/consultas/8', { corpo: { ...corpo, preco: 'abc' }, token })).status, 400);
        assert.equal((await api.pedir('PUT', '/consultas/abc', { corpo, token })).status, 400);
        await api.fechar();
    });

    test('finalizarConsulta responde 404 em vez de deixar a requisição pendurada', async () => {
        const api = await subirApi({ pool: poolFalso(() => ({ affectedRows: 0 })) });
        const resposta = await api.pedir('PUT', '/finalizarConsulta/529.982.247-25', { token: tokenAdmin() });
        assert.equal(resposta.status, 404);
        await api.fechar();
    });

    test('DELETE /remover distingue removida, em uso e inexistente', async () => {
        const respostas = [{ affectedRows: 1 }, { affectedRows: 0 }, [{ 1: 1 }], { affectedRows: 0 }, []];
        const api = await subirApi({ pool: poolFalso(() => respostas.shift()) });
        const token = tokenAdmin();

        assert.equal((await api.pedir('DELETE', '/remover/5', { token })).status, 200);
        assert.equal((await api.pedir('DELETE', '/remover/5', { token })).status, 409);
        assert.equal((await api.pedir('DELETE', '/remover/5', { token })).status, 404);
        assert.equal((await api.pedir('DELETE', '/remover/abc', { token })).status, 400);
        await api.fechar();
    });
});

describe('e-mail', () => {
    test('/enviar envia para o e-mail do cadastro do paciente autenticado, não para o do corpo', async () => {
        const pool = poolFalso(() => [{ nome: 'Ana <script>alert(1)</script>', email: 'ana@exemplo.com' }]);
        const api = await subirApi({ pool });
        const corpo = { nome: 'Vítima', email: 'vitima@outro.com', data: '2030-01-10', horario: '14:00' };

        const resposta = await api.pedir('POST', '/enviar', { corpo, token: tokenPaciente(7) });
        assert.deepEqual([resposta.status, resposta.corpo], [200, { mensagem: 'Email enviado com sucesso.' }]);

        const [mensagem] = api.transporteEmail.enviados;
        assert.equal(mensagem.to, 'ana@exemplo.com');
        assert.equal(mensagem.from, CONFIG.email.usuario);
        assert.deepEqual(pool.chamadas[0].parametros, [7]);
        assert.doesNotMatch(mensagem.html, /<script>|Vítima|vitima@outro\.com/);
        assert.match(mensagem.html, /Ana &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
        assert.match(mensagem.html, /2030-01-10/);
        await api.fechar();
    });

    test('/enviar valida data e horário', async () => {
        const api = await subirApi();
        const corpo = { data: '<img src=x onerror=alert(1)>', horario: '14:00' };
        assert.equal((await api.pedir('POST', '/enviar', { corpo, token: tokenPaciente() })).status, 400);
        assert.equal(api.transporteEmail.enviados.length, 0);
        await api.fechar();
    });

    test('/enviar-call só aceita link https da sala de teleconsulta', async () => {
        const api = await subirApi();
        const token = tokenAdmin();
        const base = { nome: 'João "Jo" Silva', email: 'joao@exemplo.com' };

        const recusados = [
            'http://meet.jit.si/sala', 'https://meet.jit.si.evil.com/sala', 'https://evil.com/?meet.jit.si',
            'javascript:alert(1)', 'https://user:pass@meet.jit.si/sala', 'nao-e-url', undefined,
        ];
        for (const link of recusados) {
            assert.equal((await api.pedir('POST', '/enviar-call', { corpo: { ...base, link }, token })).status, 400, String(link));
        }
        assert.equal(api.transporteEmail.enviados.length, 0);

        const link = 'https://meet.jit.si/SALA%20DE%20João "Jo" Silva';
        assert.equal((await api.pedir('POST', '/enviar-call', { corpo: { ...base, link }, token })).status, 200);
        const [mensagem] = api.transporteEmail.enviados;
        assert.equal(mensagem.to, 'joao@exemplo.com');
        assert.match(mensagem.html, /href="https:\/\/meet\.jit\.si\/SALA%20DE%20Jo%C3%A3o%20%22Jo%22%20Silva"/);
        assert.match(mensagem.html, /Caro\(a\) João &quot;Jo&quot; Silva,/);
        await api.fechar();
    });

    test('/enviar-call recusa destinatário múltiplo ou com quebra de linha', async () => {
        const api = await subirApi();
        const corpo = { nome: 'Ana', link: 'https://meet.jit.si/sala' };
        for (const email of ['a@b.co, c@d.co', 'a@b.co\r\nBcc: c@d.co', 'a@b.co;c@d.co']) {
            assert.equal((await api.pedir('POST', '/enviar-call', { corpo: { ...corpo, email }, token: tokenAdmin() })).status, 400);
        }
        await api.fechar();
    });

    test('falha do SMTP vira 502 sem detalhes internos', async () => {
        const transporteEmail = { sendMail: async () => { throw new Error('535 senha do smtp: hunter2'); } };
        const api = await subirApi({ transporteEmail });
        const corpo = { nome: 'Ana', email: 'ana@exemplo.com', link: 'https://meet.jit.si/sala' };

        const resposta = await api.pedir('POST', '/enviar-call', { corpo, token: tokenAdmin() });
        assert.equal(resposta.status, 502);
        assert.doesNotMatch(JSON.stringify(resposta.corpo), /hunter2|535/);
        await api.fechar();
    });

    test('limita disparos de e-mail do paciente a 5 por hora', async () => {
        const api = await subirApi({ pool: poolFalso(() => [{ nome: 'Ana', email: 'ana@exemplo.com' }]) });
        const opcoes = { corpo: { data: '2030-01-10', horario: '14:00' }, token: tokenPaciente() };
        for (let envio = 1; envio <= 5; envio++) assert.equal((await api.pedir('POST', '/enviar', opcoes)).status, 200);
        assert.equal((await api.pedir('POST', '/enviar', opcoes)).status, 429);
        assert.equal(api.transporteEmail.enviados.length, 5);
        await api.fechar();
    });
});

describe('erros, limites e cabeçalhos', () => {
    test('falha do banco vira 500 genérico com requestId, sem vazar SQL', async () => {
        const erro = Object.assign(new Error("Table 'clinica.consulta' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', sqlState: '42S02' });
        const api = await subirApi({ pool: poolFalso(() => { throw erro; }) });

        const resposta = await api.pedir('GET', '/consultasPassadas', { token: tokenAdmin() });
        assert.equal(resposta.status, 500);
        assert.equal(resposta.corpo.erro, 'Erro interno do servidor.');
        assert.equal(resposta.corpo.requestId, resposta.cabecalhos.get('x-request-id'));
        assert.doesNotMatch(JSON.stringify(resposta.corpo), /clinica|consulta|Table/);

        // Rotas que antes ficavam penduradas ou derrubavam o processo agora respondem.
        assert.equal((await api.pedir('GET', '/MinhasConsultas', { token: tokenPaciente() })).status, 500);
        assert.equal((await api.pedir('DELETE', '/remover/1', { token: tokenAdmin() })).status, 500);
        await api.fechar();
    });

    test('erros de dados do MySQL viram 4xx', async () => {
        const erro = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', sqlState: '23000' });
        const api = await subirApi({ pool: poolFalso(() => { throw erro; }) });
        const corpo = { id_paciente: 1, id_agenda: 1, metodo: 'Online' };
        assert.equal((await api.pedir('POST', '/cadastrado', { corpo })).status, 409);
        await api.fechar();
    });

    test('corpo acima de 10 kB e JSON inválido são recusados', async () => {
        const api = await subirApi();
        assert.equal((await api.pedir('POST', '/verificar-cpf', { corpo: { cpf: 'x'.repeat(11_000) } })).status, 413);
        const invalido = await api.pedir('POST', '/verificar-cpf', { corpo: '{"cpf": ' });
        assert.deepEqual([invalido.status, invalido.corpo.erro], [400, 'JSON inválido.']);
        await api.fechar();
    });

    test('health reflete a disponibilidade do banco', async () => {
        let falhar = false;
        const api = await subirApi({ pool: poolFalso(() => { if (falhar) throw new Error('ECONNREFUSED'); return []; }) });
        assert.deepEqual((await api.pedir('GET', '/health')).corpo, { status: 'ok' });
        falhar = true;
        const resposta = await api.pedir('GET', '/health');
        assert.deepEqual([resposta.status, resposta.corpo], [503, { status: 'indisponivel' }]);
        await api.fechar();
    });

    test('cabeçalhos de segurança presentes e x-powered-by ausente', async () => {
        const api = await subirApi();
        const { cabecalhos } = await api.pedir('GET', '/health');
        assert.equal(cabecalhos.get('x-powered-by'), null);
        assert.equal(cabecalhos.get('x-content-type-options'), 'nosniff');
        assert.equal(cabecalhos.get('x-frame-options'), 'SAMEORIGIN');
        assert.match(cabecalhos.get('strict-transport-security'), /max-age=\d+/);
        assert.match(cabecalhos.get('content-security-policy'), /default-src 'self'/);
        await api.fechar();
    });

    test('CORS só libera as origens configuradas', async () => {
        const api = await subirApi();
        const permitida = await api.pedir('GET', '/health', { cabecalhos: { Origin: 'http://frontend.teste' } });
        assert.equal(permitida.cabecalhos.get('access-control-allow-origin'), 'http://frontend.teste');
        const negada = await api.pedir('GET', '/health', { cabecalhos: { Origin: 'http://malicioso.teste' } });
        assert.equal(negada.cabecalhos.get('access-control-allow-origin'), null);

        const preflight = await api.pedir('OPTIONS', '/consultasFuturas', {
            cabecalhos: { Origin: 'http://frontend.teste', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
        });
        assert.equal(preflight.status, 204);
        assert.match(preflight.cabecalhos.get('access-control-allow-headers'), /Authorization/);
        await api.fechar();
    });
});
