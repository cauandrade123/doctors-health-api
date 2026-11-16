// Utilitários compartilhados pelos testes: sobem a API real em uma porta livre,
// trocando apenas o MySQL e o SMTP por dublês.
import jwt from 'jsonwebtoken';
import { criarApp } from '../src/criarApp.js';

process.env.LOG_LEVEL = 'silent';

export const CONFIG = {
    ambiente: 'test',
    porta: 0,
    confiarEmProxies: 0,
    corsOrigens: ['http://frontend.teste'],
    mysql: {},
    jwt: { segredoAdmin: 'segredo-admin-de-teste-'.padEnd(40, 'a'), segredoPaciente: 'segredo-paciente-de-teste-'.padEnd(40, 'p') },
    email: { host: 'smtp.teste', port: 465, usuario: 'clinica@teste.dev', senha: 'x' },
};

export const tokenAdmin = (opcoes = {}) =>
    jwt.sign({ id: 1, tipo: 'admin' }, CONFIG.jwt.segredoAdmin, { expiresIn: '1h', ...opcoes });

export const tokenPaciente = (id = 7, opcoes = {}) =>
    jwt.sign({ id, tipo: 'paciente' }, CONFIG.jwt.segredoPaciente, { expiresIn: '1h', ...opcoes });

/** Pool de mentira: registra cada query e devolve o que `responder(sql, parametros)` retornar. */
export function poolFalso(responder = () => []) {
    const chamadas = [];
    return {
        chamadas,
        async execute({ sql }, parametros) {
            chamadas.push({ sql, parametros });
            return [await responder(sql, parametros)];
        },
    };
}

/** Limites desligados, para cenários que disparam muitas requisições de propósito. */
export const SEM_LIMITES = new Proxy({}, { get: () => (req, res, next) => next() });

export function transporteFalso() {
    const enviados = [];
    return {
        enviados,
        async sendMail(mensagem) {
            enviados.push(mensagem);
        },
    };
}

/** Sobe a API e devolve `pedir(metodo, caminho, { corpo, token, cabecalhos })` → `{ status, corpo, cabecalhos }`. */
export async function subirApi({ pool = poolFalso(), transporteEmail = transporteFalso(), config = CONFIG, limites } = {}) {
    const servidor = criarApp({ config, pool, transporteEmail, limites }).listen(0);
    await new Promise((resolver) => servidor.once('listening', resolver));
    // Se um teste falhar antes de chamar fechar(), o servidor esquecido não segura o processo.
    servidor.unref();
    const base = `http://127.0.0.1:${servidor.address().port}`;

    async function pedir(metodo, caminho, { corpo, token, cabecalhos = {} } = {}) {
        const resposta = await fetch(base + caminho, {
            method: metodo,
            headers: {
                ...(corpo !== undefined && { 'Content-Type': 'application/json' }),
                ...(token && { Authorization: `Bearer ${token}` }),
                ...cabecalhos,
            },
            body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
        });
        const texto = await resposta.text();
        let conteudo = texto;
        try {
            conteudo = JSON.parse(texto);
        } catch {
            // resposta em texto puro (ex.: PUT /consultas/:id)
        }
        return { status: resposta.status, corpo: conteudo, cabecalhos: resposta.headers };
    }

    const fechar = () => new Promise((resolver) => {
        servidor.close(resolver);
        servidor.closeAllConnections();
    });
    return { pedir, fechar, pool, transporteEmail };
}
