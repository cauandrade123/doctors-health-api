import mysql from 'mysql2/promise';

/** Cria o pool de conexões. `config` são as credenciais validadas em config.js. */
export function criarPool(config) {
    return mysql.createPool({
        ...config,
        waitForConnections: true,
        connectionLimit: 10,
        // Fila limitada: sob sobrecarga a API responde erro em vez de acumular requisições na memória.
        queueLimit: 50,
        connectTimeout: 10_000,
        typeCast(field, next) {
            if (field.type === 'TINY' && field.length === 1) return field.string() === '1';
            if (field.type.includes('DECIMAL')) {
                const valor = field.string();
                return valor === null ? null : Number(valor);
            }
            return next();
        },
    });
}
