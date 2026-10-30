-- 30/10 (decisão do dono: "sucata, veículo em posse do executado não é interessante. descarte os que se enquadram"):
-- sucata deixa de ser "oculta por padrão na busca" e passa a ficar FORA do acervo, como o veículo com o executado.
--
-- 1) Gatilho: depois de trg_veiculo_sucata marcar is_sucata (ordem alfabética: trg_v… < trg_zz…), o lote sucata ou
--    com status_patio = 'excluido' (bem em posse do executado/devedor) é gravado INATIVO. Vale para todo coletor —
--    sem isto a próxima rodada regravaria `ativo: true` e o lote voltava.
-- 2) Limpeza dos ativos de hoje (2.130 sucatas em 30/10; executado: 0 ativos).
-- 3) Regra de negócio atualizada (a auditoria_regras_negocio exige `aplicada_por`).

create or replace function public.veiculo_barrar_fora_do_acervo()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.ativo and coalesce(new.is_sucata, false) then
    new.ativo := false;
    new.suprimido_motivo := 'sucata';
  elsif new.ativo and new.status_patio = 'excluido' then
    new.ativo := false;
    new.suprimido_motivo := 'posse_do_executado';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_zz_veiculo_fora_do_acervo on public.veiculos_leilao;
create trigger trg_zz_veiculo_fora_do_acervo
  before insert or update on public.veiculos_leilao
  for each row execute function public.veiculo_barrar_fora_do_acervo();

update public.veiculos_leilao set ativo = false, suprimido_motivo = 'sucata'
 where ativo and is_sucata;
update public.veiculos_leilao set ativo = false, suprimido_motivo = 'posse_do_executado'
 where ativo and status_patio = 'excluido';

update public.regra_negocio
   set valor = '{"busca": "fora_do_acervo", "viabilidade_pct": -60}'::jsonb,
       aplicada_por = array['veiculo_eh_sucata', 'veiculo_barrar_fora_do_acervo'],
       descricao = 'Sucata (PRF/DETRAN: aproveitável/inservível, irrecuperável, para peças, baixa definitiva) e veículo em posse do executado não são oportunidade: ficam FORA do acervo (dono, 30/10). veiculo_eh_sucata marca is_sucata; veiculo_barrar_fora_do_acervo (gatilho trg_zz_veiculo_fora_do_acervo) grava inativo.'
 where chave = 'oportunidade.veiculo_sucata';
