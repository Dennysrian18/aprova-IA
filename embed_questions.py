# -*- coding: utf-8 -*-
import csv, json, os, re

BASE = '/Users/dennysrian_/Desktop/aprova-ia'

# Normalize discipline names (CSV uses no accents)
DISC_MAP = {
    'matematica':       'Matemática',
    'lingua portuguesa':'Língua Portuguesa',
    'lingua_portuguesa':'Língua Portuguesa',
    'portugues':        'Português',
    'fisica':           'Física',
    'quimica':          'Química',
    'biologia':         'Biologia',
    'historia':         'História',
    'geografia':        'Geografia',
    'filosofia':        'Filosofia',
    'sociologia':       'Sociologia',
    'ingles':           'Inglês',
    'espanhol':         'Espanhol',
    'literatura':       'Literatura',
    'redacao':          'Redação',
}

DIF_MAP = {
    'facil':   'Fácil',
    'fácil':   'Fácil',
    'medio':   'Médio',
    'médio':   'Médio',
    'dificil': 'Difícil',
    'difícil': 'Difícil',
}
XP_MAP = {'Fácil': 10, 'Médio': 15, 'Difícil': 20}

def norm_disc(d):
    return DISC_MAP.get(d.lower().strip(), d.strip())

def norm_dif(d):
    return DIF_MAP.get(d.lower().strip(), 'Médio')

def js_str(s):
    """Escape a string for embedding in a JS single-quoted string."""
    s = s.replace('\\', '\\\\')
    s = s.replace("'", "\\'")
    s = s.replace('\n', ' ').replace('\r', '')
    return s

all_questions = []

# Read all CSVs in order
csv_files = sorted(
    [f for f in os.listdir(BASE) if f.startswith('questoes_lote') and f.endswith('.csv')],
    key=lambda x: int(re.search(r'\d+', x).group())
)

print(f"Encontrados {len(csv_files)} arquivos CSV")

for fname in csv_files:
    path = os.path.join(BASE, fname)
    with open(path, encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            # Strip BOM and quotes from keys
            row = {k.lstrip('﻿').strip().strip('"'): v.strip().strip('"') for k, v in row.items()}

            tipo = row.get('tipo', 'multipla').lower()
            is_dis = 'dis' in tipo

            disc = norm_disc(row.get('disciplina', 'Geral'))
            tema = row.get('tema', '')
            subtema = row.get('subtema', '')
            dif = norm_dif(row.get('dificuldade', 'Medio'))
            xp = XP_MAP.get(dif, 15)
            fonte = row.get('fonte', 'Vestibular')
            ano = row.get('ano', '')
            enunciado = row.get('enunciado', '')
            explicacao = row.get('explicacao', '')
            resposta = row.get('resposta', '')

            q_id = row.get('id', '')

            if not enunciado or len(enunciado) < 5:
                continue

            q = {
                'id': q_id,
                'tipo': 'dissertativa' if is_dis else 'multipla',
                'disc': disc,
                'tema': tema,
                'subtema': subtema,
                'dif': dif,
                'fonte': fonte,
                'ano': ano,
                'xp': xp,
                'enunciado': enunciado,
            }

            if is_dis:
                q['resposta'] = resposta
                q['exp'] = explicacao
            else:
                q['a'] = row.get('alternativa_a', '')
                q['b'] = row.get('alternativa_b', '')
                q['c'] = row.get('alternativa_c', '')
                q['d'] = row.get('alternativa_d', '')
                q['e'] = row.get('alternativa_e', '')
                ok = row.get('resposta_correta', 'a').lower().strip()
                q['ok'] = ok if len(ok) == 1 else 'a'
                q['exp'] = explicacao

            all_questions.append(q)

print(f"Total de questões lidas: {len(all_questions)}")

# Build JS array string
lines = ['const QS_DEFAULT=[']
for i, q in enumerate(all_questions):
    comma = '' if i == len(all_questions) - 1 else ','

    if q['tipo'] == 'multipla':
        s = (
            f"  {{id:{json.dumps(q['id'])},tipo:'multipla',"
            f"disc:{json.dumps(q['disc'])},"
            f"tema:{json.dumps(q['tema'])},"
            f"subtema:{json.dumps(q['subtema'])},"
            f"dif:{json.dumps(q['dif'])},"
            f"fonte:{json.dumps(q['fonte'])},"
            f"ano:{json.dumps(q['ano'])},"
            f"xp:{q['xp']},"
            f"enunciado:{json.dumps(q['enunciado'])},"
            f"a:{json.dumps(q['a'])},"
            f"b:{json.dumps(q['b'])},"
            f"c:{json.dumps(q['c'])},"
            f"d:{json.dumps(q['d'])},"
            f"e:{json.dumps(q['e'])},"
            f"ok:{json.dumps(q['ok'])},"
            f"exp:{json.dumps(q['exp'])}}}{comma}"
        )
    else:
        s = (
            f"  {{id:{json.dumps(q['id'])},tipo:'dissertativa',"
            f"disc:{json.dumps(q['disc'])},"
            f"tema:{json.dumps(q['tema'])},"
            f"subtema:{json.dumps(q['subtema'])},"
            f"dif:{json.dumps(q['dif'])},"
            f"fonte:{json.dumps(q['fonte'])},"
            f"ano:{json.dumps(q['ano'])},"
            f"xp:{q['xp']},"
            f"enunciado:{json.dumps(q['enunciado'])},"
            f"resposta:{json.dumps(q.get('resposta',''))},"
            f"exp:{json.dumps(q.get('exp',''))}}}{comma}"
        )
    lines.append(s)

lines.append('];')
qs_block = '\n'.join(lines)

# Read index.html
html_path = os.path.join(BASE, 'index.html')
with open(html_path, encoding='utf-8') as f:
    html = f.read()

# Find the QS_DEFAULT block. IMPORTANT: do NOT bracket-walk — question text
# can contain stray '[' or ']' which throws off the count and can eat the rest
# of the file (this once truncated the whole app). Instead, anchor on the known
# terminator: the block ends at the last '];' that appears right before the
# next top-level declaration (const ACHIEVEMENTS).
MARKER = 'const QS_DEFAULT=['
start = html.find(MARKER)
if start == -1:
    print("ERRO: marcador nao encontrado!")
    exit(1)

NEXT_DECL = 'const ACHIEVEMENTS'
next_pos = html.find(NEXT_DECL, start)
if next_pos == -1:
    print("ERRO: marcador de fim (const ACHIEVEMENTS) nao encontrado!")
    exit(1)

# The QS_DEFAULT block ends at the last '];' before NEXT_DECL.
close = html.rfind('];', start, next_pos)
if close == -1:
    print("ERRO: fechamento '];' do QS_DEFAULT nao encontrado!")
    exit(1)
end = close + len('];')

before = html[:start]
after  = html[end:]
new_html = before + qs_block + after

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(new_html)
print(f"index.html atualizado com {len(all_questions)} questoes!")

# Verify
with open(html_path, encoding='utf-8') as f:
    content = f.read()
block_start = content.find(MARKER)
block_end   = content.find('const ACHIEVEMENTS', block_start)
block = content[block_start:block_end]
multi = block.count("tipo:'multipla'")
diss  = block.count("tipo:'dissertativa'")
print(f"Verificacao: {multi} multipla + {diss} dissertativa = {multi+diss} total")
