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
  // Domínio de e-mail descartável (16/09) — trigger `trg_bloquear_email_descartavel` em
  // auth.users. Checado ANTES do "database error saving new user" genérico abaixo, senão essa
  // regex mais ampla (que também casa "Database error saving new user") capturaria primeiro e
  // mostraria o texto errado (aponta telefone/CPF, não domínio de e-mail).
  if (/dominio_email_bloqueado/i.test(m)) return 'Este domínio de e-mail não é aceito para cadastro. Use um e-mail pessoal ou corporativo.';
  if (/database error saving new user/i.test(m)) return 'Não conseguimos criar a conta. A causa mais comum é telefone ou CPF já cadastrado — se você já tem conta aqui, faça login ou recupere a senha. Se não for o caso, fale com o suporte.';
  if (/email rate limit|over_email_send_rate/i.test(m)) return 'Muitas tentativas de envio de e-mail. Aguarde alguns minutos e tente novamente.';
  if (/for security purposes|rate limit|too many requests/i.test(m)) return 'Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.';
  if (/invalid email|unable to validate email|email address.*invalid/i.test(m)) return 'E-mail inválido. Confira o endereço digitado.';
  if (/new password should be different/i.test(m)) return 'A nova senha deve ser diferente da anterior.';
  if (/same_password|should be different from the old/i.test(m)) return 'A nova senha deve ser diferente da anterior.';
  // GUARDA CONTRA TEXTO CRU NÃO-HUMANO (14/09, achado no ritual de abertura): medido em produção
  // — 2 pessoas viram literalmente "{}" na tela (11 de 17 recusas de cadastro em 7 dias) e
  // clicaram de novo repetidas vezes (8x e 3x em menos de 2 minutos cada) tentando entender o
  // que aconteceu. `err.message` do Supabase Auth às vezes vem vazio/objeto quando o corpo da
  // resposta não tem o formato esperado (ex.: rate limit num nível que não devolve JSON do
  // GoTrue) — sem esta guarda, esse lixo caía direto no `return m || ...` de baixo.
  if (!m.trim() || /^[{[]/.test(m.trim())) return 'Ocorreu um erro. Tente novamente em instantes ou fale com o suporte.';
  return m;
}

// MOTIVO DE VERDADE pro monitoramento, não só pro usuário (14/09, generalizado do fix de
// `cadastro_falha` em Login.jsx pro resto da base). Mesma causa raiz vale pra QUALQUER chamada
// de `supabase.auth.*` (login, cadastro, recuperação de senha, nova senha, OAuth): a lib
// (@supabase/auth-js/src/lib/fetch.ts, _getErrorMessage) cai para `JSON.stringify(err)` quando
// o corpo não tem `msg`/`message`/`error_description`/`error` — um corpo vazio vira "{}"
// literal, zero diagnóstico. Mas a MESMA lib extrai um `code` estável À PARTE
// (`data.code`/`data.error_code` — "weak_password", "over_email_send_rate_limit",
// "email_exists"...) que sobrevive mesmo quando `.message` falha. Usar em TODO catch de
// `supabase.auth.*` que loga pra `eventos_atividade`/`erros_cliente` — sem isto, cada tela
// reinventa (ou esquece) a mesma extração, e o gap volta um catch de cada vez.
export function motivoErroAuth(err) {
  const partes = [];
  if (err?.status) partes.push(`status=${err.status}`);
  if (err?.code) partes.push(`code=${err.code}`);
  const msg = String(err?.message || '').trim();
  if (msg && !/^[{[]/.test(msg)) partes.push(msg);
  return (partes.join(' · ') || '(sem mensagem)').slice(0, 150);
}
