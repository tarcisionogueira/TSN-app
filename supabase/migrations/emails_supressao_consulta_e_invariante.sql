-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O GATE DE SUPRESSÃO: A CONSULTA E O VIGIA — 27/08/2026
-- Complementa `emails_supressao_nao_insistir_em_endereco_morto.sql`. Duas peças.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ─── 1. A CONSULTA DO GATE ───────────────────────────────────────────────────────────────
-- Recebe ARRAY em corpo JSON, e não lista na URL (`?destinatario=in.(...)`), que é a
-- convenção do resto do repo. O motivo é específico de e-mail: um endereço com '+' —
-- `user+tag@gmail.com`, forma comum e válida — vira ESPAÇO ao decodificar uma query string.
-- O filtro não casaria, a consulta devolveria "ninguém suprimido", e o endereço morto
-- receberia o e-mail. Ou seja: o gate falharia exatamente do jeito silencioso que ele existe
-- para consertar. Corpo JSON não tem esse degrau.
create or replace function public.emails_suprimidos(p_destinatarios text[])
returns table(destinatario text)
language sql stable security definer set search_path to 'public' as $$
  select s.destinatario
    from public.emails_supressao s
   where s.suprimido
     and s.destinatario = any (select lower(btrim(x)) from unnest(p_destinatarios) x);
$$;

revoke all on function public.emails_suprimidos(text[]) from public, anon, authenticated;
grant execute on function public.emails_suprimidos(text[]) to service_role;


-- ─── 2. O VIGIA DO PRÓPRIO GATE ──────────────────────────────────────────────────────────
-- Um gate que fura NÃO DÁ ERRO: o e-mail sai, chega ao endereço morto e gasta reputação,
-- e nada na tela muda. Mesma lógica de `analise_vencida_nao_limpa` — um DELETE que não
-- apaga também não reclama. Conta e-mail enviado DEPOIS da supressão sem o carimbo
-- `status='suprimido'`; verde = 0.
create or replace function public.qa_invariantes_supressao()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)
    from public.emails_log l
    join public.emails_supressao s on s.destinatario = l.destinatario
   where s.suprimido and s.suprimido_em is not null
     and l.enviado_em > s.suprimido_em
     and coalesce(l.status, '') <> 'suprimido';
$$;

revoke all on function public.qa_invariantes_supressao() from public, anon;
grant execute on function public.qa_invariantes_supressao() to service_role, authenticated;


-- ─── 3. ENGATA O VIGIA EM qa_invariantes() ───────────────────────────────────────────────
-- Feito por âncora sobre o corpo VIVO da função, e não recopiando as ~90 linhas dela: uma
-- transcrição manual desse tamanho perde silenciosamente um invariante, e o resultado seria
-- um painel que fica verde por ter esquecido de olhar. Idempotente, e ABORTA se a âncora
-- não existir mais — melhor falhar alto do que gravar uma função corrompida.
do $$
declare
  d      text := pg_get_functiondef('public.qa_invariantes()'::regprocedure);
  ancora text := E'), 400)\n  )';
begin
  if position('email_para_endereco_suprimido' in d) > 0 then
    raise notice 'invariante ja presente — nada a fazer'; return;
  end if;
  if position(ancora in d) = 0 then
    raise exception 'ancora nao encontrada em qa_invariantes() — abortando para nao corromper a funcao';
  end if;

  execute replace(d, ancora,
    E'), 400),\n'
    '     -- 27/08: vigia do gate de supressao. Um envio que deveria ter sido barrado e nao\n'
    '     -- foi nao produz erro nenhum — so chega no endereco morto e gasta reputacao.\n'
    '     (''email_para_endereco_suprimido'',''E-mail enviado para endereco na lista de supressao (o gate furou)'',''Atendimento'',''bug'',\n'
    '       public.qa_invariantes_supressao(), 0)\n'
    '  )');
end $$;
