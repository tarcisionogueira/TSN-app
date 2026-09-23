-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Endereço corporativo AUTOMÁTICO da equipe: primeironome@bidprobrasil.com.br — 23/09/2026
--
-- Decisão do dono: "a equipe, quando enviar, deve sair pelo e-mail deles, no padrão primeiro
-- nome @bidprobrasil.com.br". Quem vira equipe (admin/analista/consultor/advogado, por role
-- ou funcao_equipe) ganha o endereço sozinho — sem depender de alguém lembrar de cadastrar.
--   · primeiro nome sem acento, minúsculo ("João" → joao@)
--   · já usado por outra pessoa → primeironome.sobrenome@ (último nome); ainda colide → +2, +3
--   · endereço existente NUNCA é trocado (quem já recebeu e-mail nele continua recebendo)
--   · nomes reservados de comunicação (suporte, contato…) são pulados pela CHECK da tabela
-- O advogado passa a ler a PRÓPRIA caixa pessoal (dono = ele); a de comunicação segue fora.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.slug_email(p text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(lower(translate(coalesce(p,''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]', '', 'g');
$$;

create or replace function public.garantir_email_equipe(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_nome text; v_eh_equipe boolean; v_ja text; v_prim text; v_ult text; v_cand text; n int := 1;
  reservados text[] := array['suporte','contato','privacidade','responda','naoresponda','noreply','alertas','juridico','resposta'];
begin
  select endereco into v_ja from equipe_email where user_id = p_user;
  if v_ja is not null then return v_ja; end if;
  select nome, (role in ('admin','analista','consultor','advogado') or funcao_equipe in ('admin','analista','consultor','advogado'))
    into v_nome, v_eh_equipe from perfis where id = p_user;
  if not coalesce(v_eh_equipe, false) or coalesce(trim(v_nome), '') = '' then return null; end if;
  v_prim := slug_email(split_part(trim(v_nome), ' ', 1));
  v_ult  := slug_email(regexp_replace(trim(v_nome), '^.*\s', ''));
  if v_prim = '' then return null; end if;
  v_cand := case when v_prim = any(reservados) then v_prim || '.' || v_ult else v_prim end;
  while exists (select 1 from equipe_email where endereco = v_cand || '@bidprobrasil.com.br') loop
    v_cand := case when n = 1 and v_ult <> '' and v_ult <> v_prim then v_prim || '.' || v_ult
                   else v_prim || '.' || v_ult || n end;
    n := n + 1;
    if n > 20 then return null; end if;
  end loop;
  insert into equipe_email (endereco, user_id) values (v_cand || '@bidprobrasil.com.br', p_user)
  on conflict (user_id) do nothing;
  select endereco into v_ja from equipe_email where user_id = p_user;
  return v_ja;
end $$;
revoke execute on function public.garantir_email_equipe(uuid) from public, anon, authenticated;
grant execute on function public.garantir_email_equipe(uuid) to service_role;

create or replace function public.trg_perfis_email_equipe()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.garantir_email_equipe(new.id);
  return new;
end $$;
revoke execute on function public.trg_perfis_email_equipe() from public, anon, authenticated;
drop trigger if exists perfis_email_equipe on public.perfis;
create trigger perfis_email_equipe after insert or update of role, funcao_equipe, nome on public.perfis
  for each row execute function public.trg_perfis_email_equipe();

-- Caixa PESSOAL: o dono lê/move a própria, mesmo sem acesso à de comunicação (advogado).
drop policy if exists email_caixa_equipe_le on public.email_caixa;
create policy email_caixa_equipe_le on public.email_caixa for select to authenticated
  using (dono = (select auth.uid()) or (dono is null and (select public.pode_caixa_email())));
drop policy if exists email_caixa_equipe_move on public.email_caixa;
create policy email_caixa_equipe_move on public.email_caixa for update to authenticated
  using (dono = (select auth.uid()) or (dono is null and (select public.pode_caixa_email())))
  with check (dono = (select auth.uid()) or (dono is null and (select public.pode_caixa_email())));
drop policy if exists equipe_email_le on public.equipe_email;
create policy equipe_email_le on public.equipe_email for select to authenticated
  using (user_id = (select auth.uid()) or (select public.pode_caixa_email()));

-- Backfill: quem já é equipe hoje.
select public.garantir_email_equipe(id) from public.perfis
 where role in ('admin','analista','consultor','advogado') or funcao_equipe in ('admin','analista','consultor','advogado');
