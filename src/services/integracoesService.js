import { ErroHttp } from '../utils/erroHttp.js';

const TEMPO_LIMITE_MS = 5_000;
const VERSAO_DA_API_WIT = '20241016';

/**
 * Serviços de terceiros usados pelo site (validação de telefone e e-mail, e o
 * interpretador de mensagens do chatbot). As chaves ficam somente no servidor: o
 * navegador chama a API, e a API chama o serviço.
 *
 * Os destinos são fixos — o cliente só fornece valores de parâmetros — e nenhuma URL é
 * registrada em log, porque duas delas carregam a chave na query string.
 */
export function criarIntegracoes({ chaves, buscar = fetch }) {
    const exigirChave = (chave) => {
        if (!chave) throw new ErroHttp(503, 'Serviço não configurado.');
        return chave;
    };

    async function buscarJson(endereco, parametros, cabecalhos) {
        const url = new URL(endereco);
        for (const [nome, valor] of Object.entries(parametros)) url.searchParams.set(nome, valor);

        try {
            const resposta = await buscar(url, {
                headers: cabecalhos,
                redirect: 'error',
                signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
            });
            if (!resposta.ok) throw new Error(`Resposta HTTP ${resposta.status}`);
            return await resposta.json();
        } catch (erro) {
            throw new ErroHttp(502, 'Serviço externo indisponível.', { cause: erro });
        }
    }

    return {
        /** `digitos`: DDD + número, apenas dígitos. */
        async telefoneEhValido(digitos) {
            const chave = exigirChave(chaves.veriphone);
            const dados = await buscarJson('https://api.veriphone.io/v2/verify', { phone: `55${digitos}`, key: chave });
            return dados?.phone_valid === true;
        },

        /** Situação informada pelo verificador: "valid", "invalid", "unknown" etc. */
        async situacaoDoEmail(email) {
            const chave = exigirChave(chaves.hunter);
            const dados = await buscarJson('https://api.hunter.io/v2/email-verifier', { email, api_key: chave });
            return typeof dados?.data?.status === 'string' ? dados.data.status : 'unknown';
        },

        /** Entidades reconhecidas na mensagem, no formato devolvido pelo wit.ai. */
        async interpretarMensagem(mensagem) {
            const token = exigirChave(chaves.wit);
            const dados = await buscarJson(
                'https://api.wit.ai/message',
                { v: VERSAO_DA_API_WIT, q: mensagem },
                { Authorization: `Bearer ${token}` },
            );
            return dados?.entities && typeof dados.entities === 'object' ? dados.entities : {};
        },
    };
}
