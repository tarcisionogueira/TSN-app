"""
Carrega RESTRIÇÕES TERRITORIAIS no banco (tabela restricao_territorial, migração
20260929_restricao_territorial.sql): Unidades de Conservação (CNUC/MMA, Brasil) e áreas de
proteção de MANANCIAIS (DataGEO/SP). Roda no runner (a nuvem do Claude não alcança essas fontes).

MODO=seco (padrão) imprime o que achou — recursos, camadas, colunas, contagens e pontos de
conferência — e NÃO grava. MODO=gravar grava e reclassifica os imóveis. Custo zero.
Env: MODO · CAMADAS (opcional: "uc", "manancial" ou ambas) · VITE_SUPABASE_URL · SUPABASE_SERVICE_KEY.
"""
import io, json, os, re, sys, tempfile, time, urllib.request, zipfile
import xml.etree.ElementTree as ET

import geopandas as gpd
import shapely
from shapely.geometry import Point, mapping

MODO = os.environ.get('MODO', 'seco')
CAMADAS = [c.strip() for c in (os.environ.get('CAMADAS') or 'uc,manancial').split(',') if c.strip()]
SB_URL = os.environ.get('VITE_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
SB_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
CNUC_API = 'https://dados.mma.gov.br/api/3/action/package_show?id=unidadesdeconservacao'
DATAGEO_WFS = 'http://datageo.ambiente.sp.gov.br/geoserver/wfs'
RE_MANANCIAL = re.compile(r'APRM|\bAPM\b|MANANC', re.I)
TOLERANCIA = 0.0002   # ~22 m
LOTE_BYTES = 3_000_000
UA = {'User-Agent': 'Mozilla/5.0 (BidPro carga de dados abertos)'}
PROTECAO_INTEGRAL = re.compile(r'esta[cç][aã]o ecol|reserva biol|parque|monumento natural|ref[uú]gio', re.I)

# (camada, descrição, lat, lng, trecho esperado no nome — None = nenhum item dessa camada)
PONTOS = [
    ('manancial', 'Lote Embu-Guaçu (leilaobrasil_449)', -23.8314512, -46.811523, 'guarapiranga'),
    ('manancial', 'Praça da Sé, São Paulo', -23.5503, -46.6339, None),
    ('uc', 'Parque Nacional da Serra da Canastra', -20.2500, -46.6000, 'canastra'),
    ('uc', 'Praça da Sé, São Paulo', -23.5503, -46.6339, None),
]


def baixar(url, timeout=300):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def coluna(df, padroes):
    for p in padroes:
        for c in df.columns:
            if re.fullmatch(p, c, re.I):
                return c
    return None


def ler_geo(conteudo, nome_hint=''):
    """Lê zip (shp/gpkg/geojson dentro) ou GeoJSON cru."""
    if conteudo[:2] == b'PK':
        with tempfile.TemporaryDirectory() as tmp:
            caminho = os.path.join(tmp, 'd.zip')
            open(caminho, 'wb').write(conteudo)
            nomes = zipfile.ZipFile(caminho).namelist()
            alvo = next((n for n in nomes if n.lower().endswith('.gpkg')), None) \
                or next((n for n in nomes if n.lower().endswith('.shp')), None) \
                or next((n for n in nomes if n.lower().endswith(('.geojson', '.json'))), None)
            if not alvo:
                raise SystemExit(f'{nome_hint}: zip sem camada geográfica ({nomes[:8]})')
            return gpd.read_file(f'zip://{caminho}!{alvo}')
    return gpd.read_file(io.BytesIO(conteudo))


def simplificar(g):
    g = shapely.make_valid(g)
    g = shapely.set_precision(g.simplify(TOLERANCIA, preserve_topology=True), 1e-6)
    return None if g.is_empty else g


def carregar_ucs():
    pkg = json.loads(baixar(CNUC_API, 60))
    recursos = pkg.get('result', {}).get('resources', [])
    print('CNUC — recursos no portal:')
    for r in recursos:
        print(f"   · {r.get('name')!r} [{r.get('format')}] {r.get('url')}")
    # Só ZIP servido pelo PRÓPRIO portal: a versão 2026 aponta para o SharePoint do MMA, que
    # devolve uma página HTML de login em vez do arquivo (29/09 — quebrou o 1º seco).
    geo = [r for r in recursos if re.match(r'https?://dados\.mma\.gov\.br/.+\.zip$', str(r.get('url') or ''), re.I)]
    if not geo:
        raise SystemExit('CNUC: nenhum ZIP geográfico direto no portal — nada gravado.')
    # Mais recente pela data no NOME do arquivo (shp_cnuc_2025_08.zip).
    geo.sort(key=lambda r: re.sub(r'\D', '', str(r['url']).rsplit('/', 1)[1]), reverse=True)
    r = geo[0]
    print(f"CNUC — usando: {r.get('name')!r} {r.get('url')}")
    df = ler_geo(baixar(r['url']), 'CNUC').to_crs(4326)
    print(f'   colunas: {list(df.columns)}')
    c_nome = coluna(df, [r'nome_uc\d*', r'nome', r'nm_uc', r'uc_nome'])
    c_cat = coluna(df, [r'categori\w*', r'cat_\w+'])
    c_grupo = coluna(df, [r'grupo\d*'])
    c_esf = coluna(df, [r'esfera\d*'])
    c_uf = coluna(df, [r'uf\d*', r'sigla_uf'])
    c_id = coluna(df, [r'id_uc\d*', r'cd_cnuc\d*', r'cnuc', r'codigo_uc', r'uc_id'])
    if not c_nome:
        raise SystemExit('CNUC: coluna de nome não identificada — nada gravado.')
    itens = []
    for i, row in df.iterrows():
        g = simplificar(row.geometry) if row.geometry is not None else None
        if g is None:
            continue
        cat = str(row[c_cat]) if c_cat else None
        grupo = str(row[c_grupo]) if c_grupo else ('PI' if cat and PROTECAO_INTEGRAL.search(cat) else 'US')
        itens.append({'camada': 'uc', 'codigo': str(row[c_id]) if c_id else f'uc{i}', 'nome': str(row[c_nome]),
                      'categoria': cat, 'grupo': grupo, 'subarea': None,
                      'esfera': str(row[c_esf]) if c_esf else None, 'uf': str(row[c_uf])[:40] if c_uf else None, 'geom': g})
    print(f'   {len(itens)} UCs com geometria · amostra: {[x["nome"] for x in itens[:3]]}')
    return itens


def carregar_mananciais():
    cap = baixar(f'{DATAGEO_WFS}?service=WFS&version=1.0.0&request=GetCapabilities', 120)
    raiz = ET.fromstring(cap)
    camadas = []
    for ft in raiz.iter():
        if ft.tag.endswith('FeatureType'):
            nome = next((c.text for c in ft if c.tag.endswith('Name')), '') or ''
            titulo = next((c.text for c in ft if c.tag.endswith('Title')), '') or ''
            if RE_MANANCIAL.search(nome) or RE_MANANCIAL.search(titulo):
                camadas.append((nome, titulo))
    print(f'DataGEO — {len(camadas)} camada(s) de mananciais:')
    for n, t in camadas:
        print(f'   · {n} — {t}')
    if not camadas:
        raise SystemExit('DataGEO: nenhuma camada de mananciais no GetCapabilities — nada gravado.')
    itens = []
    for nome, titulo in camadas:
        url = (f'{DATAGEO_WFS}?service=WFS&version=1.0.0&request=GetFeature&typeName={nome}'
               f'&outputFormat=application/json&srsName=EPSG:4326')
        try:
            df = ler_geo(baixar(url), nome)
        except Exception as e:   # uma camada ruim não derruba as outras; fica no log
            print(f'   ✗ {nome}: {str(e)[:160]}')
            continue
        if df.empty or not df.geom_type.isin(['Polygon', 'MultiPolygon']).any():
            print(f'   – {nome}: sem polígonos ({len(df)} feições) — ignorada')
            continue
        if df.crs is None:
            df = df.set_crs(4326)
        df = df.to_crs(4326)
        c_sub = coluna(df, [r'sub\w*', r'nm_sub\w*', r'zona\w*', r'classe\w*'])
        print(f'   {nome}: {len(df)} feições · colunas {list(df.columns)[:12]} · subárea={c_sub}')
        grupos = df.groupby(df[c_sub].astype(str)) if c_sub else [(None, df)]
        for sub, gdf in grupos:
            g = simplificar(shapely.union_all(gdf.geometry.values))
            if g is None:
                continue
            itens.append({'camada': 'manancial', 'codigo': f'{nome}|{sub or ""}'[:200], 'nome': titulo or nome,
                          'categoria': 'Área de proteção de mananciais', 'grupo': None, 'subarea': sub,
                          'esfera': 'estadual', 'uf': 'SP', 'geom': g})
    return itens


def rpc(nome, corpo):
    req = urllib.request.Request(f'{SB_URL}/rest/v1/rpc/{nome}', data=json.dumps(corpo).encode(), method='POST',
                                 headers={'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Content-Type': 'application/json'})
    for t in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if e.code < 500 or t == 3:
                raise SystemExit(f'RPC {nome}: HTTP {e.code} {msg}')
        except urllib.error.URLError as e:
            if t == 3:
                raise SystemExit(f'RPC {nome}: {e}')
        time.sleep(2 ** (t + 1))


def gravar(itens):
    lote, tam, total = [], 0, 0
    for it in itens:
        gj = json.dumps(mapping(it['geom']))
        item = {k: v for k, v in it.items() if k != 'geom'} | {'geojson': gj}
        if lote and tam + len(gj) > LOTE_BYTES:
            total += rpc('carregar_restricao_territorial', {'p': lote}); lote, tam = [], 0
        lote.append(item); tam += len(gj)
    if lote:
        total += rpc('carregar_restricao_territorial', {'p': lote})
    if total != len(itens):
        raise SystemExit(f'gravou {total} de {len(itens)}')
    return total


def main():
    if MODO == 'gravar' and not (SB_URL and SB_KEY):
        raise SystemExit('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY')
    por_camada = {}
    if 'uc' in CAMADAS:
        por_camada['uc'] = carregar_ucs()
    if 'manancial' in CAMADAS:
        por_camada['manancial'] = carregar_mananciais()
    falhas = 0
    for camada, desc, lat, lng, esperado in PONTOS:
        if camada not in por_camada:
            continue
        pt = Point(lng, lat)
        achou = [f"{x['nome']}{' / ' + str(x['subarea']) if x['subarea'] else ''}" for x in por_camada[camada] if x['geom'].contains(pt)]
        ok = (not achou) if esperado is None else any(esperado in a.lower() for a in achou)
        falhas += 0 if ok else 1
        print(f'   ponto [{camada}] {desc}: {achou or "nenhum"}' + ('' if ok else f'  ✗ esperado {esperado or "nenhum"}'))
    tam = sum(len(json.dumps(mapping(x['geom']))) for v in por_camada.values() for x in v)
    print(f'Total: {sum(len(v) for v in por_camada.values())} polígonos · {tam / 1e6:.1f} MB de GeoJSON')
    if falhas:
        raise SystemExit(f'{falhas} ponto(s) de conferência errado(s) — nada gravado.')
    if MODO != 'gravar':
        print('Seco: nada gravado.')
        return
    for camada, itens in por_camada.items():
        print(f'✅ {camada}: {gravar(itens)} gravados')
    reclass = 0
    while True:
        n = rpc('reclassificar_restricoes_geo', {'p_limite': 300}) or 0
        reclass += n
        if not n:
            break
    print(f'✅ {reclass} imóveis reclassificados')


if __name__ == '__main__':
    main()
