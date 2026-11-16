import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { criarRotasAdministrativas } from './controller/adminController.js';
import { criarRotasDoPaciente } from './controller/pacienteController.js';
import { criarRotasPublicas } from './controller/publicoController.js';
import { criarAutenticacao } from './middlewares/autenticacao.js';
import { assincrono, rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';
import { criarLimites } from './middlewares/limites.js';
import { criarRepositorio } from './repository/consultaRepository.js';
import { criarAuthService } from './services/authService.js';
import { criarEmailService } from './services/emailService.js';
import { criarIntegracoes } from './services/integracoesService.js';
import { logger } from './utils/logger.js';

/**
 * Identifica cada requisição e registra seu desfecho. O log usa o padrão da rota
 * (ex.: /consultasCpf/:cpf) e nunca a URL real, que carrega CPF de paciente.
 */
function registrarRequisicao(req, res, next) {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);

    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
        logger.info('requisicao', {
            requestId: req.id,
            metodo: req.method,
            rota: req.route ? req.baseUrl + req.route.path : null,
            status: res.statusCode,
            duracaoMs: Number((process.hrtime.bigint() - inicio) / 1_000_000n),
        });
    });
    next();
}

/**
 * Monta a aplicação Express. O pool do MySQL, o transporte de e-mail, os limites de
 * requisição e a função de requisição HTTP a serviços externos são recebidos prontos
 * para que os testes possam exercitar a API inteira sem infraestrutura real.
 */
export function criarApp({ config, pool, transporteEmail, limites = criarLimites(), buscar = fetch }) {
    const repositorio = criarRepositorio(pool);
    const auth = criarAuthService({ repositorio, config });
    const email = criarEmailService({ transporte: transporteEmail, remetente: config.email.usuario });
    const integracoes = criarIntegracoes({ chaves: config.integracoes, buscar });
    const autenticacao = criarAutenticacao(auth);

    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.confiarEmProxies);

    app.use(registrarRequisicao);
    app.use(helmet());
    app.use(cors({
        origin: config.corsOrigens,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 600,
    }));
    app.use(express.json({ limit: '10kb' }));

    app.get('/health', assincrono(async (req, res) => {
        try {
            await repositorio.verificarConexao();
            res.json({ status: 'ok' });
        } catch {
            res.status(503).json({ status: 'indisponivel' });
        }
    }));

    app.use(criarRotasPublicas({ repositorio, auth, integracoes, limites }));
    app.use(criarRotasDoPaciente({ repositorio, email, autenticacao, limites }));
    // Deve ser o último router: tudo o que chega até ele exige token de administrador.
    app.use(criarRotasAdministrativas({ repositorio, email, autenticacao, limites }));

    app.use(rotaNaoEncontrada);
    app.use(tratarErros);

    return app;
}
