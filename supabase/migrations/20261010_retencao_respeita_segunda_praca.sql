-- 10/10 — `link_matricula_morto` VOLTOU (56, todos GRUPOLANCE) e a causa era maior que o sintoma.
--
-- 1) A RETENÇÃO APAGAVA DOCUMENTO DE LOTE AINDA EM LEILÃO. `anexos_expirados` decidia "leilão passou"
--    só pela `data_leilao` (1ª praça). 53 dos 56 lotes tinham 2ª praça FUTURA (até mar/2027); no acervo
--    inteiro eram ~365 matrículas/editais e 1.664 documentos do espelho apagados de lote vivo. A regra
--    do dono já existe e é outra: `acervo.leilao_encerrado` — encerrado só quando a praça MAIS FUTURA
--    passou (função leilao_encerrado). A retenção passa a usá-la e entra no aplicada_por da regra.
-- 2) O SELO FICAVA VERDE SOBRE ARQUIVO APAGADO. A limpeza zera `imovel_anexos.storage_path`, mas o
--    `imoveis_leilao.link_matricula/link_edital` continuava apontando para o objeto, e
--    `calc_tem_matricula_doc` lê o link. Agora o gatilho do anexo zera o link que aponta para o
--    arquivo que sumiu, antes de recalcular o selo — vale para qualquer limpeza, presente ou futura.
-- 3) REPARO: links órfãos zerados (o coletor da fonte baixa de novo) e espelhos `purgado` de lote
--    vivo devolvidos à fila (`pendente`) — o espelhar-docs-cron recopia e republica.

create or replace function public.anexos_expirados(p_limite integer default 100)
 returns table(id uuid, storage_path text)
 language sql stable security definer
 set search_path to 'public'
 set statement_timeout to '60s'
as $function$
  -- aplica a regra de negocio: acervo.leilao_encerrado (praca mais futura, nao a 1a)
  select a.id, a.storage_path
  from public.imovel_anexos a
  where a.storage_path is not null
    and a.arrematado = false
    and not exists (
      select 1 from public.imovel_anexos b join public.imoveis_leilao ib on ib.id = b.imovel_id
       where b.storage_path = a.storage_path and b.id <> a.id and coalesce(ib.ativo, false)
    )
    and not exists (
      select 1 from public.documento_espelho e join public.imoveis_leilao ie on ie.id = e.imovel_id
       where e.storage_path = a.storage_path and e.status = 'copiado' and e.imovel_id <> a.imovel_id and coalesce(ie.ativo, false)
    )
    and not (
          exists (select 1 from public.analises_mercado    m where m.imovel_id::text = a.imovel_id::text)
      and exists (select 1 from public.analises_documental d where d.imovel_id::text = a.imovel_id::text)
      and exists (select 1 from public.analises_laudo      l where l.imovel_id::text = a.imovel_id::text)
    )
    and case
      when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id) then
        case
          when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and i.modalidade = 'venda_direta')
            then exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and coalesce(i.ativo, true) = false)
          when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and i.resultado_leilao in ('sem_lance','indeterminado'))
            then exists (
              select 1 from public.imoveis_leilao i
              where i.id = a.imovel_id
                and public.leilao_encerrado(i.modalidade, i.data_leilao, i.data_leilao_2, current_date - 15)
            )
          else exists (
            select 1 from public.imoveis_leilao i
            where i.id = a.imovel_id
              and (
                public.leilao_encerrado(i.modalidade, i.data_leilao, i.data_leilao_2, current_date - 1)
                or coalesce(i.ativo, true) = false
              )
          )
        end
      else a.criado_em::date <= (current_date - 5)
    end
  limit greatest(1, least(coalesce(p_limite, 100), 500))
$function$;

update public.regra_negocio
   set aplicada_por = (select array_agg(distinct x) from unnest(aplicada_por || array['anexos_expirados']) x)
 where chave = 'acervo.leilao_encerrado';

create or replace function public.trg_anexo_atualiza_tem_edital()
 returns trigger language plpgsql set search_path to 'public'
as $function$
declare alvo uuid := coalesce(new.imovel_id, old.imovel_id);
declare novo_ed boolean; declare novo_mat boolean; declare sumiu text;
begin
  -- Arquivo do anexo apagado (limpeza zera storage_path, ou a linha some): o link do imóvel que
  -- apontava para ele morre junto — senão o selo continua verde sobre documento inexistente (10/10).
  sumiu := case
    when tg_op = 'UPDATE' and old.storage_path is not null and new.storage_path is null then old.storage_path
    when tg_op = 'DELETE' and old.storage_path is not null then old.storage_path
  end;
  if alvo is not null and sumiu is not null then
    update public.imoveis_leilao i
       set link_matricula = case when i.link_matricula like '%/documentos/' || sumiu || '%' then null else i.link_matricula end,
           link_edital    = case when i.link_edital    like '%/documentos/' || sumiu || '%' then null else i.link_edital end
     where i.id = alvo
       and (i.link_matricula like '%/documentos/' || sumiu || '%' or i.link_edital like '%/documentos/' || sumiu || '%');
  end if;
  if alvo is not null then
    select public.calc_tem_edital_doc(i.id, i.link_edital, i.anexos),
           public.calc_tem_matricula_doc(i.id, i.link_matricula, i.anexos, i.fonte, i.estado, i.fonte_id)
      into novo_ed, novo_mat
      from public.imoveis_leilao i where i.id = alvo;
    update public.imoveis_leilao i
       set tem_edital_doc = novo_ed, tem_matricula_doc = novo_mat
     where i.id = alvo
       and (i.tem_edital_doc is distinct from novo_ed or i.tem_matricula_doc is distinct from novo_mat);
  end if;
  return null;
end;
$function$;

-- REPARO 1: links do NOSSO Storage para objeto que não existe mais (lote ativo) → nulos; selo recalculado.
with mortos as (
  select i.id,
         i.link_matricula like '%/storage/v1/object/%/documentos/%' and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
           and o.name = substring(i.link_matricula from '/object/(?:sign|public)/documentos/([^?]+)')) as mat_morto,
         i.link_edital like '%/storage/v1/object/%/documentos/%' and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
           and o.name = substring(i.link_edital from '/object/(?:sign|public)/documentos/([^?]+)')) as ed_morto
    from public.imoveis_leilao i
   where i.ativo and (i.link_matricula like '%/storage/v1/object/%/documentos/%' or i.link_edital like '%/storage/v1/object/%/documentos/%')
)
update public.imoveis_leilao i
   set link_matricula = case when m.mat_morto then null else i.link_matricula end,
       link_edital    = case when m.ed_morto  then null else i.link_edital end,
       tem_matricula_doc = public.calc_tem_matricula_doc(i.id, case when m.mat_morto then null else i.link_matricula end, i.anexos, i.fonte, i.estado, i.fonte_id),
       tem_edital_doc    = public.calc_tem_edital_doc(i.id, case when m.ed_morto then null else i.link_edital end, i.anexos)
  from mortos m
 where i.id = m.id and (m.mat_morto or m.ed_morto);

-- REPARO 2: espelho apagado de lote AINDA em leilão volta à fila (o cron recopia e republica).
update public.documento_espelho e
   set status = 'pendente', tentativas = 0, motivo = 'reaberto 10/10: retencao apagou com 2a praca futura'
  from public.imoveis_leilao i
 where i.id = e.imovel_id and e.status = 'purgado' and i.ativo
   and not public.leilao_encerrado(i.modalidade, i.data_leilao, i.data_leilao_2);
