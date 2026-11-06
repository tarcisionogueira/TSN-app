-- GATILHOS QUE DESLIGAM LOTE PASSAM A DIZER POR QUÊ (06/11, pendência #410).
-- Varredura de captação achou imóveis VIVOS (praça futura, no site, lidos na véspera) inativos com
-- suprimido_motivo NULO: SUPORTE (Ricart, Mais Leilão, Vecchi, Saraiva) e GESTAOLEILOES (Vinco, Lance Total) —
-- 9 religados à mão em 06/11 — e 5 da SUBLIME que a fila do Pecini nunca relia. Os três gatilhos abaixo eram os
-- únicos que desligavam sem motivo; com as datas e textos de hoje nenhum deles desligaria, então não há como saber
-- qual foi. Com o motivo gravado, o próximo caso se explica sozinho, a fonte_captacao_lacuna() o conta, e
-- "inativo sem motivo" volta a significar "ninguém decidiu" (o que a fila do Pecini relê).
-- Corpo idêntico ao vigente; só ganha a linha do motivo.
create or replace function public.imovel_barrar_bem_movel() returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if tg_op = 'UPDATE' and new.titulo is not distinct from old.titulo and new.descricao is not distinct from old.descricao
     and not (coalesce(new.ativo, false) and not coalesce(old.ativo, false)) then return new; end if;
  if tg_op = 'INSERT' and public.imovel_fonte_id_existe(new.fonte_id) then return new; end if;
  if new.ativo and (public.bem_movel_barrado(new.titulo, new.descricao) or public.equipamento_no_titulo(new.titulo) or public.titulo_comeca_com_veiculo(new.titulo)) then
    new.ativo := false;
    new.suprimido_motivo := coalesce(new.suprimido_motivo, 'nao_imovel');
  end if;
  return new;
end; $function$;

create or replace function public.imovel_barrar_fracao_ideal() returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if tg_op = 'UPDATE' and new.titulo is not distinct from old.titulo and new.descricao is not distinct from old.descricao
     and not (coalesce(new.ativo, false) and not coalesce(old.ativo, false)) then return new; end if;
  if tg_op = 'INSERT' and public.imovel_fonte_id_existe(new.fonte_id) then return new; end if;
  if public.fracao_ideal_barrada(new.titulo, new.descricao) then
    new.ativo := false;
    new.suprimido_motivo := coalesce(new.suprimido_motivo, 'fracao_ideal');
  end if;
  return new;
end; $function$;

create or replace function public.trg_desativa_leilao_encerrado() returns trigger language plpgsql set search_path to 'public', 'extensions', 'pg_temp' as $function$
begin
  if new.ativo and public.leilao_ja_encerrado(new.data_leilao, new.data_leilao_2, new.data_fim, new.modalidade)
     and not coalesce(new.resultado_leilao = 'sem_lance' and new.resultado_apurado_em > now() - interval '15 days', false) then
    new.ativo := false;
    new.suprimido_motivo := coalesce(new.suprimido_motivo, 'praca_vencida');
  end if;
  return new;
end; $function$;
