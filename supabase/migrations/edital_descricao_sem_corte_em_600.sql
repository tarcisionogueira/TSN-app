-- Corte de 600 caracteres na descrição do lote EDITAL_DJEN — achado a partir de foto do
-- dono (08/09): a ficha de um imóvel mostrava a descrição terminando em "...possa inter."
-- (cortada no meio da palavra) e "Data do leilão: A confirmar no edital" — ou seja, o texto
-- foi cortado ANTES de chegar à parte que diz a data da hasta.
--
-- Causa: `editais_promover_pendentes()` (edital_vira_lote_sem_foto_com_matricula_e_dedup_
-- pelo_que_temos.sql) gravava `left(e.texto_integral, 600)` como `descricao`. Medido agora
-- nos 772 editais com texto: mediana de 6.230 caracteres, p90 de 18.000 — ou seja, o corte
-- de 600 descartava a maior parte do texto em praticamente TODO edital, e como a publicação
-- do DJEN sempre começa pela qualificação das partes (nomes, processo) antes de anunciar a
-- data da praça, é sistematicamente a PARTE MAIS ÚTIL que ficava de fora.
--
-- Correção: guarda o texto_integral inteiro (já limitado a 20.000 pela ingestão em
-- api/radar-editais-cron.js) em vez de recortar de novo em 600. A tela pública
-- (api/publico.js) já limita a EXIBIÇÃO a 1.200 caracteres por conta própria — o corte de
-- exibição pertence à tela, não à gravação; gravar menos do que foi capturado é perda
-- permanente de informação, não economia de espaço.
create or replace function public.editais_promover_pendentes(p_teto integer default 60)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  e record; v_dedup jsonb; v_novo_id uuid;
  v_avaliados int := 0; v_ligados int := 0; v_novos int := 0; v_suspeitas int := 0; v_sem_id int := 0;
begin
  for e in
    select * from editais_leilao
     where status = 'processado' and imovel_id is null and promovido_em is null
       -- identificação mínima pra ser útil na vitrine (cidade+uf sempre; e pelo menos UM
       -- dado substantivo — sem isso não é lote, é só uma localização solta)
       and imovel_cidade is not null and imovel_uf is not null
       and (imovel_endereco is not null or imovel_matricula is not null or valor_avaliacao is not null or lance_minimo is not null)
     order by criado_em asc
     limit p_teto
  loop
    v_avaliados := v_avaliados + 1;
    v_dedup := public.editais_dedup_candidato(e.id);

    if v_dedup is not null and v_dedup->>'confianca' = 'forte' then
      -- Já é nosso: liga ao lote existente, preenche só as LACUNAS — nunca sobrescreve
      -- dado que já existe (o scraper original é mais confiável que o texto do DJEN).
      update imoveis_leilao set
        numero_processo = coalesce(numero_processo, e.numero_processo),
        valor_avaliacao = case when coalesce(valor_avaliacao,0)=0 then e.valor_avaliacao else valor_avaliacao end,
        valor_minimo    = case when coalesce(valor_minimo,0)=0 then e.lance_minimo else valor_minimo end,
        ocupacao        = coalesce(ocupacao, e.ocupacao),
        url_lote        = coalesce(url_lote, e.leilao_plataforma_url)
       where id = (v_dedup->>'imovel_id')::uuid;
      update editais_leilao set imovel_id = (v_dedup->>'imovel_id')::uuid, promovido_em = now() where id = e.id;
      v_ligados := v_ligados + 1;
      continue;
    end if;

    -- Cria um lote novo — SEM foto, de propósito (decisão do dono, 03/09). `tem_edital_doc`/
    -- `tem_matricula_doc` ficam false (são geradas por trigger a partir de link_edital/
    -- link_matricula/anexos, que este caminho não tem ainda) — é o que "reforça" a
    -- necessidade de documento: qualquer consulta por `fonte='EDITAL_DJEN' and not
    -- tem_matricula_doc` mostra exatamente o que falta.
    insert into imoveis_leilao (
      fonte, fonte_id, titulo, tipo, modalidade, estado, cidade, endereco,
      valor_avaliacao, valor_minimo, area_m2, numero_processo, numero_matricula,
      data_leilao, data_leilao_2, ocupacao, leiloeiro, descricao, url_lote, ativo
    ) values (
      'EDITAL_DJEN', 'edital_' || e.id::text,
      left(coalesce(nullif(e.imovel_endereco,''), 'Imóvel em leilão judicial') || ' — ' || e.imovel_cidade || '/' || e.imovel_uf, 250),
      'imovel', 'judicial', e.imovel_uf, e.imovel_cidade, e.imovel_endereco,
      e.valor_avaliacao, e.lance_minimo, e.imovel_area_m2, e.numero_processo, e.imovel_matricula,
      to_char(e.data_praca_1::date, 'YYYY-MM-DD'), e.data_praca_2, e.ocupacao, e.leiloeiro_nome,
      e.texto_integral, e.leilao_plataforma_url, true
    )
    on conflict (fonte, fonte_id) do nothing
    returning id into v_novo_id;

    if v_novo_id is null then
      -- Reentrada (o cron rodou de novo sobre o mesmo edital antes do UPDATE abaixo
      -- confirmar) — acha o que já foi criado em vez de tentar de novo.
      select id into v_novo_id from imoveis_leilao where fonte='EDITAL_DJEN' and fonte_id = 'edital_' || e.id::text;
    end if;

    update editais_leilao set
      imovel_id = v_novo_id,
      duplicata_suspeita_de = case when v_dedup is not null then (v_dedup->>'imovel_id')::uuid else null end,
      promovido_em = now()
     where id = e.id;

    if v_dedup is not null then v_suspeitas := v_suspeitas + 1; else v_novos := v_novos + 1; end if;
  end loop;

  select count(*) into v_sem_id from editais_leilao
   where status='processado' and imovel_id is null and promovido_em is null
     and (imovel_cidade is null or imovel_uf is null);

  return jsonb_build_object(
    'avaliados', v_avaliados, 'ligados_ao_acervo', v_ligados, 'novos', v_novos,
    'suspeitas_de_duplicidade', v_suspeitas, 'sem_identificacao_minima', v_sem_id
  );
end $fn$;

revoke all on function public.editais_promover_pendentes(integer) from public, anon, authenticated;
grant execute on function public.editais_promover_pendentes(integer) to service_role;

-- Backfill dos 172 lotes EDITAL_DJEN já promovidos com a descrição cortada em 600 — sem
-- isto, a correção só valeria para lotes NOVOS, e os já ativos (como o da foto do dono)
-- ficariam quebrados até expirar sozinhos. Guarda `length(descricao) <= 600` para só tocar
-- o que de fato veio cortado, nunca um texto legitimamente curto ou já corrigido.
update imoveis_leilao il
   set descricao = el.texto_integral
  from editais_leilao el
 where el.imovel_id = il.id
   and il.fonte = 'EDITAL_DJEN'
   and length(il.descricao) <= 600
   and length(el.texto_integral) > length(il.descricao);
