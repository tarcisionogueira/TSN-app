-- 01/11 — "Motocicleta Honda Biz 125" e "Trator de Esteiras Fiatalis" (VIP) ativos no acervo de IMÓVEIS. bem_movel_barrado
-- já conhece "motocicleta", mas desiste quando a descrição tem palavra imobiliária — e "lote" (do LEILÃO) está em quase
-- toda descrição. Regra nova, mais estreita e mais forte: o título COMEÇA pelo veículo/máquina e não cita imóvel no
-- próprio título → barrado. Medido no acervo ativo: 2 lotes (os dois da VIP), nenhum imóvel.
create or replace function public.titulo_comeca_com_veiculo(p_titulo text)
returns boolean language sql immutable set search_path = public as $f$
  select lower(public.sem_acento(coalesce(p_titulo,''))) ~ '^\W*((lote|item)\s*\d+\s*[-:–]\s*)?(\d+\s*)?(motocicleta|motoneta|moto\y|trator|automovel|caminhao|onibus|camionete|caminhonete|retroescavadeira|escavadeira|empilhadeira|semirreboque|reboque\y|lancha|embarcacao|jet ?ski)'
     and lower(public.sem_acento(coalesce(p_titulo,''))) !~ '(apartamento|\ycasa\y|terreno|galpao|garagem|\yvaga\y|\ybox\y|sala|loja|predio|imovel|fazenda|sitio|chacara)'
$f$;

create or replace function public.imovel_barrar_bem_movel()
returns trigger language plpgsql set search_path = public as $f$
begin
  if tg_op = 'UPDATE' and new.titulo is not distinct from old.titulo and new.descricao is not distinct from old.descricao
     and not (coalesce(new.ativo, false) and not coalesce(old.ativo, false)) then
    return new;  -- texto igual e não é reativação (20261101_gatilhos_imovel_pulam_o_que_nao_mudou)
  end if;
  if tg_op = 'INSERT' and public.imovel_fonte_id_existe(new.fonte_id) then return new; end if;
  if new.ativo and (public.bem_movel_barrado(new.titulo, new.descricao) or public.equipamento_no_titulo(new.titulo)
                    or public.titulo_comeca_com_veiculo(new.titulo)) then
    new.ativo := false;
  end if;
  return new;
end;
$f$;

update public.imoveis_leilao set ativo = false, suprimido_motivo = 'nao_imovel'
 where ativo and public.titulo_comeca_com_veiculo(titulo);
