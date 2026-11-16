const NIVEIS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function registrar(nivel, mensagem, contexto) {
    const minimo = NIVEIS[process.env.LOG_LEVEL] ?? NIVEIS.info;
    if (NIVEIS[nivel] < minimo) return;

    const linha = JSON.stringify({ nivel, hora: new Date().toISOString(), mensagem, ...contexto });
    (nivel === 'error' ? process.stderr : process.stdout).write(`${linha}\n`);
}

/** Logs estruturados (uma linha JSON por evento). Nunca registre corpo de requisição, token ou senha. */
export const logger = {
    debug: (mensagem, contexto) => registrar('debug', mensagem, contexto),
    info: (mensagem, contexto) => registrar('info', mensagem, contexto),
    warn: (mensagem, contexto) => registrar('warn', mensagem, contexto),
    error: (mensagem, contexto) => registrar('error', mensagem, contexto),
};

/**
 * Resume um erro para o log. Mensagens do MySQL são omitidas porque podem conter
 * os valores enviados (CPF, e-mail); o código do erro e a pilha bastam para o diagnóstico.
 */
export function descreverErro(erro) {
    const doBanco = typeof erro?.sqlState === 'string';
    return {
        nome: erro?.name,
        codigo: erro?.code,
        mensagem: doBanco ? undefined : erro?.message,
        pilha: erro?.stack?.split('\n').slice(1, 6).map((linha) => linha.trim()),
        causa: erro?.cause ? descreverErro(erro.cause) : undefined,
    };
}
