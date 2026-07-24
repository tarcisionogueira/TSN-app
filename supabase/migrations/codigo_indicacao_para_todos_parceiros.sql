-- Programa de Parceiros agora é para TODOS os usuários (não só consultores). O link de
-- indicação usava o UUID cru do usuário (…?ref=92c713f3-1f1a-4758-bab2-32e6c83da433) — longo e
-- deselegante. O código curto de indicação já existe (perfis.codigo_indicacao, resolvido por
-- vincular_upline) mas só podia ser gerado por consultores. Aqui ele passa a poder ser gerado
-- por QUALQUER usuário autenticado para o PRÓPRIO id, deixando o link enxuto (…?ref=ABC123).
--
-- Segurança: continua SECURITY DEFINER com a checagem `p_id = auth.uid()` (o usuário só mexe no
-- PRÓPRIO código). codigo_indicacao é um código público de indicação, não PII. Sem novo grant a
-- anon — os privilégios existentes (authenticated/service_role) são preservados pelo replace.
create or replace function public.gerar_codigo_indicacao(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  novo text;
begin
  -- Apenas o próprio usuário pode gerar/obter seu código
  if p_id is null or p_id <> auth.uid() then
    raise exception 'permission denied';
  end if;

  -- Idempotente: se já existe, devolve o código atual (não gera outro)
  select codigo_indicacao into novo from public.perfis where id = p_id;
  if novo is not null then
    return novo;
  end if;

  -- Gera um código curto único (6 chars, base hex maiúscula)
  loop
    novo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.perfis where codigo_indicacao = novo);
  end loop;

  update public.perfis set codigo_indicacao = novo where id = p_id and codigo_indicacao is null;
  -- corrida: se outra requisição gravou primeiro, relê o valor efetivo
  select codigo_indicacao into novo from public.perfis where id = p_id;
  return novo;
end;
$function$;
