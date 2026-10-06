-- ANDAMENTO DO PROCESSO NÃO SOME COM O ARREMATE (06/10, achado do dono: "as movimentações jurídicas
-- que tinha registrado sumiram — isso não pode ocorrer, pois posiciona o cliente").
--
-- O que aconteceu: em 24/09 a equipe registrou movimentações do processo 0000199-97.2016.5.05.0195
-- (terreno de Feira de Santana) no arremate do cliente. Em 01/10 23:54 o CLIENTE clicou no "×" da
-- lista de arrematados (a política deixa o dono apagar enquanto a equipe não confirmou) e às 23:56
-- registrou o arremate de novo. `caso_andamentos.arrematado_id` é ON DELETE CASCADE: o diário do
-- processo foi junto, sem aviso — o diálogo só fala em "lançamentos e documentos".
--
-- A trava fica no BANCO (vale para qualquer tela, API ou SQL): arremate com andamento registrado não
-- é apagado. SECURITY DEFINER de propósito — a RLS esconde do cliente as linhas "só equipe", e com
-- privilégio de quem chama o `exists` daria falso e o cascade apagaria justamente o que ele não vê.
create or replace function public.arrematado_protege_andamento()
 returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.caso_andamentos a where a.arrematado_id = old.id) then
    raise exception 'Este arremate tem andamento do processo registrado pela equipe e não pode ser removido. Fale com a equipe.'
      using errcode = 'P0001', hint = 'andamento_registrado';
  end if;
  return old;
end $$;
-- (função `returns trigger` não é chamável por RPC; não precisa de grant/revoke)

create trigger arrematados_protege_andamento
  before delete on public.arrematados
  for each row execute function public.arrematado_protege_andamento();
