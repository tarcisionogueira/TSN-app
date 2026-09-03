-- DECISÃO DO DONO (03/09, à tarde) — item 5 do Bloco 3: separar a subcota 'geral' do Bright
-- Data em duas, para o cliente que abre um imóvel (on-demand, api/enriquecer-lote.js:handler)
-- nunca ficar sem enriquecimento por causa do backlog dos crons de fundo
-- (enriquecer-datas-cron.js, enriquecer-backfill-cron.js). NÃO aumenta o total: 100 = 40 + 60,
-- a mesma soma de antes, só que agora cada lado tem parede própria (mesmo padrão já usado por
-- docs/vlance/certidao — subcotas independentes, não a via de "reserva" compartilhada usada
-- só por 'rj'). teto_dia mantém a proporção teto/6 já usada em toda a tabela.
update public.brightdata_reserva
   set teto = 40, teto_dia = 7,
       descricao = 'Crons de fundo que mantem o acervo enriquecido (enriquecer-datas-cron.js, enriquecer-backfill-cron.js) - separado do on-demand do cliente (geral_cliente) em 03/09.'
 where proposito = 'geral';

insert into public.brightdata_reserva (proposito, teto, teto_dia, reserva, descricao)
values ('geral_cliente', 60, 10, 0,
        'Enriquecimento on-demand quando o cliente abre a tela de um imovel (enriquecer-lote.js:handler) - separado do "geral" (crons de fundo) em 03/09 para o cliente nunca ficar sem enriquecimento por causa do backlog dos crons.')
on conflict (proposito) do update set teto = excluded.teto, teto_dia = excluded.teto_dia, descricao = excluded.descricao;
