import { setTimeout as esperar } from 'node:timers/promises';

const TEMPO_LIMITE_MS = 10_000;
const TENTATIVAS_EM_DEADLOCK = 4;

const LISTAGEM_DE_CONSULTAS = `
    SELECT a.dia_horario, p.nome, p.rg, p.nascimento, p.cpf, p.email,
           c.tratamento, c.condicao, c.medicacao, c.preco, c.finalizada, c.metodo_consulta,
           c.id_consulta AS id
      FROM consulta c
      JOIN tb_agenda a ON c.id_agenda = a.id_agenda
      JOIN tb_auto_cadastro p ON c.id_paciente = p.id_paciente`;

/**
 * Acesso a dados. Todas as queries usam prepared statements (`execute`), então os
 * parâmetros nunca são interpolados no SQL.
 */
export function criarRepositorio(pool) {
    const executar = async (sql, parametros = []) => {
        for (let tentativa = 1; ; tentativa++) {
            try {
                const [resultado] = await pool.execute({ sql, timeout: TEMPO_LIMITE_MS }, parametros);
                return resultado;
            } catch (erro) {
                // Inserts condicionais simultâneos podem entrar em deadlock; o InnoDB desfaz um
                // deles por inteiro, então repetir o comando é seguro e é o tratamento indicado.
                if (erro.code !== 'ER_LOCK_DEADLOCK' || tentativa === TENTATIVAS_EM_DEADLOCK) throw erro;
                await esperar(tentativa * 20 + Math.random() * 30);
            }
        }
    };

    return {
        async verificarConexao() {
            await executar('SELECT 1');
        },

        // ---- Login ----

        async buscarLoginPorEmail(email) {
            const [usuario] = await executar('SELECT id_login, senha FROM tb_login WHERE email = ? LIMIT 1', [email]);
            return usuario ?? null;
        },

        // ---- Pacientes ----

        /** Insere o paciente somente se CPF e telefone ainda não existem. Retorna o id ou null. */
        async inserirPaciente({ nome, nascimento, rg, cpf, telefone, email }) {
            const resultado = await executar(
                `INSERT INTO tb_auto_cadastro (nome, nascimento, rg, cpf, telefone, email)
                 SELECT ?, ?, ?, ?, ?, ? FROM DUAL
                  WHERE NOT EXISTS (SELECT 1 FROM tb_auto_cadastro WHERE cpf = ? OR telefone = ?)`,
                [nome, nascimento, rg, cpf, telefone, email, cpf, telefone],
            );
            return resultado.affectedRows > 0 ? resultado.insertId : null;
        },

        async buscarIdPacientePorCpf(cpf) {
            const [paciente] = await executar('SELECT id_paciente FROM tb_auto_cadastro WHERE cpf = ? LIMIT 1', [cpf]);
            return paciente?.id_paciente ?? null;
        },

        async telefoneExiste(telefone) {
            const linhas = await executar('SELECT 1 FROM tb_auto_cadastro WHERE telefone = ? LIMIT 1', [telefone]);
            return linhas.length > 0;
        },

        async buscarContatoDoPaciente(idPaciente) {
            const [paciente] = await executar('SELECT nome, email FROM tb_auto_cadastro WHERE id_paciente = ?', [idPaciente]);
            return paciente ?? null;
        },

        // ---- Agenda ----

        /**
         * Reserva um horário e retorna o id da agenda, ou null se já estiver ocupado.
         *
         * O insert condicional impede que duas requisições simultâneas criem o mesmo horário.
         * Um horário existente só é reaproveitado quando ficou órfão (sem consulta e sem título),
         * o que acontece se um agendamento anterior falhou depois desta etapa.
         */
        async reservarHorario(diaHorario) {
            const resultado = await executar(
                `INSERT INTO tb_agenda (dia_horario)
                 SELECT ? FROM DUAL
                  WHERE NOT EXISTS (SELECT 1 FROM tb_agenda WHERE dia_horario = ?)`,
                [diaHorario, diaHorario],
            );
            if (resultado.affectedRows > 0) return resultado.insertId;

            const [orfao] = await executar(
                `SELECT a.id_agenda
                   FROM tb_agenda a
                  WHERE a.dia_horario = ?
                    AND a.titulo IS NULL
                    AND NOT EXISTS (SELECT 1 FROM consulta c WHERE c.id_agenda = a.id_agenda)
                  LIMIT 1`,
                [diaHorario],
            );
            return orfao?.id_agenda ?? null;
        },

        listarHorariosOcupados(dia) {
            return executar(
                `SELECT TIME(dia_horario) AS hora
                   FROM tb_agenda
                  WHERE dia_horario >= ? AND dia_horario < ? + INTERVAL 1 DAY`,
                [dia, dia],
            );
        },

        listarAgenda() {
            return executar('SELECT dia_horario, titulo, id_agenda FROM tb_agenda');
        },

        buscarEstadoDaAgenda(idAgenda) {
            return executar(
                `SELECT c.finalizada, c.id_consulta, c.id_paciente, c.id_agenda, a.dia_horario
                   FROM consulta c
                   JOIN tb_agenda a ON c.id_agenda = a.id_agenda
                  WHERE a.id_agenda = ?`,
                [idAgenda],
            );
        },

        /** Remove um horário sem consulta vinculada. Retorna 'removida', 'em_uso' ou 'inexistente'. */
        async removerAgenda(idAgenda) {
            const resultado = await executar(
                `DELETE FROM tb_agenda
                  WHERE id_agenda = ?
                    AND NOT EXISTS (SELECT 1 FROM consulta c WHERE c.id_agenda = tb_agenda.id_agenda)`,
                [idAgenda],
            );
            if (resultado.affectedRows > 0) return 'removida';

            const linhas = await executar('SELECT 1 FROM tb_agenda WHERE id_agenda = ?', [idAgenda]);
            return linhas.length > 0 ? 'em_uso' : 'inexistente';
        },

        // ---- Consultas ----

        /**
         * Cria a consulta somente se agenda e paciente existem, o horário ainda não tem consulta
         * e o paciente não tem outra em aberto. Retorna o id ou null.
         */
        async criarConsulta({ idAgenda, idPaciente, tratamento, condicao, medicacao, preco, metodo }) {
            const resultado = await executar(
                `INSERT INTO consulta
                        (id_agenda, tratamento, condicao, medicacao, preco, id_paciente, finalizada, metodo_consulta)
                 SELECT ?, ?, ?, ?, ?, ?, false, ? FROM DUAL
                  WHERE EXISTS (SELECT 1 FROM tb_agenda WHERE id_agenda = ?)
                    AND EXISTS (SELECT 1 FROM tb_auto_cadastro WHERE id_paciente = ?)
                    AND NOT EXISTS (SELECT 1 FROM consulta
                                     WHERE id_agenda = ? OR (id_paciente = ? AND finalizada = false))`,
                [idAgenda, tratamento, condicao, medicacao, preco, idPaciente, metodo,
                    idAgenda, idPaciente, idAgenda, idPaciente],
            );
            return resultado.affectedRows > 0 ? resultado.insertId : null;
        },

        async registrarCadastrado({ idPaciente, metodo, idAgenda }) {
            const resultado = await executar(
                'INSERT INTO tb_cadastrado (id_paciente, metodo_consulta, id_agenda) VALUES (?, ?, ?)',
                [idPaciente, metodo, idAgenda],
            );
            return resultado.insertId;
        },

        listarConsultasPorSituacao(finalizada) {
            return executar(
                `${LISTAGEM_DE_CONSULTAS} WHERE c.finalizada = ? ORDER BY a.dia_horario ${finalizada ? 'DESC' : 'ASC'}`,
                [finalizada],
            );
        },

        listarConsultasPorPrefixoDeCpf(prefixo) {
            return executar(`${LISTAGEM_DE_CONSULTAS} WHERE p.cpf LIKE ?`, [`${prefixo}%`]);
        },

        listarTodasAsConsultas() {
            return executar(`${LISTAGEM_DE_CONSULTAS} ORDER BY a.dia_horario`);
        },

        listarConsultasDoPaciente(idPaciente) {
            return executar(
                `SELECT a.dia_horario
                   FROM tb_agenda a
                   JOIN consulta c ON a.id_agenda = c.id_agenda
                  WHERE c.id_paciente = ?`,
                [idPaciente],
            );
        },

        async buscarConsultaAbertaPorCpf(cpf) {
            const [consulta] = await executar(
                `SELECT c.id_consulta
                   FROM tb_auto_cadastro p
                   JOIN consulta c ON p.id_paciente = c.id_paciente
                  WHERE p.cpf = ? AND c.finalizada = false
                  LIMIT 1`,
                [cpf],
            );
            return consulta ?? null;
        },

        listarSituacaoDasConsultasPorCpf(cpf) {
            return executar(
                `SELECT c.finalizada
                   FROM consulta c
                   JOIN tb_auto_cadastro p ON c.id_paciente = p.id_paciente
                  WHERE p.cpf = ?`,
                [cpf],
            );
        },

        async atualizarConsulta(idConsulta, { tratamento, condicao, medicacao, preco }) {
            const resultado = await executar(
                'UPDATE consulta SET tratamento = ?, condicao = ?, medicacao = ?, preco = ? WHERE id_consulta = ?',
                [tratamento, condicao, medicacao, preco, idConsulta],
            );
            return resultado.affectedRows;
        },

        /** Finaliza as consultas em aberto do paciente. Retorna quantas foram finalizadas. */
        async finalizarConsultasPorCpf(cpf) {
            const resultado = await executar(
                `UPDATE consulta c
                   JOIN tb_auto_cadastro p ON c.id_paciente = p.id_paciente
                    SET c.finalizada = true
                  WHERE p.cpf = ? AND c.finalizada = false`,
                [cpf],
            );
            return resultado.affectedRows;
        },

        // ---- Financeiro ----

        listarFaturamentoMensal(ano) {
            return executar(
                `SELECT MONTH(a.dia_horario) AS mes, SUM(c.preco) AS valor_arrecadado
                   FROM consulta c
                   JOIN tb_agenda a ON c.id_agenda = a.id_agenda
                  WHERE a.dia_horario >= ? AND a.dia_horario < ?
                  GROUP BY MONTH(a.dia_horario)
                  ORDER BY mes`,
                [`${ano}-01-01`, `${ano + 1}-01-01`],
            );
        },

        listarFaturamentoDoMes(mes, ano) {
            return executar(
                `SELECT MONTH(a.dia_horario) AS mes, YEAR(a.dia_horario) AS ano, SUM(c.preco) AS valor_total
                   FROM consulta c
                   JOIN tb_agenda a ON c.id_agenda = a.id_agenda
                  WHERE MONTH(a.dia_horario) = ? AND YEAR(a.dia_horario) = ?
                  GROUP BY ano, mes`,
                [mes, ano],
            );
        },
    };
}
