import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { carregarConfig } from '../src/config.js';
import { escaparHtml } from '../src/services/emailService.js';
import { descreverErro } from '../src/utils/logger.js';
import { gerarHash, verificarSenha } from '../src/utils/senha.js';
import * as validar from '../src/utils/validacao.js';

const AMBIENTE_VALIDO = {
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://clinica.exemplo, https://painel.exemplo',
    MYSQL_HOST: 'db',
    MYSQL_USER: 'api',
    MYSQL_PASSWORD: 'senha-do-banco',
    MYSQL_DATABASE: 'clinica',
    JWT_SECRET: 'a'.repeat(32),
    JWT_SECRET2: 'b'.repeat(32),
    EMAIL_USER: 'clinica@exemplo.com',
    EMAIL_PASS: 'senha-de-app',
};

describe('config', () => {
    test('aceita um ambiente completo e aplica os padrões', () => {
        const config = carregarConfig(AMBIENTE_VALIDO);
        assert.equal(config.porta, 3000);
        assert.equal(config.mysql.port, 3306);
        assert.deepEqual(config.corsOrigens, ['https://clinica.exemplo', 'https://painel.exemplo']);
        assert.equal(config.email.host, 'smtp.gmail.com');
    });

    test('PORT tem precedência e PORTA (nome legado) continua valendo', () => {
        assert.equal(carregarConfig({ ...AMBIENTE_VALIDO, PORTA: '5028' }).porta, 5028);
        assert.equal(carregarConfig({ ...AMBIENTE_VALIDO, PORTA: '5028', PORT: '8080' }).porta, 8080);
    });

    test('recusa segredo JWT ausente, curto ou repetido', () => {
        assert.throws(() => carregarConfig({ ...AMBIENTE_VALIDO, JWT_SECRET: undefined }), /JWT_SECRET é obrigatória/);
        assert.throws(() => carregarConfig({ ...AMBIENTE_VALIDO, JWT_SECRET: 'ACESSOADMIN' }), /ao menos 32 caracteres/);
        assert.throws(() => carregarConfig({ ...AMBIENTE_VALIDO, JWT_SECRET2: 'a'.repeat(32) }), /devem ser diferentes/);
    });

    test('em produção exige CORS_ORIGINS e senha do banco', () => {
        assert.throws(() => carregarConfig({ ...AMBIENTE_VALIDO, CORS_ORIGINS: '' }), /CORS_ORIGINS é obrigatória/);
        assert.throws(() => carregarConfig({ ...AMBIENTE_VALIDO, MYSQL_PASSWORD: '' }), /MYSQL_PASSWORD é obrigatória/);
        assert.equal(carregarConfig({ ...AMBIENTE_VALIDO, NODE_ENV: 'development', CORS_ORIGINS: '' }).corsOrigens, '*');
    });

    test('lista todos os problemas de uma vez', () => {
        assert.throws(() => carregarConfig({}), (erro) => {
            for (const nome of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE', 'JWT_SECRET', 'JWT_SECRET2', 'EMAIL_USER', 'EMAIL_PASS']) {
                assert.match(erro.message, new RegExp(nome));
            }
            return true;
        });
    });

    test('recusa porta inválida', () => {
        assert.throws(() => carregarConfig({ ...AMBIENTE_VALIDO, PORT: 'abc' }), /PORT deve ser um inteiro/);
    });
});

describe('senha', () => {
    test('hash scrypt confere somente com a senha correta', async () => {
        const hash = await gerarHash('S3nha!forte');
        assert.match(hash, /^scrypt\$32768\$8\$3\$[\w-]{22}\$[\w-]{43}$/);
        assert.equal(await verificarSenha('S3nha!forte', hash), true);
        assert.equal(await verificarSenha('s3nha!forte', hash), false);
    });

    test('dois hashes da mesma senha são diferentes (sal aleatório)', async () => {
        assert.notEqual(await gerarHash('igual'), await gerarHash('igual'));
    });

    test('senha legada em texto puro continua aceita', async () => {
        assert.equal(await verificarSenha('1234', '1234'), true);
        assert.equal(await verificarSenha('12345', '1234'), false);
    });

    test('valor armazenado ausente, vazio ou corrompido nunca confere', async () => {
        assert.equal(await verificarSenha('x', undefined), false);
        assert.equal(await verificarSenha('', ''), false);
        assert.equal(await verificarSenha('x', 'scrypt$0$8$3$AAAA$AAAA'), false);
        assert.equal(await verificarSenha('x', 'scrypt$1048576$64$3$AAAA$AAAA'), false);
    });
});

describe('validação', () => {
    const recusa = (funcao, ...argumentos) => assert.throws(() => funcao(...argumentos), { status: 400 });

    test('texto: apara, limita tamanho e recusa tipos e caracteres de controle', () => {
        assert.equal(validar.texto('  Ana  ', 'nome', { max: 10 }), 'Ana');
        recusa(validar.texto, 'x'.repeat(11), 'nome', { max: 10 });
        recusa(validar.texto, { $ne: 1 }, 'nome', { max: 10 });
        recusa(validar.texto, ['a'], 'nome', { max: 10 });
        recusa(validar.texto, 'linha\r\nBcc: x@y.z', 'nome', { max: 50 });
        recusa(validar.texto, '   ', 'nome', { max: 10 });
        recusa(validar.texto, undefined, 'nome', { max: 10 });
    });

    test('texto opcional: ausente vira null e vazio é preservado', () => {
        assert.equal(validar.texto(undefined, 't', { max: 5, obrigatorio: false }), null);
        assert.equal(validar.texto('', 't', { max: 5, obrigatorio: false }), '');
    });

    test('cpfNovo confere os dígitos verificadores', () => {
        assert.equal(validar.cpfNovo('529.982.247-25'), '529.982.247-25');
        assert.equal(validar.cpfNovo('52998224725'), '52998224725');
        recusa(validar.cpfNovo, '529.982.247-26');
        recusa(validar.cpfNovo, '111.111.111-11');
        recusa(validar.cpfNovo, '529.982.247');
    });

    test('cpfParaBusca aceita a máscara incompleta do painel, mas não curingas de LIKE', () => {
        assert.equal(validar.cpfParaBusca('123.___.___-__'), '123.___.___-__');
        recusa(validar.cpfParaBusca, '%');
        recusa(validar.cpfParaBusca, "1' OR '1'='1");
        recusa(validar.cpfParaBusca, '123456789012345');
    });

    test('data e hora', () => {
        assert.equal(validar.data('2030-02-28', 'dia'), '2030-02-28');
        recusa(validar.data, '2030-02-30', 'dia');
        recusa(validar.data, '28/02/2030', 'dia');
        assert.equal(validar.hora('14:00', 'hora'), '14:00');
        recusa(validar.hora, '24:00', 'hora');
        recusa(validar.hora, '14:00; DROP TABLE consulta', 'hora');
    });

    test('inteiro e decimal', () => {
        assert.equal(validar.inteiro('42', 'id'), 42);
        assert.equal(validar.inteiro(42, 'id'), 42);
        recusa(validar.inteiro, '4.2', 'id');
        recusa(validar.inteiro, '-1', 'id');
        recusa(validar.inteiro, '99999999999', 'id');
        assert.equal(validar.decimal('150.50', 'preco'), 150.5);
        assert.equal(validar.decimal(0, 'preco'), 0);
        recusa(validar.decimal, '', 'preco');
        recusa(validar.decimal, '-5', 'preco');
        recusa(validar.decimal, '1e9', 'preco');
        assert.equal(validar.decimal(undefined, 'preco', { obrigatorio: false }), null);
    });

    test('email e telefone', () => {
        assert.equal(validar.email('ana@exemplo.com'), 'ana@exemplo.com');
        recusa(validar.email, 'ana@exemplo.com, outro@exemplo.com');
        recusa(validar.email, 'ana');
        assert.equal(validar.telefoneNovo('(11) 91234-5678'), '(11) 91234-5678');
        recusa(validar.telefoneNovo, '(11) 9123');
    });

    test('nascimentoDeAdulto exige 18 anos completos', () => {
        const anosAtras = (anos, dias = 0) => {
            const dia = new Date();
            dia.setUTCFullYear(dia.getUTCFullYear() - anos);
            dia.setUTCDate(dia.getUTCDate() + dias);
            return dia.toISOString().slice(0, 10);
        };
        assert.equal(validar.nascimentoDeAdulto(anosAtras(18)), anosAtras(18));
        recusa(validar.nascimentoDeAdulto, anosAtras(18, 1));
        recusa(validar.nascimentoDeAdulto, anosAtras(-1));
    });
});

describe('utilitários', () => {
    test('escaparHtml neutraliza marcação', () => {
        assert.equal(escaparHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
    });

    test('descreverErro omite a mensagem de erros do MySQL', () => {
        const erro = Object.assign(new Error("Duplicate entry '529.982.247-25'"), { code: 'ER_DUP_ENTRY', sqlState: '23000' });
        const descricao = descreverErro(erro);
        assert.equal(descricao.codigo, 'ER_DUP_ENTRY');
        assert.equal(descricao.mensagem, undefined);
        assert.doesNotMatch(JSON.stringify(descricao), /529\.982/);
    });
});
