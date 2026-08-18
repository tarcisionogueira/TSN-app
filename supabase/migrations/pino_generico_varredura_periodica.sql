-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O INVARIANTE PEGOU O MEU PRÓPRIO ERRO — 18/08/2026 (minutos depois de aplicá-lo)
--
-- Ao tirar do trigger `trg_geocode_pino_generico` o `update` na própria tabela (causa do 21000
-- que derrubava upserts inteiros), escrevi que a regra convergiria sozinha: *"a linha irmã se
-- rebaixa quando for escrita, e a coleta reescreve todas"*.
--
-- ERRADO. O trigger tem early-return quando `latitude`, `longitude`, `geocod_nivel` e
-- `endereco` vêm iguais — que é exatamente o caso da RECOLETA ROTINEIRA. A linha irmã nunca
-- reavalia. `pino_generico_como_rua` foi de 0 para 99 na coleta seguinte e me mostrou isso em
-- minutos, o que é precisamente para o que ele foi criado.
--
-- Vale o registro do método: eu tinha CONFERIDO que a regra ainda funciona (escrever 'rua'
-- numa linha em conflito devolve 'cidade') — e o teste passou, porque escrever muda o campo e
-- desarma o early-return. O teste provou o caminho que eu executei, não o que a produção
-- executa. Convergência assumida não é convergência medida.
--
-- CONSERTO: varredura periódica, FORA de qualquer upsert (onde tocar várias linhas é seguro),
-- pendurada no cron `limpar-imoveis-stale` que já roda 05h UTC e já cuida de higiene do acervo.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.demover_pinos_genericos()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  update public.imoveis_leilao a
     set geocod_nivel = 'cidade'
   where a.ativo and a.geocod_nivel in ('rua','endereco')
     and a.latitude is not null and a.longitude is not null
     and public.via_normalizada(a.endereco) is not null
     and exists (select 1 from public.imoveis_leilao b
                  where b.ativo and b.id <> a.id
                    and b.latitude = a.latitude and b.longitude = a.longitude
                    and public.via_normalizada(b.endereco) is not null
                    and public.via_normalizada(b.endereco) <> public.via_normalizada(a.endereco));
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.demover_pinos_genericos() is
  'Rebaixa a cidade os lotes em coordenada compartilhada por vias diferentes. Necessaria porque o trigger tem early-return quando nada muda na recoleta — a linha irma nunca reavalia sozinha. Chamada pelo cron limpar-imoveis-stale.';

revoke all on function public.demover_pinos_genericos() from public, anon;
grant execute on function public.demover_pinos_genericos() to service_role;
