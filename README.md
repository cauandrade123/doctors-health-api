# Doctor's Health — API

Backend da clínica Doctor's Health: agendamento de consultas pelo paciente, painel
administrativo (consultas, agenda e faturamento) e notificações por e-mail.
É consumida pelo [doctors-health-frontend](https://github.com/cauandrade123/doctors-health-frontend).

- Node.js 20.12+ (ES Modules) e Express 4
- MySQL 8 (driver `mysql2`, prepared statements)
- JWT para autenticação e Nodemailer para e-mail

## Como rodar

```bash
npm install
cp .env.example .env   # preencha os valores
npm run dev            # reinicia a cada alteração
```

Em produção use `npm ci --omit=dev` e `npm start`, com as variáveis definidas no ambiente
da hospedagem (o `.env` é apenas para desenvolvimento e nunca deve ser versionado).

### Variáveis de ambiente

A API valida a configuração ao iniciar e **não sobe** se algo obrigatório faltar.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_DATABASE` | sim | Conexão com o banco |
| `MYSQL_PASSWORD` | em produção | Senha do banco |
| `MYSQL_PORT` | não (3306) | Porta do banco |
| `JWT_SECRET` | sim | Segredo dos tokens de administrador (mín. 32 caracteres) |
| `JWT_SECRET2` | sim | Segredo dos tokens de paciente (mín. 32 caracteres, diferente do anterior) |
| `EMAIL_USER`, `EMAIL_PASS` | sim | Conta SMTP (no Gmail, uma senha de app) |
| `EMAIL_HOST`, `EMAIL_PORT` | não (`smtp.gmail.com`, 465) | Servidor SMTP |
| `CORS_ORIGINS` | em produção | Origens do frontend separadas por vírgula (ou `*`) |
| `WIT_AI_TOKEN`, `VERIPHONE_API_KEY`, `HUNTER_API_KEY` | não | Chaves dos serviços de terceiros; sem a chave, a rota correspondente responde `503` |
| `PORT` | não (3000) | Porta HTTP (`PORTA` também é aceita) |
| `TRUST_PROXY` | não (0) | Quantidade de proxies reversos na frente da API |
| `NODE_ENV` | não | `production` ativa as exigências acima |
| `LOG_LEVEL` | não (`info`) | `debug`, `info`, `warn`, `error` ou `silent` |

Gere segredos com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Arquitetura

```
src/
  app.js                   ponto de entrada: configuração, pool, servidor HTTP, encerramento
  criarApp.js              monta o Express (segurança, rotas, erros)
  config.js                leitura e validação das variáveis de ambiente
  controller/              rotas HTTP, separadas por nível de acesso
    publicoController.js     login e fluxo de agendamento do paciente
    pacienteController.js    rotas com token de paciente
    adminController.js       painel; todas exigem token de administrador
  services/                regras: autenticação/tokens, e-mail e serviços de terceiros
  repository/              acesso ao MySQL
  middlewares/             autenticação, limites de requisição e tratamento de erros
  utils/                   validação de entrada, hash de senha e logger
```

Cada requisição passa por: cabeçalhos de segurança → CORS → limite de 10 kB no corpo →
rota (limite de requisições, autenticação, validação) → repositório. Qualquer erro termina
no handler central, que responde `{ "erro": "...", "requestId": "..." }` e registra os
detalhes apenas no log.

## Rotas

**Públicas** (limitadas por IP)

| Rota | Uso |
|---|---|
| `POST /login` | Login do administrador; retorna `{ token }` (expira em 8 h) |
| `POST /verificar-cpf`, `POST /verificar-telefone` | `{ existe }` |
| `GET /Id-do-paciente/:cpf`, `GET /verificarconsulta/:cpf` | Consulta de cadastro e de consulta em aberto |
| `POST /horarios-ocupados` | Horários ocupados em uma data |
| `POST /agenda` | Reserva um horário; `409` se ocupado |
| `POST /autocadastro` | Cadastra o paciente e retorna um token (expira em 5 h); `409` se CPF/telefone já existem |
| `POST /consultas` | Cria a consulta; `409` se o horário já tem consulta ou o paciente tem outra em aberto |
| `POST /cadastrado` | Registra o retorno de um paciente já cadastrado |
| `POST /validar-telefone`, `POST /validar-email` | Validação por serviço externo: `{ valido }` e `{ status }` |
| `POST /bot/interpretar` | Entidades reconhecidas em uma mensagem do chatbot: `{ entities }` |
| `GET /health` | Verificação de disponibilidade (inclui o banco) |

**Paciente** — `Authorization: Bearer <token do /autocadastro>`

| Rota | Uso |
|---|---|
| `GET /MinhasConsultas` | Consultas do paciente autenticado |
| `POST /enviar` | E-mail de confirmação, enviado para o e-mail do cadastro do paciente |

**Administrador** — `Authorization: Bearer <token do /login>`

| Rota | Uso |
|---|---|
| `GET /consultasFuturas`, `GET /consultasPassadas`, `GET /agenda/consultas` | Listagens |
| `GET /consultasCpf/:cpf` | Busca por prefixo de CPF |
| `PUT /consultas/:id` | Edita tratamento, condição, medicação e preço |
| `GET /consultaFinalizar/:cpf`, `PUT /finalizarConsulta/:cpf` | Situação e finalização das consultas do paciente |
| `GET /pegardata`, `GET /verfificarestadoFinalizadaAgenda/:id_agenda` | Agenda |
| `DELETE /remover/:id_agenda` | Remove um horário sem consulta vinculada (`409` caso contrário) |
| `GET /puxarfinanceiro/:ano`, `POST /financeiro` | Faturamento por mês |
| `POST /enviar-call` | E-mail com o link da teleconsulta (somente `https://meet.jit.si/...`) |

As rotas de validação e do chatbot existem para que as chaves dos serviços de terceiros
(veriphone.io, hunter.io e wit.ai) fiquem somente no servidor: o navegador chama a API, e a
API chama o serviço, com destino fixo, limite de 5 s e limite de requisições por IP.

## Senha do administrador

O login aceita senha com hash **scrypt** e, para não exigir migração imediata, a senha
antiga em texto puro. Para migrar:

```bash
npm run hash-senha
```

Grave o hash exibido em `tb_login.senha` (a coluna precisa comportar 83 caracteres).
Veja `docs/migracoes-recomendadas.sql`.

## Testes

```bash
npm run lint
npm test
```

Os testes de unidade e de API não precisam de infraestrutura. Os de integração rodam
contra um MySQL real quando `TEST_MYSQL_DATABASE` está definida — o banco indicado é
**apagado e recriado**, e por segurança o nome precisa terminar em `_teste`:

```bash
TEST_MYSQL_DATABASE=doctors_teste TEST_MYSQL_USER=root TEST_MYSQL_PASSWORD=... npm test
```

O schema usado por eles (`test/schema.sql`) foi inferido das queries; o schema de produção
não está versionado neste repositório.

## Checklist de deploy

1. Definir todas as variáveis obrigatórias, com segredos novos (os antigos já foram
   expostos no histórico deste repositório e devem ser considerados comprometidos).
2. Publicar antes a versão do frontend que envia o token nas chamadas do painel.
3. Atrás de proxy ou balanceador, ajustar `TRUST_PROXY` para o limite por IP funcionar.
4. Servir a API por HTTPS: os tokens trafegam no cabeçalho `Authorization`.
5. Aplicar as migrações de `docs/migracoes-recomendadas.sql`.
6. Com mais de uma instância, trocar o contador do limite de requisições (em memória)
   por um store compartilhado.
