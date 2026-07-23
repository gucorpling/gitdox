#!/usr/bin/python
# -*- coding: utf-8 -*-

########################################################################
#                                                                      #
#  tokenization script for tagger preprocessing                        #
#  Adapted from TreeTagger tokenizer in Perl by:                       #
#          Helmut Schmid, IMS, University of Stuttgart                 #
#          Serge Sharoff, University of Leeds                          #
#  Description:                                                        #
#  - splits input text into tokens (one token per line)                #
#  - cuts off punctuation, parentheses etc.                            #
#  - disambiguates periods                                             #
#  - preserves SGML markup                                             #
#                                                                      #
#  - Ported to Python by Amir Zeldes                                   #
########################################################################


from argparse import ArgumentParser
import io, sys, re

PY3 = sys.version_info[0] > 2

# characters which have to be cut off at the beginning of a word
PChar = r"""\[¿¡{(`"‚„†‡‹‘’“”•'–—›«「"""

# characters which have to be cut off at the end of a word
FChar = r"""'\]}'`"),;:!?%‚„…†‡‰‹‘’“”•–—›'»」"""

# character sequences which have to be cut off at the beginning of a word
PClitic = ""

# character sequences which have to be cut off at the end of a word
FClitic = '[\'’](s|re|ve|d|m|em|ll)|n[\'’]t'

eng_abbr = """&Co.
AUG.
Adm.
Ala.
Ald.
App.Cas.
Ariz.
Ark.
Assn.
Assoc.
Att.
Aug.
Av.
Ave.
Bancorp.
Bde.
Bhd.
Blvd.
Brig.
Bros.
C.-in-C.
CO.
CORP.
COS.
Ca.
Calif.
Canada-U.S.
Canadian-U.S.
Capt.
Cas.
Ch.
Ch.App.
Ch.D.
Cia.
Cie.
Cm.
Cmd.
Cmnd.
Co.
Col.
Colo.
Conn.
Corp.
Cos.
Cowp.
Cr.App.R.
Crim.L.R.
D-Mass.
D.Litt.
D.Phil.
DFl.
Dec.
Del.
Dep.
Dept.
Deut.
Diod.
Div.
Dr.
Drs.
Dtr.
Durn.
E.g.
ESQ.
Eph.
Eq.
Eqn.
Eqns.
Esq.
Etc.
Exch.
Exod.
Ext.
FIG.
Fam.
Feb.
Fig.
Figs.
Fla.
Ft.
G.m.b.H.
Ga.
Gen.
Gov.
Hdt.
Hon.
INC.
Ibid.
Ill.
Inc.
Ind.
InfoCorp.
Intercorp.
Invest.
JJ.
JR.
Jan.
Japan-U.S.
Jr.
Jud.
Kan.
Korean-U.S.
Ky.
L.JJ.
L.R.Ir.
LL.M.
LTD.
La.
Lt.
Lt.-Col.
Ltd.
Ltda.
M.Ed.
M.Litt.
M.Phil.
Maj.
Mass.
Md.
Me.T.A.
Messrs.
Mfg.
Mich.
Minn.
Miss.
Mo.
Mod.Rep.
Mont.
Mr.
Mrs.
Ms.
Neb.
Nev.
No.
Non-U.S.
Nos.
Nov.
Oct.
Oe.
Okla.
Ont.
Op.
Ore.
P.o.s.
Pa.
Ph.
Ph.D.
Pp.
Prev.
Prof.
Prop.
Pte.
Ptr.
Pty.
Reg.
Regt.
Rep.
Reps.
Repub.
Ret.
Rev.
Rom.
S.p.A.
Sec.
Sen.
Sens.
Sept.
Sgt.
Sh.Ct.
Sino-U.S.
Soc.
Som.
Soviet-U.S.
Sp.
Sr.
St.
Ste.
Suff.
Syll.
T.B.G.A.S.
Tenn.
Tex.
Thess.
Thuc.
Transp.
Trop.
U.S.-U.K.
U.S.-U.S.S.R.
U.S.P.G.A.
Univ.
V.-C.
Va.
Vict.
Vol.
Vt.
W.Va.
Wash.
Wis.
Wyo.
a-Ex-dividend.
a.c.
a.g.m.
a.k.a.
a.m.
al.
anti-U.S.
approx.
b.s.
bldg.
c.c.d.
c.e.o.
c.f.
c.g.
c.v.
c/s.
cap.
cf.
ch.
cit.
clar.
co.
col.
cols.
constr.
cp.
cwt.
d.c.
d.f.
d.i.l.
d.p.c.
def.
dw.
e-Estimated.
e.g.
e.m.f.
e.p.s.p.
edn.
edns.
est.
etc.
ex-L.C.C.
fig.
fl.
fol.
ft.
gen.
govt.
h.p.
hon.
hrs.
i.c.
i.e.
ibid.
inc.
incl.
juv.
k.p.h.
l.e.d.
lbs.
loc.
m.d.
m.p.h.
msec.
n.d.
n.m.r.
non-U.K.
non-U.S.
norw.
nos.
oz.
ozs.
p.
p.a.
p.c.
p.m.
p.o.s.
p.p.m.
p.s.i.
p.w.
pl.
pls.
pos.
pp.
pres.
president-U.S.
pro-U.S.
q.v.
qq.v.
r.f.
r.h.
r.m.s.
r.m.s.d.
r.p.m.
r.s.s.
ref.
s.
s.a.
s.a.e.
s.d.
s.e.m.
s.r.l.
s.t.p.
spp.
sq.ft.
sq.m.
subss.
v.
v.B.
v.w.
var.
viz.
vol.
vols.
vs.
w.c.
:-)
;-)
:)
;)
:-(
;-(
:(
;(
:P
:*)
:D
:p
:/
:O
:o
's
>:(
;*)
:)"""


def tokenize(text, abbr="eng", add_sents=False, from_pipes=False, aggressive_hyphenation=True):

    if aggressive_hyphenation:
        text = re.sub(r'(?<=[א-ת])([–/־-])(?=[א-ת])',r' \1 ', text)
        text = re.sub(r'(?<= [0-9])([–:־-])(?=[0-9] )',r' \1 ', text)  # sports scores etc.
        text = re.sub(r'(?<= (?:19|20)[0-9]{2})([–־-])(?=(?:19|20)[0-9]{2}[ ,\.])',r' \1 ', text)  # year ranges
        text = re.sub(r'(?<= [0-9][0-9])([–־-])(?=[0-9]+%)',r' \1 ', text)  # percentage ranges
        text = re.sub(r'( (?:(?:\d{1,3},)+\d{3}))([–־-])(?=(?:(?:\d{1,3},)+\d{3})[ ,\.])',r'\1 \2 ', text)  # ranges of numbers with thousands sep

    output = ""
    if add_sents:
        lines = []
        raw_lines = text.split("\n")
        for line in raw_lines:
            if len(line.strip())>0:
                lines.append("<s>" + line + "</s>")
    else:
        lines = text.split("\n")

    if from_pipes:  # Text is already whitespace tokenized
        data = "\n".join(lines)
        data = data.replace("<s>","\n<s>\n").replace("</s>","\n</s>\n")
        data = re.sub(r'\n+',r'\n',data)
        return "\n".join(data.split())

    # Read the list of abbreviations and words
    Token = set([])
    if abbr == "eng":
        abbrs = eng_abbr.strip().split("\n")
    else:
        abbrs = abbr.strip().split("\n")
    for line in abbrs:
        Token.add(line)

    for line in lines:
        # replace newlines and tab characters with blanks
        line = line.replace("\t"," ").replace("\n"," ")

        # replace blanks within SGML tags
        sep1 = "□"
        sep2 = "■"

        if not PY3:
            sep1 = sep1.decode("utf8")
            sep2 = sep2.decode("utf8")

        find_tag_space = r'(<[^<> ]*) ([^<>]*>)'
        while re.search(find_tag_space,line) is not None:
            line = re.sub(find_tag_space,r'\1'+sep1+r'\2',line)

        # replace whitespace with a special character
        line = line.replace(" ",sep2)

        # restore SGML tags
        line = line.replace(sep1," ")
        line = line.replace(sep2,sep1)

        # prepare SGML-Tags for tokenization

        line = re.sub(r'(<[^<>]*>)',sep1 + r"\1" + sep1,line)
        line = re.sub(r'^' + sep1,"",line)
        line = re.sub(sep1 + r'$',"",line)
        line = re.sub(sep1*3 +"*",sep1,line)

        units = line.split(sep1)
        for i, unit in enumerate(units):
            if re.match(r"<.*>$",unit) is not None:
                # SGML tag
                output += unit + "\n"
            else:
                #add a blank at the beginning and the end of each segment
                email = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
                url = r'https?://(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&/=]*)'
                acro = r"([A-Z]\.([A-Z]\.)+)"
                short_url = r"[-a-zA-Z0-9]{2,256}\.(com|org|edu|co|io|net)"

                # insert missing blanks after punctuation if not an abbreviation
                if unit not in Token and re.search(email,unit) is None and re.search(url,unit) is None \
                        and re.search(acro, unit) is None and re.search(short_url, unit) is None:
                    unit = " " + unit + " "
                    unit = re.sub(r'\.\.\.'," ... ",unit)
                    unit = re.sub(r'([;!?])([^ ])',r'\1 \2', unit)
                    unit = re.sub(r'([.,:])([^ 0-9.])', r'\1 \2',unit)
                else:
                    unit = " " + unit + " "

                subunits = unit.split()
                for subunit in subunits:
                    suffix=""

                    # separate punctuation and parentheses from words
                    while True:
                        finished = True
                        # cut off preceding punctuation
                        m = re.match(r'(['+PChar+'])(.)',subunit)
                        if m is not None:
                            m1 = m.group(1)
                            subunit = re.sub('^(['+PChar+'])(.)',r'\2',subunit)
                            output += m1 + "\n"
                            finished = 0
                        # cut off trailing punctuation
                        m = re.search(r'(.)(['+FChar+'])$',subunit)
                        if m is not None:
                            m2 = m.group(2)
                            subunit = re.sub(r'(.)(['+FChar+'])$',r'\1',subunit)
                            suffix = m2 + "\n" + suffix
                            finished = 0

                        # cut off trailing periods if punctuation precedes
                        m = re.search(r'(['+FChar+r'])\.$',subunit)
                        if m is not None:
                            subunit = re.sub(r'(['+FChar+r'])\.$','',subunit,count=1)
                            suffix = ".\n" + suffix
                            if subunit == "":
                                subunit = m.group(1)
                            else:
                                suffix = m.group(1) + "\n" + suffix
                            finished = False
                        if finished:
                            break

                    # handle explicitly listed tokens
                    if subunit in Token:
                        output += subunit + "\n" + suffix
                        continue

                    # abbreviations of the form A. or U.S.A.
                    if re.match(r'([A-Za-z-]\.)+$',subunit) is not None:
                        output += subunit + "\n" + suffix
                        continue

                    # e-mail addresses
                    if re.search(email,subunit) is not None or re.search(url,subunit) is not None:
                        output += subunit + "\n" + suffix
                        continue

                    # disambiguate periods
                    m = re.match(r'(..*)\.$',subunit)
                    if m is not None and subunit != "...":
                        subunit = m.group(1)
                        suffix = ".\n" + suffix
                        if subunit in Token:
                            output += subunit + "\n" + suffix
                            continue

                    # cut off clitics
                    while re.match(r'(--)(.)',subunit) is not None:
                        m = re.match(r'(--)(.)',subunit)
                        subunit = re.sub(r'(--)(.)',r'\2',subunit)
                        output += m.group(1) + "\n"

                    if PClitic != '':
                        while re.match(r'('+PClitic+')(.)',subunit) is not None:
                            m = re.match(r'('+PClitic+')(.)',subunit)
                            subunit = re.sub(r'('+PClitic+')(.)',r'\2',subunit)
                            output += m.group(1) + "\n"

                    while re.search(r'(.)(--)$',subunit) is not None:
                        m = re.search(r'(.)(--)$',subunit)
                        subunit = re.sub(r'(.)(--)$',r'\1',subunit)
                        suffix = m.group(2) + "\n" + suffix

                    if FClitic != "":
                        while re.search(r'(.)('+FClitic+')$',subunit) is not None:
                            m = re.search(r'(.)('+FClitic+')$',subunit)
                            subunit = re.sub(r'(.)('+FClitic+')$',r"\1",subunit)
                            suffix = m.group(2) + "\n" + suffix
                    output+=subunit + "\n" + suffix
    return output



if __name__ == "__main__":

    p = ArgumentParser()
    p.add_argument("--infile",default=None)
    p.add_argument("-a","--abbreviations",action="store",default=None,help="File name for list of abbreviations and other tokens to leave alone")

    opts = p.parse_args()

    if opts.infile is None:
        input_text = """<text id="GUM_essay_merit">

<head>
You’re Not Going to Get Accepted into a Top University on Merit Alone (Warikoo)
</head>

<p>By Natasha Warikoo</p>

<figure rend="Students on a lawn at Harvard’s Boston campus">
<caption><q><ref target="https://www.flickr.com/photos/59121133@N00/19321851540">“Boston – Harvard Campus” </ref></q> by <ref target="https://www.flickr.com/photos/59121133@N00">David@UNT</ref> is licensed under <ref target="https://creativecommons.org/licenses/by-nc-sa/2.0/?ref=ccsearch&amp;atype=rich">CC <w>BY - NC - SA</w> 2.0</ref></caption>
</figure>

<p>
After weeks of negotiation, Harvard University recently <ref target="https://www.nytimes.com/2017/12/01/us/harvard-justice-department-discrimination.html">agreed</ref> to provide the Department of Justice access to its admissions files. The department is reopening a complaint by 63 <w>Asian - American</w> groups that Harvard discriminates against <w>Asian - American</w> applicants.  The complaint was previously <ref target="https://www.wsj.com/articles/complaint-alleging-discrimination-by-harvard-dismissed-1436305777">dismissed</ref> under the Obama administration. Many <ref target="http://diverseeducation.com/article/99723/">worry</ref> that government lawyers plan to use the case to argue that all <w>race - conscious</w> admissions – including affirmative action – are a violation of the Civil Rights Act.
</p>"""
    else:
        input_text = io.open(opts.infile,encoding="utf8").read().replace("\r","").strip()
    if opts.abbreviations is not None:
        abbr = io.open(opts.abbreviations,encoding="utf8").read().strip()
    else:
        abbr = "eng"
    output = tokenize(input_text)
    print(output)
