-- ANEXO QUE ABRIA CÓDIGO — limpeza do que já está gravado.
--
-- ACHADO DO DONO (03/08, lote `vegas_7588`): ele clicou num anexo do lote e recebeu CÓDIGO na
-- tela. Era `jquery.min.js` / `global.css` — o TEMA do site do leiloeiro, listado como
-- "Documento no leiloeiro".
--
-- Causa-raiz (corrigida em api/_doc-scan.js): para URL SEM extensão de documento, a varredura
-- aceitava o sinal genérico de host (`amazonaws|storage|blob.core|/file`) ou uma palavra-chave
-- no texto da âncora. Só que o bucket do leiloeiro hospeda o site inteiro, o pixel do Bing
-- carrega o TÍTULO do lote na querystring (com a palavra "avaliação"), o botão "ENVIAR
-- PROPOSTA" aponta para /licitante/login e "Leia atentamente o edital" para /glossario.
-- Resultado: js, css, pixel de rastreio, tela de login e âncora da própria página entravam
-- como anexo do lote.
--
-- Não era só cosmético: havia entrada de `bat.bing.com` gravada com **tipo = matricula** —
-- o laudo documental contava essa linha como matrícula presente.
--
-- Esta migração remove do jsonb `anexos` exatamente o que o filtro novo passaria a barrar.
-- Idempotente (rodar de novo não muda nada) e conservadora: qualquer .pdf/.doc/.xls é
-- PRESERVADO, mesmo que more em /assets/ — arquivo de verdade nunca é ruído.

create or replace function public.anexo_e_ruido_de_pagina(p_url text)
returns boolean
language sql
immutable
as $$
  select case
    when p_url is null or p_url !~* '^https?://' then true
    -- Arquivo de documento SEMPRE fica, venha de onde vier.
    when p_url ~* '\.(pdf|docx?|xlsx?|odt|rtf)(\?|#|$)' then false
    else
      -- ativo estático do tema (js/css/fonte/sourcemap) e caminho de build
         p_url ~* '\.(m?js|cjs|css|s[ac]ss|less|map|json|xml|txt|ico|woff2?|ttf|eot|otf|svgz?|mp4|webm|m3u8|wasm)(\?|#|$)'
      or p_url ~* '/(assets?|static|dist|build|vendor|node_modules|bundles?|themes?|templates?|plugins?|components?|libs?|_next|wp-includes)/'
      or p_url ~* '\.min\.[a-z0-9]{2,5}(\?|#|$)'
      -- página de conta/institucional do portal (login, glossário, contato…)
      or p_url ~* '/(login|signin|sign-in|entrar|logout|sair|cadastr\w*|registrar|licitante|habilita\w*|authorization|authorize|oauth|minha-conta|meus-dados|carrinho|checkout|gloss[aá]rio|glossario|faq|contato|fale-conosco|quem-somos)(/|\?|#|$)'
      -- link de campanha/rastreio: documento não carrega utm_source/gclid
      or p_url ~* '[?&](utm_[a-z]+|gclid|fbclid|msclkid|mc_eid)='
      -- host de analytics/chat/CDN de biblioteca
      or p_url ~* '(google-analytics|googletagmanager|gstatic|googleapis|cookielaw|onetrust|facebook|fbcdn|doubleclick|hotjar|cloudflareinsights|recaptcha|youtube|ytimg|gravatar|fontawesome|bat\.bing|clarity\.ms|lpsnmedia|lpcdn|segment\.(io|com)|mixpanel|newrelic|sentry|criteo|taboola|outbrain|rdstation|tiktok|licdn|jsdelivr|unpkg|bootstrapcdn|jquery)\.'
      -- rótulo de anúncio virado link (traz o PREÇO no caminho)
      or p_url ~* 'R\$|lance%20inicial|lance\+inicial'
      -- home do leiloeiro / âncora da própria página (#tab-parcelamento)
      or p_url ~* '^https?://[^/]+/?(#|\?|$)'
  end;
$$;

comment on function public.anexo_e_ruido_de_pagina(text) is
  'Espelho SQL do filtro de api/_doc-scan.js: TRUE quando a URL e ativo do site/rastreio/pagina de conta, nao documento do lote. Preserva sempre .pdf/.doc/.xls.';

update public.imoveis_leilao i
   set anexos = coalesce((
         select jsonb_agg(e order by ord)
           from jsonb_array_elements(i.anexos) with ordinality t(e, ord)
          where not public.anexo_e_ruido_de_pagina(e->>'url')
       ), '[]'::jsonb)
 where jsonb_typeof(i.anexos) = 'array'
   and exists (
         select 1 from jsonb_array_elements(i.anexos) e
          where public.anexo_e_ruido_de_pagina(e->>'url')
       );
