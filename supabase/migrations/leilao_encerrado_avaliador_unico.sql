-- Ver migração aplicada em 11/08: avaliador ÚNICO de "o leilão já acabou?" no banco,
-- espelhando api/_leilao-encerrado.js, + registro em `regra_negocio` para a
-- auditoria_regras_negocio() acusar se alguém parar de delegar.
-- (Conteúdo idêntico ao aplicado via MCP — mantido aqui para o histórico do repo.)
create or replace function public.leilao_encerrado(
  p_modalidade text, p_data_leilao text, p_data_leilao_2 timestamptz, p_ref date default current_date
) returns boolean language sql immutable set search_path to 'public' as $fn$
  -- aplica a regra de negocio: acervo.leilao_encerrado
  select case
    when coalesce(p_modalidade,'') ~* 'venda[_ -]?direta' then false
    else coalesce(greatest(
        case when p_data_leilao ~ '^\d{4}-\d{2}-\d{2}' then p_data_leilao::date end,
        p_data_leilao_2::date) < p_ref, false)
  end;
$fn$;
revoke execute on function public.leilao_encerrado(text, text, timestamptz, date) from public, anon;
grant  execute on function public.leilao_encerrado(text, text, timestamptz, date) to authenticated, service_role;

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo) values (
  'acervo.leilao_encerrado',
  '{"venda_direta_nunca_vence": true, "considera_segunda_praca": true, "sem_data_nao_afirma": true}'::jsonb,
  'Um lote só está encerrado quando a MAIS FUTURA de suas praças já passou. Venda direta nunca vence por data. Sem data confiável, não se afirma encerramento.',
  array['leilao_encerrado'], true
) on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, ativo = true;
