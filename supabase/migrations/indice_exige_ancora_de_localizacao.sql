-- ÂNCORA DE LOCALIZAÇÃO OBRIGATÓRIA (regra do dono, 07/08).
--
-- "anúncio sem endereço precisa ter alguma referência de que seja ao menos próximo ou na mesma
-- rua para poder aproveitar. Se não, não faz sentido: pode ser outra localidade e o portal só
-- querendo vender, fornecendo informação poluída."
--
-- Medição que motivou: das 1.406 amostras do Índice, 484 (34%) não tinham NADA — nem endereço,
-- nem condomínio, nem CEP, nem bairro — e nem URL (backfill histórico `hist_*`, portanto também
-- não auditáveis; o HANDOFF já registrava "sem o link nada é auditável"). Uma amostra assim não
-- sustenta nenhuma afirmação de proximidade: diz só "nesta cidade" e entra na conta como se
-- fosse da região consultada.
--
-- A régua fica em UMA referência qualquer: endereço, condomínio, CEP ou bairro. Bairro basta
-- porque a lógica de nível 1 já casa por bairro (indice-consulta.js) e é a âncora que 907
-- amostras legítimas têm. Sem nenhuma das quatro, a amostra é recusada na porta.
--
-- Aplicado junto: ingerir_amostras_indice passa a filtrar por esta regra (ver migração
-- indice_ingestao_espelha_corpus_unico.sql para o corpo completo, que também espelha o corpus),
-- e um DELETE tira do corpus da consulta as amostras sem âncora que o backfill de hoje trouxe.
-- Corpus da consulta 2.974 -> 2.490; locação 279 -> 259. Elas seguem preservadas em
-- indice_amostras (histórico) — só não pesam mais no que o cliente vê.
create or replace function public.indice_amostra_tem_ancora(
  p_endereco text, p_condominio text, p_cep text, p_bairro_norm text
) returns boolean
language sql immutable
as $function$
  select coalesce(nullif(btrim(coalesce(p_endereco,'')),''), nullif(btrim(coalesce(p_condominio,'')),''),
                  nullif(btrim(coalesce(p_cep,'')),''), nullif(btrim(coalesce(p_bairro_norm,'')),'')) is not null;
$function$;

comment on function public.indice_amostra_tem_ancora(text,text,text,text) is
  'Regra do dono (07/08): amostra do Índice sem NENHUMA referência de lugar (endereço, condomínio, CEP ou bairro) é poluição — pode ser de outra localidade. Usada na ingestão para recusar na porta.';

delete from public.indice_amostra
where origem = 'portal' and coalesce(btrim(bairro_norm),'') = ''
  and endereco is null and condominio is null and url is null;
