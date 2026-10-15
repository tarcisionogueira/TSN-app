-- "Fazenda" como nome de lugar (15/10, dono): lotes urbanos gravados como rural pelo normalizarTipo antigo.
-- O código (api/_tipo.js fazendaEhNome) já classifica certo daqui em diante; aqui só os 4 ativos confirmados
-- (os demais "rural" com fazenda no texto são rurais por outro motivo: sítio, chácara, gleba, área de terras).
update public.imoveis_leilao set tipo = case id::text
  when '196f8afa-db84-4931-b837-337d789ec172' then 'casa'
  when '85893f97-b0ec-4344-b056-478d6484d23b' then 'apartamento'
  when 'f7746dd0-d0b5-4717-bacd-40ae36aeb0e7' then 'apartamento'
  when 'aaa325ed-35fa-45ac-8386-ffb402600825' then 'terreno' end
 where id::text in ('196f8afa-db84-4931-b837-337d789ec172','85893f97-b0ec-4344-b056-478d6484d23b','f7746dd0-d0b5-4717-bacd-40ae36aeb0e7','aaa325ed-35fa-45ac-8386-ffb402600825')
   and tipo = 'rural';
