# 🔎 Playbook de RECON de leiloeiro (para futuros scrapers saírem mais rápido)

> Objetivo: quando entrar um leiloeiro NOVO, este roteiro diz o que IDENTIFICAR (linguagem/stack,
> se é SPA, as APIs internas + parâmetros) para decidir o scraper. Complementa
> `docs/LEILOEIROS_TRT15_BACKLOG.md` (o backlog) e `leiloeiro_conhecimento` (o que já sabemos).

## 1) O que verificar em CADA leiloeiro (checklist)
1. **Linguagem/stack** — PHP? WordPress? Laravel? SPA React(Next)/Vue(Nuxt)/Angular? jQuery? ASP.NET?
   O recon automático (`scripts/recon-leiloeiros-backlog.mjs`) já detecta e imprime `STACK/linguagem`.
2. **É SPA?** (next/nuxt/Vue/Angular ou "ative seu javascript") → o HTML cru NÃO tem os lotes;
   os dados vêm por **API JSON em runtime** (passo 3). Se for server-rendered (HTML já traz R$/lote),
   dá para raspar o HTML direto (padrão `scraper-gestao`/`scraper-soleon`).
3. **APIs internas + PARÂMETROS** (o mais importante para SPA). Descubra e anote:
   - **URL** do endpoint de lotes (ex.: `/core/api/get-lotes`, `/api/lotes`, `/busca.json`).
   - **Método**: GET ou **POST** (muitos recusam GET → "Método não permitido").
   - **Body/params**: paginação (`page=N`), filtro (`leilao_id`, `categoria`), ordenação.
   - **Headers exigidos**: `X-Requested-With: XMLHttpRequest`, `Content-Type`, `Referer`, cookies
     same-origin (visitar 1 página antes p/ pegar cookie).
   - **Formato da resposta**: paginação (`totalPages`/`nextPage`) + campos do lote.
4. **Anti-bot / IP**: o site bate **403 em IP de datacenter** (CI/Vercel)? Se sim, precisa Bright Data
   (pago) OU rodar de IP residencial. A API JSON costuma ser mais liberada que o HTML.
5. **Login-gated?** matrícula/edital atrás de login → pipeline próprio (ver ZUK/GRUPOLANCE).

## 2) Como MAPEAR as APIs de uma SPA (no navegador — grátis, sem Bright Data)
O recon automático só busca a home; as chamadas JSON de uma SPA só aparecem em **runtime**. Abra o
site no **seu Chrome** (F12 → Console), cole o grampo abaixo, **interaja** (filtre Imóveis / próxima
página / `__scroll()`) e rode `__dump()` — ele devolve as APIs chamadas + corpo da resposta.

```js
(() => {
  if (window.__vmap) return console.log('já instalado — interaja e rode __dump()');
  const cap = [];
  const ok = u => u && /\/(leilao|lote|imove|busca|search|api|ajax|filtr|paginac|listar|json)/i.test(u)
               && !/\.(css|js|png|jpe?g|webp|gif|svg|woff2?|ico|map)(\?|$)/i.test(u);
  const of = window.fetch;
  window.fetch = async function (...a) {
    const url = String((a[0] && a[0].url) || a[0] || ''), opt = a[1] || {};
    const r = await of.apply(this, a);
    try { if (ok(url)) { const t = await r.clone().text();
      cap.push({ via:'fetch', method:(opt.method||(a[0]&&a[0].method)||'GET'), url, body:opt.body||null, status:r.status, resp:t.slice(0,5000) }); } } catch {}
    return r;
  };
  const oO = XMLHttpRequest.prototype.open, oS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m,u){ this.__m=m; this.__u=String(u); return oO.apply(this,arguments); };
  XMLHttpRequest.prototype.send = function (b){ this.addEventListener('load',()=>{ try{ if(ok(this.__u))
    cap.push({via:'xhr',method:this.__m,url:this.__u,body:b||null,status:this.status,resp:String(this.responseText||'').slice(0,5000)}); }catch{} }); return oS.apply(this,arguments); };
  window.__scroll = async () => { for(let i=0;i<12;i++){ window.scrollTo(0,document.body.scrollHeight); await new Promise(r=>setTimeout(r,700)); } console.log('scroll ok — rode __dump()'); };
  window.__dump = () => {
    const recs = [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(ok))].slice(0,50);
    const dom = [...document.querySelectorAll('a[href*="/lote"],[onclick*="lote"],[class*="lote"],[class*="card"]')].slice(0,6).map(el=>el.outerHTML.replace(/\s+/g,' ').slice(0,400));
    const out = { pagina: location.href, apis_de_dados_ja_carregadas: recs, chamadas_capturadas: cap, amostra_lotes_no_dom: dom };
    console.log(JSON.stringify(out, null, 2)); return out;
  };
  window.__vmap = true;
  console.log('✅ Mapper instalado. 1) filtre "Imóveis" e vá p/ a próxima página (ou __scroll()). 2) __dump().');
})();
```

## 3) Casos JÁ MAPEADOS (plug-and-play para tenants da mesma plataforma)

### Vlance (`/v3/` + `/core/api/`) — PHP + jQuery SPA
Tenants confirmados: **verdeamarelo, sudeste, capitalvalor** (destak é Vlance com outro front `/Core/V1/` — remapear).
As APIs são **por tenant** (cada domínio serve os SEUS lotes na MESMA rota):
- `GET  /core/api/get-leiloes` → eventos (leilão-pai): `items[]` com `id, nm, dt_formatada, nu_qtdelotes, nm_url_leiloeiro, tp_judicial_extrajudicial`.
- `POST /core/api/get-lotes` · `Content-Type: application/x-www-form-urlencoded` · body **`page=N`**
  (opcional `leilao_id=<ID>&page=N`). **GET é recusado** ("Método não permitido"). Traz **todas as
  categorias** de uma vez → filtrar `nm_categoria=="Imóveis"` no cliente. Paginação por `totalPages`/`nextPage`.
  Campos-chave do lote: `lote_id, leilao_id, nm_titulo_lote, nm_categoria, nm_subcategoria, nm_cidade,
  nm_estado, vl_lanceminimo, vl_lanceinicial, vl_venda, vl_lanceinicialsegundoleilao, dt_fechamento_formatado,
  nm_statuslote, imovel_id, fotos[], nm_leiloeiro`.
- Headers: `X-Requested-With: XMLHttpRequest`, `Referer` same-origin, cookies (visitar 1 página antes).
- **403 em IP de datacenter** → rodar de IP residencial (grátis) OU Bright Data render (pago) na CI.
- Implementação: `scripts/scraper_vlance.py` — **multi-tenant** (parametrizado por `--dominios`;
  default verdeamarelo+sudeste+capitalvalor) + **ingestão opcional no acervo** (`--supabase` →
  upsert `imoveis_leilao` fonte `VLANCE`, dedup por `fonte_id`, pula simulação/encerrados).
  Rodar de IP residencial (a API dá 403 em datacenter → CI só com Bright Data).

### Outras plataformas já resolvidas (ver os scripts)
- **Gestão de Leilões (PHP, server-rendered)**: `leilao.php?idLeilao=N` = evento multi-lote inline, latin1.
  `scripts/scraper-gestao.mjs` (granado, lancenoleilao, extrajust, lancetotal, **vinco**).
- **SOLEON**: `/lotes/imovel?tipo=imovel&page=N` + `/item/{id}/detalhes`. `scripts/scraper-soleon.mjs` (calil, vegas, 3torres).
- **SUPERBID rede**: API `offer-query.superbid.net/offers/?portalId=[N]`. `scraper-puppeteer.mjs`.

## 4) Ao integrar um novo leiloeiro
1. Registrar em `leiloeiro_conhecimento` (fonte, custo grátis/pago, `arquivar_docs`, plataforma).
2. O **monitor auto-aprendido** passa a vigiá-lo após alguns runs (sem hardcode).
3. Atualizar `docs/LEILOEIROS_TRT15_BACKLOG.md` (marcar integrado) + este playbook se a plataforma for nova.
