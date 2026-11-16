import jwt from 'jsonwebtoken';
import { ErroHttp } from '../utils/erroHttp.js';
import { verificarSenha } from '../utils/senha.js';

const ALGORITMO = 'HS256';

/**
 * Autenticação de administradores (login com senha) e emissão/verificação de tokens.
 * Cada perfil tem seu próprio segredo e o perfil também vai no token, de modo que um
 * token de paciente nunca é aceito em rota administrativa.
 */
export function criarAuthService({ repositorio, config }) {
    const perfis = {
        admin: { segredo: config.jwt.segredoAdmin, expiraEm: '8h' },
        paciente: { segredo: config.jwt.segredoPaciente, expiraEm: '5h' },
    };

    function emitirToken(tipo, id) {
        const { segredo, expiraEm } = perfis[tipo];
        return jwt.sign({ id, tipo }, segredo, { algorithm: ALGORITMO, expiresIn: expiraEm });
    }

    /** Retorna `{ id, tipo }` ou lança se o token for inválido, expirado ou de outro perfil. */
    function verificarToken(tipo, token) {
        const dados = jwt.verify(token, perfis[tipo].segredo, { algorithms: [ALGORITMO] });
        if (dados.tipo !== tipo || !Number.isInteger(dados.id)) throw new Error('Token de outro perfil');
        return { id: dados.id, tipo };
    }

    async function login(email, senha) {
        const usuario = await repositorio.buscarLoginPorEmail(email);
        const senhaConfere = await verificarSenha(senha, usuario?.senha);
        if (!usuario || !senhaConfere) throw new ErroHttp(401, 'E-mail ou senha incorretos.');
        return emitirToken('admin', usuario.id_login);
    }

    return { login, emitirToken, verificarToken };
}
