/** Erro operacional previsto: a mensagem é segura para ser devolvida ao cliente. */
export class ErroHttp extends Error {
    constructor(status, mensagem, opcoes) {
        super(mensagem, opcoes);
        this.name = 'ErroHttp';
        this.status = status;
    }
}
