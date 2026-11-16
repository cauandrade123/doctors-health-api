const TAMANHO_MINIMO_SEGREDO = 32;

/**
 * Lê e valida a configuração a partir das variáveis de ambiente.
 * Lança um único erro listando tudo o que está errado, para a API falhar na inicialização
 * em vez de subir com uma configuração insegura.
 */
export function carregarConfig(env = process.env) {
    const erros = [];
    const ler = (nome) => env[nome]?.trim() || undefined;

    const obrigatoria = (nome) => {
        const valor = ler(nome);
        if (!valor) erros.push(`${nome} é obrigatória`);
        return valor;
    };

    const inteiro = (nome, padrao, min, max) => {
        const valor = ler(nome);
        if (valor === undefined) return padrao;
        const numero = Number(valor);
        if (!Number.isInteger(numero) || numero < min || numero > max) {
            erros.push(`${nome} deve ser um inteiro entre ${min} e ${max}`);
        }
        return numero;
    };

    const segredo = (nome) => {
        const valor = obrigatoria(nome);
        if (valor && valor.length < TAMANHO_MINIMO_SEGREDO) {
            erros.push(`${nome} deve ter ao menos ${TAMANHO_MINIMO_SEGREDO} caracteres`);
        }
        return valor;
    };

    const ambiente = ler('NODE_ENV') ?? 'development';
    const producao = ambiente === 'production';

    const origens = ler('CORS_ORIGINS');
    if (producao && !origens) {
        erros.push('CORS_ORIGINS é obrigatória em produção (lista separada por vírgula ou "*")');
    }

    const config = {
        ambiente,
        // PORT é o nome usado pelas plataformas de hospedagem; PORTA é o nome legado do projeto.
        porta: inteiro(ler('PORT') ? 'PORT' : 'PORTA', 3000, 1, 65535),
        confiarEmProxies: inteiro('TRUST_PROXY', 0, 0, 10),
        corsOrigens: !origens || origens === '*' ? '*' : origens.split(',').map((origem) => origem.trim()),
        mysql: {
            host: obrigatoria('MYSQL_HOST'),
            port: inteiro('MYSQL_PORT', 3306, 1, 65535),
            user: obrigatoria('MYSQL_USER'),
            password: producao ? obrigatoria('MYSQL_PASSWORD') : (env.MYSQL_PASSWORD ?? ''),
            database: obrigatoria('MYSQL_DATABASE'),
        },
        jwt: {
            segredoAdmin: segredo('JWT_SECRET'),
            segredoPaciente: segredo('JWT_SECRET2'),
        },
        email: {
            host: ler('EMAIL_HOST') ?? 'smtp.gmail.com',
            port: inteiro('EMAIL_PORT', 465, 1, 65535),
            usuario: obrigatoria('EMAIL_USER'),
            senha: obrigatoria('EMAIL_PASS'),
        },
        // Opcionais: sem a chave, a rota correspondente responde 503 e o resto da API funciona.
        integracoes: {
            wit: ler('WIT_AI_TOKEN'),
            veriphone: ler('VERIPHONE_API_KEY'),
            hunter: ler('HUNTER_API_KEY'),
        },
    };

    if (config.jwt.segredoAdmin && config.jwt.segredoAdmin === config.jwt.segredoPaciente) {
        erros.push('JWT_SECRET e JWT_SECRET2 devem ser diferentes');
    }

    if (erros.length > 0) {
        throw new Error(`Configuração inválida:\n- ${erros.join('\n- ')}`);
    }
    return config;
}
