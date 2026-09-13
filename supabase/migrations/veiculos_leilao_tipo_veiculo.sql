-- Pedido do dono (13/09): filtro por "tipo de veículo" (carro/moto/caminhão/etc) na tela
-- /veiculos. Nenhuma fonte grava isso hoje — nem a coluna existia. Não é o mesmo campo que
-- `sinistro` ("tipo de monta": severidade de dano/sucata) nem `modalidade`
-- (judicial/extrajudicial) — os dois já ocupam nomes parecidos e são conceitos diferentes.
--
-- Sem sinal estruturado de nenhuma fonte hoje (nenhuma API/plataforma expõe categoria de
-- veículo como campo próprio, ao contrário de `lot_is_judicial` da Sodré para modalidade) —
-- então, como marca/modelo, é inferência por palavra no título/descrição do PRÓPRIO
-- leiloeiro. Não é ausência de linha: fica NULL quando o texto não dá nenhum sinal claro
-- (mesmo tratamento de `marca`/`motor_alerta`, não o de `modalidade`/`status_patio`, que
-- têm um estado "não identificado" explícito porque TODA fonte precisa de uma resposta ali).
--
-- Classificador canônico vive em JS (scripts/scraper-puppeteer.mjs, `classificarTipoVeiculo`)
-- e roda em toda coleta nova daqui pra frente. Este UPDATE é só o backfill do acervo já
-- coletado, mesma ordem de prioridade do JS (categorias específicas antes do fallback
-- genérico "carro") — sem isso o filtro ficaria vazio até o próximo cron de cada fonte rodar.
alter table public.veiculos_leilao add column if not exists tipo_veiculo text;

-- CORREÇÃO (mesmo dia, achado ao medir): a 1ª versão dependia só de palavra EXPLÍCITA de
-- categoria ("moto", "caminhão"...) — e ficou 94% NULL (3.448 de 3.655), porque um título
-- real de veículo quase nunca diz "moto": diz a marca+modelo ("HONDA CG 160 START",
-- "HONDA NXR125 BROS", "HONDA C100 BIZ"). Sem um 2º nível reconhecendo os NOMES DE MODELO
-- mais comuns de moto no Brasil (vocabulário fechado e bem conhecido, diferente de tentar
-- enumerar modelo de carro — esse sim, espaço grande demais pra ser seguro adivinhar aqui),
-- a maioria das motos ficava invisível ao filtro. Nenhum fallback "assume carro por marca"
-- foi adicionado de propósito: uma marca como Chevrolet vende tanto sedã quanto picape
-- (a amostra real trouxe "CHEVROLET D20", uma picape) — adivinhar por marca arriscaria
-- rotular picape/utilitário como carro errado; melhor ficar NULL do que errado.
update public.veiculos_leilao
set tipo_veiculo = case
  when (titulo || ' ' || coalesce(descricao, '')) ~* '\ymoto(cicleta|neta)?s?\y|\yscooter\y|\ytricic(lo|los)?\y|\yquadricic(lo|los)?\y'
    or (titulo || ' ' || coalesce(descricao, '')) ~* '\y(cg|titan|bros|nxr|fan|biz|pop|pcx|xre|cbr?|lead|elite|fazer|ybr|factor|crypton|xtz|tenere|nmax|crosser|hornet|twister|falcon|burgman|shineray|traxx|neo)\y' then 'moto'
  when (titulo || ' ' || coalesce(descricao, '')) ~* '\y[oô]nibus\y|\ymicro-?[oô]nibus\y' then 'onibus'
  when (titulo || ' ' || coalesce(descricao, '')) ~* '\ycaminh(ão|oes|ões)\y|\ycarreta\y|\ycavalo mec[âa]nico\y' then 'caminhao'
  when (titulo || ' ' || coalesce(descricao, '')) ~* '\yvan\y|\yfurg[ãa]o\y|\ykombi\y|\yutilit[áa]rio\y' then 'van_utilitario'
  when (titulo || ' ' || coalesce(descricao, '')) ~* '\ytrator(es)?\y|\ym[áa]quina (agr[íi]cola|pesada)\y|\yretroescavadeira\y|\ymotoniveladora\y|\yempilhadeira\y|\ycolheitadeira\y' then 'maquina'
  when (titulo || ' ' || coalesce(descricao, '')) ~* '\ysemi-?reboque\y|\yreboque\y' then 'reboque'
  when (titulo || ' ' || coalesce(descricao, '')) ~* '\ylancha\y|\yembarca[çc][ãa]o\y|\ybarco\y|\yjet-?ski\y' then 'embarcacao'
  when (titulo || ' ' || coalesce(descricao, '')) ~* '\ycaminhonete\y|\ypick-?up\y|\yautom[óo]vel\y|\ycarro\y|\ypicape\y' then 'carro'
  else null
end
where tipo_veiculo is null;
