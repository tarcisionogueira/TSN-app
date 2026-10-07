-- REGISTRO DO IMÓVEL A PARTIR DA TELA DO ARREMATE (07/10, pedido do dono: "nessa tela poder
-- conduzir o registro de um imóvel arrematado").
--
-- Até aqui o serviço de cartório só nascia preso a `arrematacoes` (o caso jurídico formal) ou
-- avulso. Mas a tela que o dono usa é a de `arrematados` — o PORTFÓLIO que o próprio cliente
-- registra —, e nem todo arremate de lá tem uma `arrematacoes` correspondente: hoje são 3
-- arrematados para 1 arrematação. Sem esta coluna, abrir o registro a partir dali só seria
-- possível como "avulso", e o serviço ficaria sem vínculo nenhum com o arremate que o originou.
--
-- ON DELETE SET NULL, nunca CASCADE: a lição de 06/10 (`arrematado_protege_andamento`) é que o
-- cliente pode apagar o próprio arremate enquanto a equipe não confirmou, e um cascade levaria
-- junto um serviço COM DINHEIRO (parcelas cobradas e pagas). O serviço guarda cliente, imóvel e
-- parcelas em si mesmo, então sobrevive sozinho.
alter table public.servicos_cartorio
  add column if not exists arrematado_id uuid references public.arrematados(id) on delete set null;
create index if not exists servicos_cartorio_arrematado_idx on public.servicos_cartorio(arrematado_id);

-- E pela mesma razão do andamento: arremate com serviço de cartório VIVO não é apagado. Sem isto
-- o cliente apaga o arremate, o vínculo vira null e some da tela o registro que ele está pagando.
-- A trava de andamento (06/10) já existe noutra função; esta é a segunda razão para recusar, e
-- fica separada para a mensagem dizer QUAL das duas é.
create or replace function public.arrematado_protege_cartorio()
 returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.servicos_cartorio s
              where s.arrematado_id = old.id and s.status not in ('cancelado', 'registrado')) then
    raise exception 'Este arremate tem um serviço de cartório em andamento e não pode ser removido. Fale com a equipe.'
      using errcode = 'P0001', hint = 'cartorio_em_andamento';
  end if;
  return old;
end $$;

create or replace trigger arrematados_protege_cartorio
  before delete on public.arrematados
  for each row execute function public.arrematado_protege_cartorio();
