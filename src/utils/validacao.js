import { ErroHttp } from './erroHttp.js';

const invalido = (campo, motivo = 'é inválido') => new ErroHttp(400, `O campo '${campo}' ${motivo}.`);
const ausente = (valor) => valor === undefined || valor === null;

/**
 * Texto de linha única, sem caracteres de controle. Retorna o valor aparado.
 * Campo opcional: ausente vira null e string vazia é mantida.
 */
export function texto(valor, campo, { max, obrigatorio = true, padrao } = {}) {
    if (ausente(valor)) {
        if (obrigatorio) throw invalido(campo, 'é obrigatório');
        return null;
    }
    if (typeof valor !== 'string') throw invalido(campo);

    const limpo = valor.trim();
    if (limpo === '') {
        if (obrigatorio) throw invalido(campo, 'é obrigatório');
        return limpo;
    }
    if (limpo.length > max) throw invalido(campo, `excede ${max} caracteres`);
    if (/\p{Cc}/u.test(limpo) || (padrao && !padrao.test(limpo))) throw invalido(campo);
    return limpo;
}

/** Senha: não é aparada nem normalizada, apenas limitada em tamanho. */
export function senha(valor) {
    if (typeof valor !== 'string' || valor.length === 0 || valor.length > 200) throw invalido('senha');
    return valor;
}

/** Inteiro vindo de JSON (número) ou da URL (texto). */
export function inteiro(valor, campo, { min = 1, max = 2_147_483_647 } = {}) {
    const numero = typeof valor === 'string' && /^\d{1,10}$/.test(valor) ? Number(valor) : valor;
    if (!Number.isInteger(numero) || numero < min || numero > max) throw invalido(campo);
    return numero;
}

/** Valor monetário não negativo com até duas casas decimais. */
export function decimal(valor, campo, { obrigatorio = true } = {}) {
    if (ausente(valor)) {
        if (obrigatorio) throw invalido(campo, 'é obrigatório');
        return null;
    }
    const comoTexto = typeof valor === 'number' ? String(valor) : valor;
    if (typeof comoTexto !== 'string' || !/^\d{1,8}(\.\d{1,2})?$/.test(comoTexto)) throw invalido(campo);
    return Number(comoTexto);
}

/** Data no formato AAAA-MM-DD que exista no calendário. */
export function data(valor, campo) {
    const limpo = texto(valor, campo, { max: 10, padrao: /^\d{4}-\d{2}-\d{2}$/ });
    const [ano, mes, dia] = limpo.split('-').map(Number);
    const real = new Date(Date.UTC(ano, mes - 1, dia));
    if (real.getUTCFullYear() !== ano || real.getUTCMonth() !== mes - 1 || real.getUTCDate() !== dia) {
        throw invalido(campo);
    }
    return limpo;
}

/** Horário HH:MM ou HH:MM:SS. */
export function hora(valor, campo) {
    return texto(valor, campo, { max: 8, padrao: /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/ });
}

export function email(valor, campo = 'email') {
    return texto(valor, campo, { max: 254, padrao: /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/ });
}

/**
 * CPF usado apenas para busca. O painel envia a máscara incompleta (ex.: "123.___.___-__"),
 * por isso "_" é aceito; o caractere "%" nunca é.
 */
export function cpfParaBusca(valor, campo = 'cpf') {
    return texto(valor, campo, { max: 14, padrao: /^[0-9._-]+$/ });
}

/** CPF de um novo cadastro: formato e dígitos verificadores. */
export function cpfNovo(valor, campo = 'cpf') {
    const limpo = texto(valor, campo, { max: 14, padrao: /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/ });
    const digitos = limpo.replace(/\D/g, '').split('').map(Number);
    if (new Set(digitos).size === 1) throw invalido(campo);

    const verificador = (quantidade) => {
        const soma = digitos.slice(0, quantidade).reduce((total, d, i) => total + d * (quantidade + 1 - i), 0);
        return ((soma * 10) % 11) % 10;
    };
    if (verificador(9) !== digitos[9] || verificador(10) !== digitos[10]) throw invalido(campo);
    return limpo;
}

/** Telefone usado apenas para busca (aceita a máscara incompleta do formulário). */
export function telefoneParaBusca(valor, campo = 'telefone') {
    return texto(valor, campo, { max: 20, padrao: /^[0-9 ()+_-]+$/ });
}

/** Telefone de um novo cadastro: DDD + número (10 ou 11 dígitos). */
export function telefoneNovo(valor, campo = 'telefone') {
    const limpo = texto(valor, campo, { max: 20, padrao: /^[0-9 ()+-]+$/ });
    const digitos = limpo.replace(/\D/g, '').length;
    if (digitos < 10 || digitos > 11) throw invalido(campo);
    return limpo;
}

/** Data de nascimento de um paciente com 18 anos completos. */
export function nascimentoDeAdulto(valor, campo = 'nascimento') {
    const limpo = data(valor, campo);
    const [ano, mes, dia] = limpo.split('-').map(Number);
    const hoje = new Date();
    const fezAniversario =
        hoje.getUTCMonth() + 1 > mes || (hoje.getUTCMonth() + 1 === mes && hoje.getUTCDate() >= dia);
    const idade = hoje.getUTCFullYear() - ano - (fezAniversario ? 0 : 1);
    if (idade < 18) throw new ErroHttp(400, 'É necessário ter 18 anos ou mais.');
    if (idade > 130) throw invalido(campo);
    return limpo;
}
