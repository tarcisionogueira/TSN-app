-- Base de CONHECIMENTO dos leiloeiros (Passo 1 do plano do agente scraper).
-- Persiste o que ACELERA a próxima integração: plataforma, caminho de acesso e custo,
-- enumeração, padrão da URL do lote, qual scraper resolve e — o mais valioso — quais
-- outros leiloeiros da MESMA plataforma reusam a solução. Semeado com o aprendizado das
-- integrações atuais + as novas (LEILOFY, PECINI, RJ/SOLEON).
--
-- Uso: ao pedir um leiloeiro novo, o agente consulta esta tabela. Se a plataforma já é
-- conhecida (ex.: outro SOLEON, outro Superbid), reusa o scraper → integração em minutos.
create table if not exists public.leiloeiro_conhecimento (
  fonte         text primary key,
  plataforma    text,          -- SOLEON | Superbid | Caixa-CSV | ASP.NET-DefaultClean | SPA-proprio | agregador | Gov | a_confirmar
  acesso        text,          -- csv | api_json | fetch_direto | puppeteer | brightdata  (degrau vencedor)
  custo         text,          -- gratis | pago
  anti_bot      text,          -- nenhum | leve | cloudflare | login | rate_limit
  enumeracao    text,          -- csv | api_json | sitemap | listagem_paginada | agregador
  url_lote      text,          -- padrão da página do lote
  scraper       text,          -- arquivo/função que integra
  reusavel_por  text,          -- quem reusa esta solução (mesma plataforma)
  qualidade     numeric(4,3),  -- referência (fonte_saude)
  observacao    text,
  aprendido_em  timestamptz default now(),
  atualizado_em timestamptz default now()
);
alter table public.leiloeiro_conhecimento enable row level security;
drop policy if exists "service_only_conhecimento" on public.leiloeiro_conhecimento;
create policy "service_only_conhecimento" on public.leiloeiro_conhecimento for all using (false);

insert into public.leiloeiro_conhecimento
  (fonte, plataforma, acesso, custo, anti_bot, enumeracao, url_lote, scraper, reusavel_por, qualidade, observacao) values
-- ── Deeply mapped (conhecimento rico) ─────────────────────────────────────────
('CEF','Caixa-CSV','csv','gratis','nenhum','csv','ficha CEF (F{num}21.jpg)','scripts/scraper.js + foto-cef.mjs','—',1.000,'maior acervo; foto self-host no Storage (Caixa bloqueia IP Vercel)'),
('LEILOFY','SPA-proprio (Leiloaria Smart)','puppeteer','gratis','leve','listagem_paginada','/imovel/{id}','scraper-puppeteer.mjs:scraperLeilofy','leiloarias SPA próprias',0.950,'SPA: esperar render (waitForFunction); preço por rótulo; docs em /_admin_/upload/*.pdf'),
('RJLEILOES','SOLEON','brightdata','pago','cloudflare','listagem_paginada','/item/{id}/detalhes','scraper-rj.mjs','TODO leiloeiro SOLEON',0.950,'grátis falhou → Web Unlocker. Rótulos Lance Inicial/Avaliação; docs no CDN gocache; cidade/UF do título'),
('PECINI','ASP.NET-DefaultClean','brightdata','pago','cloudflare','sitemap','/lote/{slug}/{id}/','scraper-pecini.mjs','outros DefaultClean',0.800,'sitemap = feed de listings; trimpath ValorMinimoLance...; Web Unlocker'),
('LJUD','agregador (getLotes)','puppeteer','gratis','nenhum','api_json','(home — sem página de lote própria)','scraper-puppeteer.mjs','agregadores sem lote',0.630,'endereço vem da matrícula; não gravar url_lote=home'),
('SUPERBID','Superbid','api_json','gratis','nenhum','api_json','linkURL (link_edital)','scraper-puppeteer.mjs','SBID9/SBID21',0.990,'matrícula raramente pública no lote'),
('SBID9','Superbid (sub-portal)','api_json','gratis','nenhum','api_json','linkURL','scraper-puppeteer.mjs','= SUPERBID',1.000,'sub-portal Superbid'),
('SBID21','Superbid (sub-portal)','api_json','gratis','nenhum','api_json','linkURL','scraper-puppeteer.mjs','= SUPERBID',1.000,'sub-portal Superbid'),
('VENDASGOV','Gov (API)','api_json','gratis','nenhum','api_json','/imovel/{id}/{idItemEdital}','scraper-puppeteer.mjs','—',1.000,'Imóveis da União'),
('ZUK','Zukerman (SSR)','puppeteer','gratis','nenhum','listagem_paginada','/imovel/uf/cidade/...','scraper-puppeteer.mjs','—',1.000,'listagem com scroll infinito; matrícula via captura-matricula-zuk'),
('SODRE','Sodré Santoro (search-lots)','api_json','gratis','nenhum','api_json','(og:image no lote)','scraper-puppeteer.mjs + captura-docs-sodre.mjs','—',0.947,'foto via og:image na página do lote'),
('GRUPOLANCE','a_confirmar','puppeteer','gratis','nenhum','listagem_paginada',null,'scraper-puppeteer.mjs + captura-matricula-grupolance.mjs','—',1.000,'matrícula por script dedicado'),
('FRAZAO','a_confirmar','puppeteer','gratis','nenhum','listagem_paginada',null,'scraper-puppeteer.mjs + captura-docs-frazao.mjs','—',1.000,null),
('MEGA','a_confirmar','puppeteer','gratis','nenhum','listagem_paginada',null,'scraper-puppeteer.mjs','—',1.000,'PDFs em CDN (cdn1.megaleiloes)'),
('BIASI','a_confirmar','puppeteer','gratis','nenhum','listagem_paginada',null,'scraper-puppeteer.mjs','—',1.000,null),
('PESTANA','a_confirmar','puppeteer','gratis','nenhum','listagem_paginada',null,'scraper-puppeteer.mjs','—',0.963,null),
('LEILOTECH','white-label','puppeteer','gratis','nenhum','listagem_paginada',null,'scraper-puppeteer.mjs','outros white-label',0.879,null),
('WEBLEILOES','a_confirmar','puppeteer','gratis','nenhum','listagem_paginada',null,'scraper-puppeteer.mjs','—',1.000,'regras de venda online presentes'),
('VIP','a_confirmar','puppeteer','gratis','nenhum','listagem_paginada',null,'scraper-puppeteer.mjs','—',1.000,null),
('SOLD','a_confirmar','puppeteer','gratis','nenhum','listagem_paginada',null,'scraper-puppeteer.mjs','—',1.000,'docs por UUID opaco → classificação "outro"')
on conflict (fonte) do update set
  plataforma=excluded.plataforma, acesso=excluded.acesso, custo=excluded.custo,
  anti_bot=excluded.anti_bot, enumeracao=excluded.enumeracao, url_lote=excluded.url_lote,
  scraper=excluded.scraper, reusavel_por=excluded.reusavel_por, qualidade=excluded.qualidade,
  observacao=excluded.observacao, atualizado_em=now();
