import nodemailer from 'nodemailer';
import { ErroHttp } from '../utils/erroHttp.js';

const CLINICA = 'Clínica Geral Dr. João Silva';
const LOGO = 'https://i.ibb.co/02hWXRb/logo3-removebg-preview-5.png';
const TELEFONE = '(11) 98125-6503';

const ESTILO_BASE = `
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; color: #333; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
    h1 { color: #0B9DEB; text-align: center; }
    p { font-size: 16px; color: #333; line-height: 1.5; }
    .footer { margin-top: 30px; text-align: center; color: #999; font-size: 14px; }
    .footer a { color: #0B9DEB; text-decoration: none; }`;

const ESTILO_CONFIRMACAO = `
    .header { background-color: #0B9DEB; padding: 20px; border-radius: 10px 10px 0 0; }
    .header img { display: block; margin: 0 auto; max-width: 150px; }
    .header h2 { color: #FFFFFF; text-align: center; margin-top: 10px; }`;

const ESTILO_LINK = `
    .header { background-color: #0B9DEB; padding: 20px; border-radius: 10px 10px 0 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .header img { max-width: 50px; margin-bottom: 10px; }
    .header h2 { margin: 0; font-size: 20px; color: #f4f4f4; }
    .link-container { text-align: center; margin-top: 20px; }
    .link-consulta { display: inline-block; background-color: #0B9DEB; color: #ffffff; padding: 10px 20px; border-radius: 5px; font-weight: bold; text-decoration: none; font-size: 16px; transition: background-color 0.3s ease; }
    .link-consulta:hover { background-color: #097bb5; }`;

const ENTIDADES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Todo valor externo passa por aqui antes de entrar no HTML do e-mail. */
export const escaparHtml = (valor) => String(valor).replace(/[&<>"']/g, (caractere) => ENTIDADES[caractere]);

function montarPagina({ estilo, corpo, rodape }) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmação de Consulta - Dr. João Silva</title>
  <style>${ESTILO_BASE}${estilo}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO}" alt="Logo da Clínica">
      <h2>${CLINICA}</h2>
    </div>
    ${corpo}
    <div class="footer">
      <p>${CLINICA} - Rua da Saúde, 123, Centro</p>
      <p>${rodape}</p>
    </div>
  </div>
</body>
</html>`;
}

/** Transporte SMTP único da aplicação: conexões reaproveitadas, TLS verificado e timeouts. */
export function criarTransporteSmtp({ host, port, usuario, senha }) {
    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user: usuario, pass: senha },
        pool: true,
        maxConnections: 2,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
    });
}

export function criarEmailService({ transporte, remetente }) {
    const enviar = async (para, html) => {
        try {
            await transporte.sendMail({ from: remetente, to: para, subject: 'Consulta agendada', html });
        } catch (erro) {
            throw new ErroHttp(502, 'Não foi possível enviar o e-mail.', { cause: erro });
        }
    };

    return {
        enviarConfirmacao({ nome, email, data, horario }) {
            const corpo = `<h1>Confirmação de Consulta</h1>
    <p>Caro(a) ${escaparHtml(nome)},</p>
    <p>Estamos enviando esta mensagem para confirmar que sua consulta foi agendada com sucesso!</p>
    <p><strong>Detalhes da Consulta:</strong></p>
    <ul>
      <li><strong>Médico:</strong> Dr. João Silva</li>
      <li><strong>Data:</strong> ${escaparHtml(data)}</li>
      <li><strong>Horário:</strong> ${escaparHtml(horario)}</li>
      <li><strong>Local:</strong> Doctor's Health, Rua Astolfo Vila, 389.</li>
    </ul>
    <p>Por favor, chegue com 15 minutos de antecedência e traga seus documentos de identificação e exames prévios, se houver.</p>
    <p>Se precisar cancelar ou reagendar, entre em contato conosco pelo telefone <strong>${TELEFONE}</strong> ou responda este email.</p>`;

            return enviar(email, montarPagina({
                estilo: ESTILO_CONFIRMACAO,
                corpo,
                rodape: `Telefone: ${TELEFONE} Email: ${escaparHtml(remetente)}`,
            }));
        },

        enviarLinkDaConsulta({ nome, email, link }) {
            const corpo = `<h1>Acesse sua Consulta Online</h1>
    <p>Caro(a) ${escaparHtml(nome)},</p>
    <p>Estamos enviando este e-mail para informar que sua consulta está agendada.</p>
    <p>Para acessar sua consulta online, clique no botão abaixo:</p>
    <div class="link-container">
      <a class="link-consulta" href="${escaparHtml(link)}">Acesse por aqui!</a>
    </div>`;

            return enviar(email, montarPagina({ estilo: ESTILO_LINK, corpo, rodape: `Telefone: ${TELEFONE}` }));
        },
    };
}
