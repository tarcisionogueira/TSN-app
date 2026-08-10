-- TOUR DE BOAS-VINDAS — versão 2026-08, focada em ATIVAÇÃO
--
-- POR QUE (09/08): o tour estava dark desde 01/07. O componente resolvia a versão pelo MÊS DO
-- RELÓGIO (`new Date().slice(0,7)`) e a única versão cadastrada era '2026-06' — a consulta
-- devolvia zero etapas e nada aparecia, sem erro. `tour_progresso` tinha 0 linhas: nenhum dos
-- 30 exploradores (todos cadastrados de 03/07 em diante) viu o onboarding. O componente foi
-- corrigido para ancorar na versão MAIS RECENTE publicada; esta migração publica o conteúdo
-- atual, porque o de 2026-06 estava errado em três pontos:
--   • marca antiga ("TSN Ativos", "cursos exclusivos TSN") — o produto é BidPro Brasil;
--   • "Laudos gerados pela equipe especializada" — os relatórios são gerados por IA;
--   • não citava as 3 ANÁLISES GRÁTIS, que é justamente a ação que ninguém executou
--     (90 amostras disponíveis entre os 30 exploradores, 3 usadas no total).
--
-- Fato conferido em consumir_analise_por(): explorador tem 3 amostras VITALÍCIAS
-- (amostra_mercado_usadas), não cota mensal. A cópia abaixo diz exatamente isso.
--
-- Para DESLIGAR o tour sem mexer em código:
--   update public.tour_etapas set ativo = false where versao = '2026-08';
-- (com isso a versão mais recente ativa volta a ser a 2026-06; para não mostrar nenhum,
--  desative as duas.)

begin;

delete from public.tour_etapas where versao = '2026-08';

insert into public.tour_etapas (versao, ordem, rota, titulo, descricao, roles, ativo) values
  ('2026-08', 1, '/', 'Bem-vindo à BidPro Brasil',
   'Aqui você encontra imóveis em leilão do Brasil inteiro e descobre, antes de dar o lance, se o negócio fecha. São 2 minutos para conhecer o caminho.',
   '{}', true),

  -- Passo dos FILTROS (pedido do dono 09/08): é onde a busca deixa de ser uma lista de 30 mil
  -- lotes e vira a lista dele. Sem citar os filtros, a pessoa rola a esmo e desiste.
  ('2026-08', 2, '/buscar', 'Comece pela busca',
   'Abra os Filtros no topo: cidade (com raio de distância), tipo de imóvel, faixa de valor, desconto mínimo sobre a avaliação, modalidade (judicial ou extrajudicial) e forma de pagamento — à vista, financiado ou parcelado. Salve a combinação em "Salvar filtros atuais" e a gente te avisa por e-mail quando entrar lote novo no seu perfil. Achou algo? Abra o imóvel para ver fotos, mapa, edital e as datas das praças.',
   '{}', true),

  ('2026-08', 3, '/analise', 'Você tem 3 análises gratuitas',
   'Dentro de qualquer imóvel, o botão "Solicitar Análise" gera um relatório mercadológico com IA: valor de mercado da região, desconto real, custos de arrematação e retorno estimado. São 3 análises por conta, sem cartão e sem prazo para usar.',
   '{}', true),

  ('2026-08', 4, '/calculadora', 'Calculadora de lance',
   'Simule o lance máximo, ITBI, comissão do leiloeiro, reforma e caixa necessário. O ROI sai na hora, antes de você se comprometer.',
   '{top2,assessorado,clube,consultor,analista,advogado,admin}', true),

  ('2026-08', 5, '/painel', 'Acompanhe tudo em um lugar',
   'Seus imóveis analisados, os que você marcou para monitorar e os arrematados ficam no painel, com o histórico de cada um.',
   '{}', true),

  ('2026-08', 6, '/contratos', 'Contratos digitais',
   'Assinatura com validade jurídica: geolocalização, testemunhas e hash criptográfico do documento.',
   '{top2,assessorado,clube,consultor,analista,advogado,admin}', true),

  ('2026-08', 7, '/membros', 'Área de Membros',
   'Cursos e materiais sobre estratégia de leilão, avaliação de ativos e riscos jurídicos.',
   '{top2,assessorado,clube,admin}', true),

  ('2026-08', 8, '/planos', 'Quando as 3 acabarem',
   'O Investidor Pro libera 10 relatórios por mês e acrescenta a análise documental (edital + matrícula) e a jurídica. Enquanto isso, use suas análises gratuitas à vontade.',
   '{}', true);

-- A 2026-06 sai de circulação: além de desatualizada, ela aparecia no menu "Ver também"
-- do card do tour, ou seja, o cliente conseguiria abrir o conteúdo com a marca antiga.
update public.tour_etapas set ativo = false where versao = '2026-06';

commit;

-- Conferência: explorador deve ver 5 etapas (1,2,3,5,8); plano pago vê as 8.
-- select ordem, titulo, roles from public.tour_etapas
--  where versao='2026-08' and ativo and (roles = '{}' or 'explorador' = any(roles)) order by ordem;
