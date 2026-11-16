// Rotas que intermediam serviços de terceiros: as chaves ficam no servidor e nunca
// aparecem em respostas; o cliente só fornece valores de parâmetros.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, test } from 'node:test';
import { carregarConfig } from '../src/config.js';
import { CONFIG, servicoExternoFalso, subirApi } from './apoio.js';

const semVazarChaves = (resposta) => {
    const texto = JSON.stringify(resposta.corpo);
    for (const chave of Object.values(CONFIG.integracoes)) assert.ok(!texto.includes(chave), 'a resposta contém uma chave');
};

describe('integrações com serviços de terceiros', () => {
    test('validar-telefone consulta a veriphone com a chave do servidor', async () => {
        const buscar = servicoExternoFalso(() => ({ phone_valid: true, carrier: 'Operadora', phone: '+5511912345678' }));
        const api = await subirApi({ buscar });

        const resposta = await api.pedir('POST', '/validar-telefone', { corpo: { telefone: '(11) 91234-5678' } });
        assert.deepEqual([resposta.status, resposta.corpo], [200, { valido: true }]);

        const [{ url, opcoes }] = buscar.chamadas;
        assert.equal(url.origin + url.pathname, 'https://api.veriphone.io/v2/verify');
        assert.equal(url.searchParams.get('phone'), '5511912345678');
        assert.equal(url.searchParams.get('key'), CONFIG.integracoes.veriphone);
        assert.equal(opcoes.redirect, 'error');
        assert.ok(opcoes.signal instanceof AbortSignal);
        await api.fechar();
    });

    test('validar-telefone: só "phone_valid: true" conta como válido', async () => {
        for (const corpo of [{ phone_valid: false }, { phone_valid: 'true' }, {}, null]) {
            const api = await subirApi({ buscar: servicoExternoFalso(() => corpo) });
            const resposta = await api.pedir('POST', '/validar-telefone', { corpo: { telefone: '11912345678' } });
            assert.deepEqual(resposta.corpo, { valido: false });
            await api.fechar();
        }
    });

    test('validar-email devolve apenas a situação informada pela hunter', async () => {
        const buscar = servicoExternoFalso(() => ({ data: { status: 'valid', score: 97, sources: ['interno'] } }));
        const api = await subirApi({ buscar });

        const resposta = await api.pedir('POST', '/validar-email', { corpo: { email: 'ana@exemplo.com' } });
        assert.deepEqual([resposta.status, resposta.corpo], [200, { status: 'valid' }]);

        const [{ url }] = buscar.chamadas;
        assert.equal(url.origin + url.pathname, 'https://api.hunter.io/v2/email-verifier');
        assert.equal(url.searchParams.get('email'), 'ana@exemplo.com');
        assert.equal(url.searchParams.get('api_key'), CONFIG.integracoes.hunter);
        await api.fechar();
    });

    test('validar-email: resposta inesperada vira "unknown"', async () => {
        const api = await subirApi({ buscar: servicoExternoFalso(() => ({ errors: [{ id: 'x' }] })) });
        assert.deepEqual((await api.pedir('POST', '/validar-email', { corpo: { email: 'ana@exemplo.com' } })).corpo, { status: 'unknown' });
        await api.fechar();
    });

    test('bot/interpretar envia o token no cabeçalho e devolve só as entidades', async () => {
        const entities = { 'saudacao:saudacao': [{ value: 'olá', confidence: 0.99 }] };
        const buscar = servicoExternoFalso(() => ({ text: 'olá', intents: [], entities, traits: {} }));
        const api = await subirApi({ buscar });

        const resposta = await api.pedir('POST', '/bot/interpretar', { corpo: { mensagem: 'olá, quero marcar & pagar?' } });
        assert.deepEqual([resposta.status, resposta.corpo], [200, { entities }]);

        const [{ url, opcoes }] = buscar.chamadas;
        assert.equal(url.origin + url.pathname, 'https://api.wit.ai/message');
        assert.equal(url.searchParams.get('q'), 'olá, quero marcar & pagar?');
        assert.equal(url.searchParams.get('v'), '20241016');
        assert.equal(opcoes.headers.Authorization, `Bearer ${CONFIG.integracoes.wit}`);
        assert.ok(!url.href.includes(CONFIG.integracoes.wit), 'o token do wit não vai na URL');
        await api.fechar();
    });

    test('o cliente não consegue trocar o destino nem injetar parâmetros', async () => {
        const buscar = servicoExternoFalso(() => ({ data: { status: 'valid' }, entities: {} }));
        const api = await subirApi({ buscar });

        await api.pedir('POST', '/bot/interpretar', { corpo: { mensagem: 'x&v=1&access_token=roubado#frag', url: 'https://malicioso.teste' } });
        const { url } = buscar.chamadas.at(-1);
        assert.equal(url.hostname, 'api.wit.ai');
        assert.deepEqual([...url.searchParams.keys()], ['v', 'q']);
        assert.equal(url.searchParams.get('q'), 'x&v=1&access_token=roubado#frag');
        assert.equal(url.hash, '');

        // "&" é válido em e-mail; por ser codificado, não consegue sobrescrever a chave.
        await api.pedir('POST', '/validar-email', { corpo: { email: 'a@b.co&api_key=outra' } });
        const hunter = buscar.chamadas.at(-1).url;
        assert.deepEqual([...hunter.searchParams.keys()], ['email', 'api_key']);
        assert.equal(hunter.searchParams.get('email'), 'a@b.co&api_key=outra');
        assert.equal(hunter.searchParams.get('api_key'), CONFIG.integracoes.hunter);
        await api.fechar();
    });

    test('entradas inválidas são recusadas sem chamar o serviço externo', async () => {
        const buscar = servicoExternoFalso();
        const api = await subirApi({ buscar });
        const casos = [
            ['/validar-telefone', { telefone: '123' }],
            ['/validar-telefone', { telefone: '11912345678&key=outra' }],
            ['/validar-telefone', {}],
            ['/validar-email', { email: 'sem-arroba' }],
            ['/validar-email', { email: ['a@b.co'] }],
            ['/bot/interpretar', { mensagem: '' }],
            ['/bot/interpretar', { mensagem: 'x'.repeat(281) }],
            ['/bot/interpretar', { mensagem: { $gt: '' } }],
        ];
        for (const [caminho, corpo] of casos) {
            assert.equal((await api.pedir('POST', caminho, { corpo })).status, 400, `${caminho} ${JSON.stringify(corpo).slice(0, 40)}`);
        }
        assert.equal(buscar.chamadas.length, 0);
        await api.fechar();
    });

    test('sem chave configurada a rota responde 503 e o serviço externo não é chamado', async () => {
        const buscar = servicoExternoFalso();
        const api = await subirApi({ buscar, config: { ...CONFIG, integracoes: {} } });

        assert.equal((await api.pedir('POST', '/validar-telefone', { corpo: { telefone: '11912345678' } })).status, 503);
        assert.equal((await api.pedir('POST', '/validar-email', { corpo: { email: 'ana@exemplo.com' } })).status, 503);
        assert.equal((await api.pedir('POST', '/bot/interpretar', { corpo: { mensagem: 'oi' } })).status, 503);
        assert.equal(buscar.chamadas.length, 0);
        await api.fechar();
    });

    test('falha, tempo esgotado ou erro HTTP do serviço externo viram 502 sem detalhes', async () => {
        const falhas = [
            async () => { throw new TypeError('fetch failed: getaddrinfo ENOTFOUND api.hunter.io'); },
            async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
            async () => ({ ok: false, status: 401, json: async () => ({ errors: [{ details: `api_key ${CONFIG.integracoes.hunter} inválida` }] }) }),
            async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
        ];
        for (const buscar of falhas) {
            const api = await subirApi({ buscar });
            const resposta = await api.pedir('POST', '/validar-email', { corpo: { email: 'ana@exemplo.com' } });
            assert.equal(resposta.status, 502);
            assert.equal(resposta.corpo.erro, 'Serviço externo indisponível.');
            semVazarChaves(resposta);
            await api.fechar();
        }
    });

    test('limita a 60 chamadas por 15 minutos por IP', async () => {
        const buscar = servicoExternoFalso(() => ({ entities: {} }));
        const api = await subirApi({ buscar });
        for (let i = 1; i <= 60; i++) {
            assert.equal((await api.pedir('POST', '/bot/interpretar', { corpo: { mensagem: 'oi' } })).status, 200);
        }
        assert.equal((await api.pedir('POST', '/validar-email', { corpo: { email: 'ana@exemplo.com' } })).status, 429);
        assert.equal(buscar.chamadas.length, 60);
        await api.fechar();
    });

    test('com o fetch real: não segue redirecionamento e trata erro HTTP', async () => {
        // Servidor local no lugar do serviço externo; só o host da URL é trocado.
        const externo = createServer((req, res) => {
            if (req.url.startsWith('/v2/email-verifier')) {
                res.writeHead(302, { Location: 'http://127.0.0.1:1/interno' }).end();
            } else if (req.url.startsWith('/v2/verify')) {
                res.writeHead(500).end('erro');
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ entities: { ok: [{ value: req.headers.authorization }] } }));
            }
        }).listen(0);
        await new Promise((resolver) => externo.once('listening', resolver));
        const buscar = (url, opcoes) => fetch(`http://127.0.0.1:${externo.address().port}${url.pathname}${url.search}`, opcoes);
        const api = await subirApi({ buscar });

        assert.equal((await api.pedir('POST', '/validar-email', { corpo: { email: 'ana@exemplo.com' } })).status, 502, 'redirecionamento');
        assert.equal((await api.pedir('POST', '/validar-telefone', { corpo: { telefone: '11912345678' } })).status, 502, 'erro HTTP');
        const bot = await api.pedir('POST', '/bot/interpretar', { corpo: { mensagem: 'oi' } });
        assert.deepEqual(bot.corpo, { entities: { ok: [{ value: `Bearer ${CONFIG.integracoes.wit}` }] } });

        await api.fechar();
        await new Promise((resolver) => externo.close(resolver));
    });
});

describe('config das integrações', () => {
    const BASE = {
        MYSQL_HOST: 'db', MYSQL_USER: 'api', MYSQL_DATABASE: 'clinica',
        JWT_SECRET: 'a'.repeat(32), JWT_SECRET2: 'b'.repeat(32), EMAIL_USER: 'c@d.co', EMAIL_PASS: 'x',
    };

    test('as chaves são opcionais e lidas do ambiente', () => {
        assert.deepEqual(carregarConfig(BASE).integracoes, { wit: undefined, veriphone: undefined, hunter: undefined });
        const config = carregarConfig({ ...BASE, WIT_AI_TOKEN: ' t ', VERIPHONE_API_KEY: 'v', HUNTER_API_KEY: 'h' });
        assert.deepEqual(config.integracoes, { wit: 't', veriphone: 'v', hunter: 'h' });
    });
});
