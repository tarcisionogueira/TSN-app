-- 30/08 — `telefone_existe(text)`: avisar ANTES, em vez de estourar a trava DEPOIS
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Companheira de `telefone_unico_no_cadastro.sql`. O índice único criado lá impede o
-- duplicado, mas o impedimento chega ao cliente da PIOR forma possível: o perfil nasce no
-- trigger `handle_new_user`, então a violação estoura DENTRO do `auth.signUp` e o Supabase
-- devolve "Database error saving new user". Mensagem técnica na cara de quem está tentando
-- entrar é exatamente o que faz a pessoa recadastrar com outro e-mail — que é COMO OS DOIS
-- DUPLICADOS DO ACERVO NASCERAM (Igor 06/07, Fabrício 30/08). A trava sem o aviso protege o
-- banco e produz o comportamento que ela deveria evitar.
--
-- A NORMALIZAÇÃO AQUI É A MESMA DO ÍNDICE, e tem que ser: `(11) 99999-0001` e `11999990001`
-- são o mesmo número e strings diferentes. Comparar a coluna crua faria a checagem responder
-- "livre" para um telefone que o índice vai recusar meio segundo depois — o aviso mentiria e
-- o cadastro quebraria assim mesmo.
--
-- QUEM PODE CHAMAR: só o `service_role`. `perfis.telefone` é PII, e uma função aberta ao
-- `anon` que responde sim/não sobre um número vira oráculo de enumeração — dá para varrer
-- faixas de celular e descobrir quem é cliente. O acesso é pelo endpoint
-- `api/verificar-cpf.js`, que já tem limite por IP e usa a service key no servidor.
create or replace function public.telefone_existe(p_telefone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis
     where telefone is not null
       and regexp_replace(telefone, '\D', '', 'g') = regexp_replace(coalesce(p_telefone,''), '\D', '', 'g')
       and length(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g')) >= 10
  );
$$;

revoke all on function public.telefone_existe(text) from public, anon, authenticated;
grant execute on function public.telefone_existe(text) to service_role;
