# Genera rsrc_windows_amd64.syso (objeto COFF con sección .rsrc) con el icono y el manifiesto, para que
# el enlazador de Go los meta en el .exe. Formato: cabecera COFF, sección .rsrc, reubicaciones ADDR32NB,
# un símbolo de sección y tabla de cadenas vacía.
import struct,sys
ico=open(sys.argv[1],'rb').read();manifest=open(sys.argv[2],'rb').read();out=sys.argv[3]
_,typ,cnt=struct.unpack_from('<HHH',ico,0);assert typ==1
imgs=[];grp=struct.pack('<HHH',0,1,cnt)
for i in range(cnt):
    w,h,colors,res,planes,bpp,size,off=struct.unpack_from('<BBBBHHII',ico,6+16*i)
    imgs.append(ico[off:off+size]);grp+=struct.pack('<BBBBHHIH',w,h,colors,res,planes,bpp,size,i+1)
LANG=0x0409
# árbol: tipo -> id -> idioma -> datos
tree=[(3,[(i+1,imgs[i]) for i in range(cnt)]),(14,[(1,grp)]),(24,[(1,manifest)])]
def dirhdr(n):return struct.pack('<IIHHHH',0,0,0,0,0,n)
# calcular tamaños: nivel 1, nivel 2 (por tipo), nivel 3 (por id), entradas de datos
l1=16+8*len(tree);l2=sum(16+8*len(ids) for t,ids in tree);nleaf=sum(len(ids) for t,ids in tree);l3=nleaf*(16+8);de=nleaf*16
off_l2=l1;off_l3=off_l2+l2;off_de=off_l3+l3;off_data=off_de+de
buf=bytearray();relocs=[]
data_blobs=[];cur_data=off_data
def align(x,a=8):return (x+a-1)//a*a
cur_data=align(cur_data)
# nivel 1
b1=dirhdr(len(tree));p2=off_l2;leaves=[]
for t,ids in tree:
    b1+=struct.pack('<II',t,0x80000000|p2);p2+=16+8*len(ids)
# nivel 2 y 3
b2=b'';b3=b'';bde=b'';p3=off_l3;pde=off_de
for t,ids in tree:
    b2+=dirhdr(len(ids))
    for rid,blob in ids:
        b2+=struct.pack('<II',rid,0x80000000|p3);p3+=24
        b3+=dirhdr(1)+struct.pack('<II',LANG,pde)
        relocs.append(pde);bde+=struct.pack('<IIII',cur_data,len(blob),0,0);pde+=16
        data_blobs.append((cur_data,blob));cur_data=align(cur_data+len(blob))
sec=bytearray(b1+b2+b3+bde)
assert len(sec)==off_data,(len(sec),off_data)
sec+=b'\0'*(align(off_data)-off_data)
for at,blob in data_blobs:
    sec+=b'\0'*(at-len(sec));sec+=blob
sec+=b'\0'*(align(len(sec))-len(sec))
nrel=len(relocs);ptr_raw=20+40;ptr_rel=ptr_raw+len(sec);ptr_sym=ptr_rel+10*nrel
coff=struct.pack('<HHIIIHH',0x8664,1,0,ptr_sym,1,0,0)
sh=struct.pack('<8sIIIIIIHHI',b'.rsrc\0\0\0',0,0,len(sec),ptr_raw,ptr_rel,0,nrel,0,0x40000040)
rel=b''.join(struct.pack('<IIH',r,0,3) for r in relocs)
sym=struct.pack('<8sIhHBB',b'.rsrc\0\0\0',0,1,0,3,0)
open(out,'wb').write(coff+sh+bytes(sec)+rel+sym+struct.pack('<I',4))
print('ok',cnt,'iconos,',len(manifest),'bytes de manifiesto,',nrel,'reubicaciones')
