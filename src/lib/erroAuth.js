// Tradução das mensagens de erro do Supabase Auth para português amigável.
// Extraído de Login.jsx (21/08) para o fluxo de REDEFINIR SENHA reusar — antes só o Login
// traduzia, e a tela de nova senha mostrava senha-vazada/rate-limit CRUS em inglês (beco sem
// saída). Regra de negócio de texto duplicada em dois lugares é como não ter: fonte única aqui.
export function traduzErroAuth(msg = '') {
  const m = String(msg);
  if (/invalid login credentials/i.test(m)) return 'Email ou senha incorretos.';
  if (/email not confirmed/i.test(m)) return 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada e o spam, ou reenvie a confirmação abaixo.';
  if (/already registered|already been registered/i.test(m)) return 'Este e-mail já está cadastrado. Faça login ou recupere a senha.';
  if (/password should be at least/i.test(m)) return 'A senha é muito curta. Use ao menos 8 caracteres.';
  // Senha VAZADA (HaveIBeenPwned) — não é regra de complexidade: a pessoa cumpre os 5 requisitos
  // e mesmo assim é recusada. Sem esta linha caía em inglês na tela.
  if (/known to be weak|pwned|leaked password/i.test(m)) return 'Esta senha apareceu em vazamentos públicos e não pode ser usada. Escolha outra — ela pode cumprir todos os requisitos e ainda assim ser conhecida.';
  // "Database error saving new user" (30/08). O perfil nasce no trigger `handle_new_user`,
  // então QUALQUER exceção lá dentro — hoje, na prática, o índice único de telefone ou de CPF —
  // volta ao navegador com essa frase em inglês. Não dá para saber daqui QUAL foi a violação
  // (o Supabase Auth achata tudo numa mensagem só), por isso o texto aponta a causa mais
  // provável e a saída, sem AFIRMAR qual campo repetiu. O aviso preciso é o do formulário, que
  // consulta antes de enviar; esta linha é a rede para quando ele não rodou (Enter direto,
  // corrida entre dois cadastros no mesmo segundo).
  if (/database error saving new user/i.test(m)) return 'Não conseguimos criar a conta. A causa mais comum é telefone ou CPF já cadastrado — se você já tem conta aqui, faça login ou recupere a senha. Se não for o caso, fale com o suporte.';
  if (/email rate limit|over_email_send_rate/i.test(m)) return 'Muitas tentativas de envio de e-mail. Aguarde alguns minutos e tente novamente.';
  if (/for security purposes|rate limit|too many requests/i.test(m)) return 'Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.';
  if (/invalid email|unable to validate email|email address.*invalid/i.test(m)) return 'E-mail inválido. Confira o endereço digitado.';
  if (/new password should be different/i.test(m)) return 'A nova senha deve ser diferente da anterior.';
  if (/same_password|should be different from the old/i.test(m)) return 'A nova senha deve ser diferente da anterior.';
  return m || 'Ocorreu um erro. Tente novamente.';
}
