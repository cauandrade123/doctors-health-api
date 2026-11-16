import { criarApp } from './criarApp.js';
import { carregarConfig } from './config.js';
import { criarPool } from './database/connection.js';
import { criarTransporteSmtp } from './services/emailService.js';
import { descreverErro, logger } from './utils/logger.js';

const PRAZO_DE_ENCERRAMENTO_MS = 10_000;

// Em desenvolvimento as variáveis vêm do arquivo .env; em produção, do ambiente.
try {
    process.loadEnvFile();
} catch (erro) {
    if (erro.code !== 'ENOENT') throw erro;
}

let config;
try {
    config = carregarConfig();
} catch (erro) {
    logger.error(erro.message);
    process.exit(1);
}

const pool = criarPool(config.mysql);
const transporteEmail = criarTransporteSmtp(config.email);
const servidor = criarApp({ config, pool, transporteEmail }).listen(config.porta, () => {
    logger.info('API no ar', { porta: config.porta, ambiente: config.ambiente });
});

// Limites contra conexões lentas ou penduradas. O keep-alive fica acima dos 60s
// usados por balanceadores de carga, para que o balanceador feche a conexão primeiro.
servidor.requestTimeout = 30_000;
servidor.headersTimeout = 15_000;
servidor.keepAliveTimeout = 65_000;

function encerrar(sinal) {
    logger.info('Encerrando', { sinal });
    setTimeout(() => process.exit(1), PRAZO_DE_ENCERRAMENTO_MS).unref();

    servidor.close(async () => {
        try {
            transporteEmail.close();
            await pool.end();
            process.exit(0);
        } catch (erro) {
            logger.error('Falha ao encerrar', descreverErro(erro));
            process.exit(1);
        }
    });
    servidor.closeIdleConnections();
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
