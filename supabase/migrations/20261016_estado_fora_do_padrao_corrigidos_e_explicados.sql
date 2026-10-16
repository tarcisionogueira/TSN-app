-- estado_fora_do_padrao (16/10): 17 lotes ativos sem UF — somem de /leiloes.
-- 7 corrigidos onde a cidade está ESCRITA no próprio lote (título, descrição ou slug da URL);
-- 10 explicados por 30 dias: o lote só diz "nesta cidade"/um bairro que existe em várias cidades.
-- Inventar a cidade seria pior que deixar fora (regra do CLAUDE.md, qa_invariante_explicada).
-- Os gatilhos preservar_e_derivar_endereco/cidade_pelo_ibge mantêm a correção na próxima coleta
-- (cidade/UF vazias da fonte não sobrescrevem as boas) e normalizam pelo IBGE.
update public.imoveis_leilao set cidade = 'Unaí', estado = 'MG'
 where id = '44803db2-6d99-40ee-942d-98b7568e8801' and coalesce(estado,'') !~ '^[A-Z]{2}$';
update public.imoveis_leilao set cidade = 'Brasilândia de Minas', estado = 'MG'
 where id = '3a7a32c9-8541-4866-ba86-0a05dfc2d500' and coalesce(estado,'') !~ '^[A-Z]{2}$';
update public.imoveis_leilao set cidade = 'São Bernardo do Campo', estado = 'SP'
 where id = 'a7b6e59a-ea50-44a3-b54a-8f0ed9928a44' and coalesce(estado,'') !~ '^[A-Z]{2}$';
update public.imoveis_leilao set cidade = 'Itaporanga d''Ajuda', estado = 'SE'
 where id = '2fa8dcef-89fe-4bec-8e0a-782c4b6afdea' and coalesce(estado,'') !~ '^[A-Z]{2}$';
update public.imoveis_leilao set cidade = 'Ribeirão Corrente', estado = 'SP'
 where id = '5108e3dc-7f7c-45ff-8643-142c34b2bc7e' and coalesce(estado,'') !~ '^[A-Z]{2}$';
update public.imoveis_leilao set cidade = 'Franca', estado = 'SP'
 where id in ('b66b7da3-2da2-446c-a3af-ba5986894f17', '6ff1d5a7-7dbe-4644-957f-6748cb00cffd') and coalesce(estado,'') !~ '^[A-Z]{2}$';

insert into public.qa_invariante_explicada (chave, imovel_id, explicacao, explicado_ate)
select 'estado_fora_do_padrao', x.id::uuid, x.expl, current_date + 30
  from (values
    ('bbda1b05-aea1-411d-8216-d309d5b14145', 'NAKAKOGUE: descrição diz só "nesta cidade" (Jardim/Conjunto) — cidade não está no lote; parser não traz.'),
    ('de8dd21d-49e8-4cac-8232-3d5fd91c56c5', 'NAKAKOGUE: "Jardim Everest, nesta cidade" — bairro existe em mais de uma cidade.'),
    ('b29f6d1e-be7c-4780-be94-6ec7a74fd6ee', 'NAKAKOGUE: "Conjunto Habitacional ... desta cidade" — cidade não está no lote.'),
    ('47518497-831c-4301-8ca7-5123a752f45b', 'NAKAKOGUE: "Jardim Tenerife desta cidade" — cidade não está no lote.'),
    ('870de04c-993c-4e9c-8cb9-86d5897ecea5', 'NAKAKOGUE: "Jardim Everest, neste Município e Comarca" — cidade não está no lote.'),
    ('fd04ef5b-18a9-4327-b7e9-28b05b3f9eb8', 'NAKAKOGUE: descrição sem cidade.'),
    ('6016442f-02ef-4224-8061-e77b66be17ef', 'NAKAKOGUE: descrição sem cidade.'),
    ('eab3674c-344b-453b-825b-16e9b8c77769', 'NAKAKOGUE: "bairro água da onça" — sem cidade.'),
    ('daee88d0-ea78-40a7-acb1-9cac2aa2bbe5', 'LEILOTECH (vmleiloes): título/descrição "50% do Imóvel Urbano", sem cidade.'),
    ('2d2face0-4727-40a9-ae05-604ae26c5fd0', 'LEILOTECH (vmleiloes): "Sobrado no Sítio Cercado" — bairro sem cidade explícita.'),
    ('4941f029-6bc8-4c18-8c27-8ac5be029cc9', 'LEILOTECH (spencer): "Edifício Maringá, av. Duque de Caxias" — sem cidade explícita.'),
    ('1d45b897-bf78-4c70-9379-ceaf7498a5f7', 'LEILOTECH (vmleiloes): "Bairro Alto da XV" existe em mais de uma cidade.'),
    ('3c31d870-02da-4272-91ba-fe09cdc66674', 'MILAN: lote 002 sem título nem descrição na fonte.'),
    ('c0735f6b-baa1-4885-8551-d4d47df95bb9', 'LEILAOBRASIL: "Riviera de Santa Cristina XI" — loteamento, município não escrito no lote.')
  ) as x(id, expl)
 where exists (select 1 from public.imoveis_leilao i where i.id = x.id::uuid)
on conflict do nothing;
