-- 16/09: o termo de adesão (utils/termos.js, decisão do dono 30/07) já promete um HONORÁRIO
-- MÍNIMO de R$ 7.000,00 sempre que 10% do valor arrematado ficar abaixo disso — mas nenhum
-- lugar do código aplicava esse piso: nem o cálculo em Caso.jsx (salvarArrematacao), nem em
-- api/atribuir-arremate.js, nem na distribuição interna (api/_honorarios.js). O texto
-- prometia uma coisa; o cálculo fazia outra. Parametrizado (não hardcoded) pelo mesmo motivo
-- de total_pct: se o valor do piso mudar, muda aqui — sem precisar de deploy.
alter table public.config_honorarios
  add column if not exists honorario_minimo numeric default 7000;

update public.config_honorarios set honorario_minimo = 7000 where id = 1 and honorario_minimo is null;
