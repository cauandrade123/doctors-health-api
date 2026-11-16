import { ErroHttp } from '../utils/erroHttp.js';
import { descreverErro, logger } from '../utils/logger.js';

/** Encaminha rejeições de handlers assíncronos ao handler central (o Express 4 não faz isso sozinho). */
export const assincrono = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};

export function rotaNaoEncontrada(req, res, next) {
    next(new ErroHttp(404, 'Rota não encontrada.'));
}

// Erros do MySQL com causa conhecida: dados enviados pelo cliente ou disputa momentânea por registros.
const ERROS_DO_BANCO = {
    ER_DUP_ENTRY: [409, 'Registro já existe.'],
    ER_ROW_IS_REFERENCED_2: [409, 'Registro em uso por outro cadastro.'],
    ER_NO_REFERENCED_ROW_2: [400, 'Referência a um registro inexistente.'],
    ER_DATA_TOO_LONG: [400, 'Um dos campos excede o tamanho permitido.'],
    ER_TRUNCATED_WRONG_VALUE: [400, 'Um dos campos tem valor inválido.'],
    ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: [400, 'Um dos campos tem valor inválido.'],
    ER_WARN_DATA_OUT_OF_RANGE: [400, 'Um dos campos está fora do intervalo permitido.'],
    ER_LOCK_DEADLOCK: [503, 'Serviço ocupado. Tente novamente.'],
    ER_LOCK_WAIT_TIMEOUT: [503, 'Serviço ocupado. Tente novamente.'],
};

function classificar(erro) {
    if (erro instanceof ErroHttp) return [erro.status, erro.message];
    if (erro?.type === 'entity.too.large') return [413, 'Corpo da requisição muito grande.'];
    if (erro?.type === 'entity.parse.failed') return [400, 'JSON inválido.'];
    if (erro?.expose && erro.status >= 400 && erro.status < 500) return [erro.status, 'Requisição inválida.'];
    // Fila do pool cheia: o mysql2 sinaliza apenas pela mensagem, sem código de erro.
    if (erro?.message === 'Queue limit reached.') return [503, 'Serviço ocupado. Tente novamente.'];
    return ERROS_DO_BANCO[erro?.code] ?? [500, 'Erro interno do servidor.'];
}

/**
 * Handler central: única saída de erro da API. O cliente recebe `{ erro, requestId }`;
 * detalhes internos (SQL, pilha) vão apenas para o log.
 */
// eslint-disable-next-line no-unused-vars -- o Express identifica o handler de erro pelos 4 parâmetros
export function tratarErros(erro, req, res, next) {
    const [status, mensagem] = classificar(erro);

    if (status >= 500) {
        logger.error('Erro inesperado', { requestId: req.id, erro: descreverErro(erro) });
    }
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.status(status).json({ erro: mensagem, requestId: req.id });
}
