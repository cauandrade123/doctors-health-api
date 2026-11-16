import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const PREFIXO = 'scrypt';
const PARAMETROS = { N: 2 ** 15, r: 8, p: 3 };
const TAMANHO_CHAVE = 32;
const MEMORIA_MAXIMA = 64 * 1024 * 1024;
const SAL_DE_DESCARTE = Buffer.alloc(16);

const derivar = (senha, sal, parametros) =>
    scryptAsync(senha, sal, TAMANHO_CHAVE, { ...parametros, maxmem: MEMORIA_MAXIMA });

const sha256 = (valor) => createHash('sha256').update(valor).digest();

/** Gera o hash no formato `scrypt$N$r$p$sal$chave` (sal e chave em base64url). */
export async function gerarHash(senha) {
    const sal = randomBytes(16);
    const chave = await derivar(senha, sal, PARAMETROS);
    const { N, r, p } = PARAMETROS;
    return [PREFIXO, N, r, p, sal.toString('base64url'), chave.toString('base64url')].join('$');
}

async function conferirHash(senha, [, N, r, p, sal, chave]) {
    const esperada = Buffer.from(chave, 'base64url');
    try {
        const obtida = await derivar(senha, Buffer.from(sal, 'base64url'), {
            N: Number(N),
            r: Number(r),
            p: Number(p),
        });
        return esperada.length === obtida.length && timingSafeEqual(esperada, obtida);
    } catch {
        // Parâmetros corrompidos ou acima do limite de memória: trata como senha incorreta.
        return false;
    }
}

/**
 * Confere a senha contra o valor armazenado.
 *
 * Aceita o hash scrypt e, para não exigir migração imediata do banco, a senha legada em
 * texto puro (comparada em tempo constante). Toda chamada custa uma derivação scrypt —
 * inclusive quando o usuário não existe — para que o tempo de resposta não revele o caso.
 */
export async function verificarSenha(senha, armazenada) {
    const partes = typeof armazenada === 'string' ? armazenada.split('$') : [];
    if (partes[0] === PREFIXO && partes.length === 6) return conferirHash(senha, partes);

    await derivar(senha, SAL_DE_DESCARTE, PARAMETROS);
    if (typeof armazenada !== 'string' || armazenada === '') return false;
    return timingSafeEqual(sha256(senha), sha256(armazenada));
}
