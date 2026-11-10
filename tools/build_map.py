import json, math, sys
NE, TW, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
BBOX = (112.5, 19.0, 126.5, 30.5)  # lon0, lat0, lon1, lat1

def clip(ring):
    def clip_edge(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            cur, prev = pts[i], pts[i-1]
            if inside(cur):
                if not inside(prev): out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev): out.append(inter(prev, cur))
        return out
    x0,y0,x1,y1 = BBOX
    def ix(a,b,x): t=(x-a[0])/(b[0]-a[0]); return (x, a[1]+t*(b[1]-a[1]))
    def iy(a,b,y): t=(y-a[1])/(b[1]-a[1]); return (a[0]+t*(b[0]-a[0]), y)
    p = ring
    for inside, inter in [(lambda q:q[0]>=x0, lambda a,b:ix(a,b,x0)), (lambda q:q[0]<=x1, lambda a,b:ix(a,b,x1)),
                          (lambda q:q[1]>=y0, lambda a,b:iy(a,b,y0)), (lambda q:q[1]<=y1, lambda a,b:iy(a,b,y1))]:
        if not p: break
        p = clip_edge(p, inside, inter)
    return p

def dp(pts, tol):
    if len(pts) < 4: return pts
    keep = [False]*len(pts); keep[0]=keep[-1]=True
    stack=[(0,len(pts)-1)]
    while stack:
        a,b = stack.pop(); ax,ay=pts[a]; bx,by=pts[b]; dx,dy=bx-ax,by-ay; L=dx*dx+dy*dy
        best,bi=-1,-1
        for i in range(a+1,b):
            px,py=pts[i]
            if L==0: d=(px-ax)**2+(py-ay)**2
            else:
                t=max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L)); d=(px-ax-t*dx)**2+(py-ay-t*dy)**2
            if d>best: best,bi=d,i
        if best > tol*tol: keep[bi]=True; stack += [(a,bi),(bi,b)]
    return [p for p,k in zip(pts,keep) if k]

def area(r): return abs(sum(r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1] for i in range(len(r))))/2

def rings_of(geom):
    polys = [geom['coordinates']] if geom['type']=='Polygon' else geom['coordinates']
    for poly in polys:
        yield poly[0]   # outer ring only (holes ignored)

def process(geom, tol, min_area):
    out=[]
    for ring in rings_of(geom):
        r = clip([tuple(p[:2]) for p in ring])
        if len(r) < 4 or area(r) < min_area: continue
        r = dp(r + [r[0]], tol)[:-1]
        if len(r) < 3: continue
        out.append([v for p in r for v in (round(p[0],3), round(p[1],3))])
    return out

ne = json.load(open(NE))
china, other = [], []
for f in ne['features']:
    a = f['properties'].get('ADMIN')
    if a == 'China': china += process(f['geometry'], 0.005, 2e-4)
    elif a in ('Japan', 'Philippines'): other += process(f['geometry'], 0.004, 5e-5)

ZONE = {'台北市':'taipei','新北市':'taipei','基隆市':'taipei','桃園縣':'taoyuan','新竹縣':'hsinchu','新竹市':'hsinchu',
  '苗栗縣':'miaoli','台中市':'taichung','彰化縣':'changhua','南投縣':'nantou','雲林縣':'yunlin','嘉義縣':'chiayi','嘉義市':'chiayi',
  '台南市':'tainan','高雄市':'kaohsiung','屏東縣':'pingtung','宜蘭縣':'yilan','花蓮縣':'hualien','台東縣':'taitung',
  '澎湖縣':'penghu','金門縣':'kinmen','連江縣':'matsu'}
tw = json.load(open(TW))
counties=[]
for f in tw['features']:
    n=f['properties']['COUNTYNAME']
    rings=process(f['geometry'], 0.003, 1.5e-5)
    if rings: counties.append({'name':n,'zone':ZONE[n],'rings':rings})

# zone label anchor = area-weighted centroid of zone rings
cent={}
for c in counties:
    for r in c['rings']:
        pts=list(zip(r[0::2],r[1::2])); a=area(pts)
        cx=sum(p[0] for p in pts)/len(pts); cy=sum(p[1] for p in pts)/len(pts)
        s=cent.setdefault(c['zone'],[0,0,0]); s[0]+=cx*a; s[1]+=cy*a; s[2]+=a
centroids={z:[round(v[0]/v[2],3),round(v[1]/v[2],3)] for z,v in cent.items()}

data={'bbox':BBOX,'china':china,'other':other,'counties':counties,'centroids':centroids,
      'source':'Natural Earth（公共領域）；台灣縣市界：g0v twgeojson（內政部開放資料）'}
s=json.dumps(data,ensure_ascii=False,separators=(',',':'))
open(OUT,'w',encoding='utf-8').write('// 自動產生：tools/build_map.py\nwindow.MAP_DATA='+s+';\n')
print('china rings',len(china),'pts',sum(len(r)//2 for r in china))
print('counties',len(counties),'pts',sum(len(r)//2 for c in counties for r in c['rings']))
print('bytes',len(s)); print(centroids)
