-- Migrações RECOMENDADAS para o banco de produção.
--
-- Nada aqui é executado pela API. Revise, faça backup e aplique manualmente.
-- O esquema real não está versionado neste repositório: confira os nomes e tipos das
-- colunas antes de rodar (SHOW CREATE TABLE <tabela>).
--
-- Por que aplicar: a API já impede duplicidade com inserts condicionais, mas a garantia
-- definitiva contra corrida é do banco. Os índices também tornam as buscas por CPF,
-- telefone e data diretas, em vez de varrer a tabela inteira.

-- 1) Antes de criar índices únicos, verifique se já existem duplicados.
--    Cada consulta abaixo precisa retornar zero linhas.
SELECT cpf, COUNT(*) AS total FROM tb_auto_cadastro GROUP BY cpf HAVING total > 1;
SELECT telefone, COUNT(*) AS total FROM tb_auto_cadastro GROUP BY telefone HAVING total > 1;
SELECT dia_horario, COUNT(*) AS total FROM tb_agenda GROUP BY dia_horario HAVING total > 1;
SELECT id_agenda, COUNT(*) AS total FROM consulta GROUP BY id_agenda HAVING total > 1;
SELECT email, COUNT(*) AS total FROM tb_login GROUP BY email HAVING total > 1;

-- 2) Unicidade de paciente, horário, consulta por horário e login.
ALTER TABLE tb_auto_cadastro ADD UNIQUE INDEX uq_paciente_cpf (cpf);
ALTER TABLE tb_auto_cadastro ADD UNIQUE INDEX uq_paciente_telefone (telefone);
ALTER TABLE tb_agenda ADD UNIQUE INDEX uq_agenda_dia_horario (dia_horario);
ALTER TABLE consulta ADD UNIQUE INDEX uq_consulta_agenda (id_agenda);
ALTER TABLE tb_login ADD UNIQUE INDEX uq_login_email (email);

-- 3) Índice para as listagens do painel e para a checagem de consulta em aberto.
--    (Dispensável se consulta.id_paciente já tiver índice por ser chave estrangeira.)
ALTER TABLE consulta ADD INDEX ix_consulta_paciente_situacao (id_paciente, finalizada);

-- 4) Senha do administrador com hash.
--    O hash gerado por `npm run hash-senha` tem 83 caracteres.
ALTER TABLE tb_login MODIFY senha VARCHAR(255) NOT NULL;
-- UPDATE tb_login SET senha = '<hash gerado>' WHERE email = '<e-mail do administrador>';
