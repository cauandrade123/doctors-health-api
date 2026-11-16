import { ErroHttp } from '../utils/erroHttp.js';

/** Middlewares que exigem um token Bearer válido do perfil indicado e preenchem `req.usuario`. */
export function criarAutenticacao(auth) {
    const exigir = (tipo) => (req, res, next) => {
        const [esquema, token] = (req.headers.authorization ?? '').split(' ');
        if (esquema !== 'Bearer' || !token) return next(new ErroHttp(401, 'Autenticação necessária.'));

        try {
            req.usuario = auth.verificarToken(tipo, token);
        } catch {
            return next(new ErroHttp(401, 'Token inválido ou expirado.'));
        }
        next();
    };

    return { exigirAdmin: exigir('admin'), exigirPaciente: exigir('paciente') };
}
