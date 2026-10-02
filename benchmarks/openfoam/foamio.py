"""Small helpers to write OpenFOAM v1912 case files (ASCII)."""
import os
HDR = """FoamFile
{{
    version     2.0;
    format      ascii;
    class       {cls};
    location    "{loc}";
    object      {obj};
}}
"""
def write(case, rel, cls, body):
    path = os.path.join(case, rel); os.makedirs(os.path.dirname(path), exist_ok=True)
    loc, obj = os.path.dirname(rel), os.path.basename(rel)
    with open(path, 'w') as f: f.write(HDR.format(cls=cls, loc=loc, obj=obj) + body + '\n')
def vec(v): return '(%.12g %.12g %.12g)' % tuple(v)
def slist(vals): return 'nonuniform List<scalar> %d\n(\n%s\n)' % (len(vals), '\n'.join('%.12g' % v for v in vals))
def vlist(vals): return 'nonuniform List<vector> %d\n(\n%s\n)' % (len(vals), '\n'.join(vec(v) for v in vals))
def run(case, cmd, log):
    import subprocess
    r = subprocess.run(['bash', '-c', f'source /usr/share/openfoam/etc/bashrc >/dev/null 2>&1; cd "{case}" && {cmd} > {log} 2>&1'])
    return r.returncode
