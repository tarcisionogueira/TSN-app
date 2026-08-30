-- 30/08 — `live_em_cartaz()`: qual aula está em cartaz AGORA, sem slug fixo no código
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- A home não falava da aula. Quem chega por qualquer caminho que não seja o link direto da
-- campanha não tinha como saber que existe aula — e a campanha é só uma das portas.
--
-- POR QUE NÃO REUSAR `live_proxima(slug)` DIRETO: ela EXIGE o slug, e uma faixa na home não
-- tem slug para dar. Fixar 'leilao-ao-vivo' no componente faria a faixa mentir no dia em que
-- a próxima aula tiver outro slug — e mentir calada, que é o pior modo. Esta pergunta "o que
-- está em cartaz" é diferente de "quando é a aula X", e merece função própria.
--
-- A DATA EFETIVA VEM DE `live_proxima`, não da coluna. Evento com `recorrencia = 'semanal'`
-- tem `data_hora` congelada na primeira edição; quem lê a coluna crua anuncia uma data morta.
-- Delegar mantém as duas com a MESMA régua, inclusive a janela de 2h ("começando agora" às
-- 19h05, não a semana que vem).
--
-- A JANELA DE 2h TAMBÉM É O QUE FAZ A FAIXA SUMIR SOZINHA. Sem ela, a aula de 02/09 ficaria
-- anunciada para sempre depois de acontecer — o tipo de coisa que ninguém lembra de desligar
-- e que corrói a confiança em tudo que a home diz.
--
-- Devolve só o que uma FAIXA precisa (slug, título, quando). Bio, foto e descrição do
-- apresentador são da landing; anon não precisa deles aqui.
create or replace function public.live_em_cartaz()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  p jsonb;
  q timestamptz;
  melhor jsonb := null;
  melhor_q timestamptz := null;
begin
  for r in select slug from public.eventos_live where ativo loop
    p := public.live_proxima(r.slug);
    continue when p is null;
    q := (p->>'data_hora')::timestamptz;
    -- Já passou (fora da janela de 2h) não está em cartaz.
    continue when q is null or q < now() - interval '2 hours';
    if melhor_q is null or q < melhor_q then
      melhor_q := q;
      melhor := jsonb_build_object('slug', p->>'slug', 'titulo', p->>'titulo', 'data_hora', q);
    end if;
  end loop;
  return melhor;   -- null = nada em cartaz. É resposta, não falha.
end $$;

revoke all on function public.live_em_cartaz() from public;
grant execute on function public.live_em_cartaz() to anon, authenticated, service_role;
