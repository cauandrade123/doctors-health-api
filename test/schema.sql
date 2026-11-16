-- Esquema INFERIDO a partir das queries da API, usado somente pelos testes de integração.
-- O esquema real de produção não está versionado neste repositório; tipos e tamanhos aqui são suposições.

CREATE TABLE tb_login (
    id_login INT AUTO_INCREMENT PRIMARY KEY,
    email    VARCHAR(255) NOT NULL,
    senha    VARCHAR(255) NOT NULL
);

CREATE TABLE tb_auto_cadastro (
    id_paciente INT AUTO_INCREMENT PRIMARY KEY,
    nome        VARCHAR(150),
    nascimento  DATE,
    rg          VARCHAR(20),
    cpf         VARCHAR(14),
    telefone    VARCHAR(20),
    email       VARCHAR(255)
);

CREATE TABLE tb_agenda (
    id_agenda   INT AUTO_INCREMENT PRIMARY KEY,
    dia_horario DATETIME,
    titulo      VARCHAR(100)
);

CREATE TABLE consulta (
    id_consulta     INT AUTO_INCREMENT PRIMARY KEY,
    id_agenda       INT,
    id_paciente     INT,
    tratamento      VARCHAR(255),
    condicao        VARCHAR(255),
    medicacao       VARCHAR(255),
    preco           DECIMAL(10, 2),
    finalizada      BOOLEAN,
    metodo_consulta VARCHAR(30),
    FOREIGN KEY (id_agenda) REFERENCES tb_agenda (id_agenda),
    FOREIGN KEY (id_paciente) REFERENCES tb_auto_cadastro (id_paciente)
);

CREATE TABLE tb_cadastrado (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    id_paciente     INT,
    metodo_consulta VARCHAR(30),
    id_agenda       INT
);
