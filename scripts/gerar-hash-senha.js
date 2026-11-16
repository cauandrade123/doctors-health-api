// Gera o hash scrypt de uma senha para gravar em tb_login.senha.
// Uso: npm run hash-senha   (a senha é lida da entrada padrão, sem aparecer no histórico do shell)
import { createInterface } from 'node:readline/promises';
import { gerarHash } from '../src/utils/senha.js';

const leitor = createInterface({ input: process.stdin, output: process.stderr });
const senha = await leitor.question('Senha: ');
leitor.close();

if (!senha) {
    console.error('Senha vazia.');
    process.exit(1);
}

const hash = await gerarHash(senha);
console.log(hash);
console.error('\nGrave com:  UPDATE tb_login SET senha = \'<hash acima>\' WHERE email = \'<e-mail do administrador>\';');
console.error(`A coluna senha precisa comportar ${hash.length} caracteres.`);
