-- Código de validação dos documentos assinados (12/11, pedido do dono): impresso no rodapé de TODAS as
-- páginas do PDF e na folha de assinaturas; leva à página pública /#/validar/<código>
-- (api/validar-documento.js), que mostra o que foi assinado, por quem e quando, SEM expor o token do link.
-- Um código por DOCUMENTO: as linhas do mesmo contrato_grupo_id (uma por signatário) compartilham o código.
-- Criado na primeira emissão (POST em api/validar-documento.js, service key) e nunca mais muda.

alter table public.contratos_link add column if not exists codigo_validacao text
  constraint contratos_link_codigo_validacao_formato check (codigo_validacao ~ '^[A-HJ-NP-Z2-9]{16}$');
create index if not exists contratos_link_codigo_validacao_idx on public.contratos_link (codigo_validacao)
  where codigo_validacao is not null;

-- 16 símbolos de 32 a partir de 16 bytes aleatórios (byte & 31 é uniforme). SECURITY INVOKER.
create or replace function public.gerar_codigo_validacao() returns text
language sql volatile set search_path to 'public', 'extensions' as $function$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) & 31) + 1, 1), '' order by i)
  from (select gen_random_bytes(16) as b) x, generate_series(0, 15) as i;
$function$;

-- Garante o código do documento do link `p_token` (o mesmo para todo o grupo). Só existe código para
-- documento com ao menos UMA assinatura. Trava por documento: duas emissões simultâneas não geram dois.
-- SECURITY INVOKER: na prática só a service key (api) consegue emitir; ver nota abaixo.
create or replace function public.garantir_codigo_validacao(p_token text) returns text
language plpgsql security invoker set search_path to 'public' as $function$
declare g uuid; c text;
begin
  select contrato_grupo_id, codigo_validacao into g, c from public.contratos_link where token = p_token;
  if not found then return null; end if;
  if c is not null then return c; end if;
  perform pg_advisory_xact_lock(hashtext('codigo_validacao:' || coalesce(g::text, p_token)));
  if not exists (select 1 from public.contratos_link l where l.status = 'assinado'
                 and (l.token = p_token or (g is not null and l.contrato_grupo_id = g))) then
    return null;
  end if;
  select l.codigo_validacao into c from public.contratos_link l
   where l.codigo_validacao is not null and (l.token = p_token or (g is not null and l.contrato_grupo_id = g)) limit 1;
  if c is null then c := public.gerar_codigo_validacao(); end if;
  update public.contratos_link set codigo_validacao = c
   where codigo_validacao is null and (token = p_token or (g is not null and contrato_grupo_id = g));
  return c;
end $function$;

-- Sem REVOKE/GRANT (regra do CLAUDE.md: REVOKE fica com o dono): as duas funções são SECURITY INVOKER, então
-- chamadas por anon/authenticated esbarram na RLS de contratos_link (anon não lê nem altera nada) — só a
-- service key consegue emitir o código. Nada aqui entra na allowlist de auditoria_seguranca().

-- Uma vez emitido, o código não muda (nem pela equipe, que tem UPDATE na tabela).
create or replace function public.contratos_link_codigo_imutavel() returns trigger
language plpgsql security invoker set search_path to 'public' as $function$
begin
  if old.codigo_validacao is not null and new.codigo_validacao is distinct from old.codigo_validacao then
    raise exception 'o código de validação não pode ser alterado depois de emitido' using errcode = 'check_violation';
  end if;
  return new;
end $function$;
create or replace trigger contratos_link_codigo_imutavel before update of codigo_validacao on public.contratos_link
  for each row execute function public.contratos_link_codigo_imutavel();
