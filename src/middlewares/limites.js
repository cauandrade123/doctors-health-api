import { rateLimit } from 'express-rate-limit';
import { ErroHttp } from '../utils/erroHttp.js';

const MINUTO = 60_000;

function limitar(janelaMs, limite, opcoes = {}) {
    return rateLimit({
        windowMs: janelaMs,
        limit: limite,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (req, res, next) => next(new ErroHttp(429, 'Muitas requisições. Tente novamente mais tarde.')),
        ...opcoes,
    });
}

/**
 * Limites por IP. O contador fica em memória: suficiente para uma instância; com mais de
 * uma, é preciso um store compartilhado (ex.: Redis).
 */
export function criarLimites() {
    return {
        // Rotas sem autenticação (fluxo de agendamento do paciente).
        publico: limitar(15 * MINUTO, 200),
        // Força bruta de senha: só as tentativas que falham contam.
        login: limitar(15 * MINUTO, 10, { skipSuccessfulRequests: true }),
        // Criação de cadastro, horário e consulta (um agendamento usa 3 requisições).
        cadastro: limitar(60 * MINUTO, 60),
        // Disparo de e-mail pelo paciente e pelo painel.
        emailPaciente: limitar(60 * MINUTO, 5),
        emailAdmin: limitar(60 * MINUTO, 60),
    };
}
