-- ============================================================================
-- RETENÇÃO DE LOTES INATIVOS (08/08)
--
-- CONTEXTO: o dono viu 52 mil no admin e 31 mil na página pública e perguntou se
-- guardamos dado à toa. Não guardamos: a diferença são ~24 mil lotes ENCERRADOS
-- (`ativo = false`), e os contadores do admin somam a tabela inteira.
--
-- POR QUE NÃO DÁ PARA APAGAR POR ESTAR INATIVO: metade das análises já emitidas
-- (21 de 42) aponta para lotes hoje inativos, e há imóveis vistos por clientes na
-- mesma situação. Apagar quebraria relatório que o cliente já pagou e já tem em
-- mãos — ele abriria sem o imóvel.
--
-- O CRITÉRIO SEGURO não é "inativo": é inativo E velho E sem nenhum vínculo com o
-- que alguém já consumiu — sem análise, nunca visto, sem arremate e sem documento
-- espelhado no nosso bucket (se copiamos, foi por um motivo).
--
-- SIMULA POR PADRÃO; `p_simular => false` é que apaga. Função de exclusão em massa
-- que apaga por engano no primeiro uso não tem volta.
--
-- Conferido ao criar: com 6 meses o resultado é ZERO (a base tem 50 dias de vida);
-- com 1 mês ela encontra e para no teto, provando que o critério de tempo é o que
-- segura. A política nasce antes de precisar dela, para não ser escrita às pressas
-- quando a tabela já estiver pesada.
-- ============================================================================

create or replace function public.limpar_lotes_inativos(
  p_meses int default 6,
  p_simular boolean default true,
  p_limite int default 5000
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_ids uuid[];
  v_qtd int;
begin
  select array_agg(i.id)
    into v_ids
    from (
      select i.id
        from public.imoveis_leilao i
       where not i.ativo
         and i.atualizado_em < now() - make_interval(months => greatest(1, p_meses))
         and not exists (select 1 from public.analises_mercado a  where a.imovel_id = i.id::text)
         and not exists (select 1 from public.analises_documental d where d.imovel_id = i.id::text)
         and not exists (select 1 from public.analises_laudo    la where la.imovel_id = i.id::text)
         and not exists (select 1 from public.imovel_visto      v  where v.imovel_id::text = i.id::text)
         and not exists (select 1 from public.arrematacoes      ar where ar.imovel_id::text = i.id::text)
         and coalesce(jsonb_array_length(i.anexos), 0) = 0
       limit greatest(1, p_limite)
    ) i;

  v_qtd := coalesce(array_length(v_ids, 1), 0);

  if p_simular or v_qtd = 0 then
    return jsonb_build_object('ok', true, 'simulacao', true, 'elegiveis', v_qtd,
      'criterio', 'inativo há mais de ' || p_meses || ' meses, sem análise, nunca visto, sem arremate e sem documento nosso');
  end if;

  delete from public.imoveis_leilao where id = any(v_ids);
  return jsonb_build_object('ok', true, 'simulacao', false, 'removidos', v_qtd);
end $$;

revoke all on function public.limpar_lotes_inativos(int, boolean, int) from public, anon, authenticated;
grant execute on function public.limpar_lotes_inativos(int, boolean, int) to service_role;
