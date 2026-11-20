"""Build Prepify.exe for sharing (Windows): python build_exe.py

Makes dist/Prepify/ with
  Prepify.exe        the app (double-click: starts Prepify and opens http://localhost:5000)
  extension/         the Prepify Capture Chrome extension, for pulling sources
  HOW-TO-USE.txt     instructions for the person you share it with
and zips it to dist/Prepify-windows.zip.

Your .env is NOT included: your Groq key stays with you. People who want AI assist add their own key.
Needs: pip install pyinstaller
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, 'dist')
OUT = os.path.join(DIST, 'Prepify')
SEP = ';' if os.name == 'nt' else ':'


def main():
    try:
        import PyInstaller.__main__
    except ImportError:
        sys.exit('PyInstaller is not installed. Run: pip install pyinstaller')
    PyInstaller.__main__.run([
        os.path.join(ROOT, 'app.py'),
        '--name', 'Prepify', '--onefile', '--console', '--noconfirm', '--clean',
        '--distpath', DIST, '--workpath', os.path.join(ROOT, 'build'), '--specpath', os.path.join(ROOT, 'build'),
        '--add-data', f'{os.path.join(ROOT, "templates")}{SEP}templates',
        '--add-data', f'{os.path.join(ROOT, "static")}{SEP}static',
        '--hidden-import', 'waitress',
        # big packages that may be installed alongside but Prepify never uses
        *[x for m in ('PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'tkinter', 'matplotlib', 'numpy', 'pandas', 'scipy',
                      'torch', 'tensorflow', 'cv2', 'IPython', 'notebook', 'pytest', 'anthropic')
          for x in ('--exclude-module', m)],
    ])
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    exe = 'Prepify.exe' if os.name == 'nt' else 'Prepify'
    shutil.move(os.path.join(DIST, exe), os.path.join(OUT, exe))
    shutil.copytree(os.path.join(ROOT, 'extension'), os.path.join(OUT, 'extension'))
    shutil.copy(os.path.join(ROOT, 'packaging', 'HOW-TO-USE.txt'), OUT)
    archive = shutil.make_archive(os.path.join(DIST, 'Prepify-windows'), 'zip', DIST, 'Prepify')
    print(f'\nDone: {archive}\nShare that zip. Your .env (and your Groq key) is not in it.')


if __name__ == '__main__':
    main()
