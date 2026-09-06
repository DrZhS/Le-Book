#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py - 将 src/ 下的源码 + 依赖库组装成单个自包含 HTML 制品。
输出：novel-reader.html（一切内联，可直接下载到手机上打开）
用法：python3 build.py
"""
import os, re

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'src')
OUT  = os.path.join(BASE, 'dist')

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

def main():
    html = read(os.path.join(SRC, 'index.html'))
    css  = read(os.path.join(SRC, 'style.css'))
    js   = read(os.path.join(SRC, 'app.js'))
    jszip = read(os.path.join(SRC, 'lib', 'jszip.min.js'))
    epub  = read(os.path.join(SRC, 'lib', 'epub.min.js'))

    # 1) 内联样式
    html = html.replace('<link rel="stylesheet" href="style.css">',
                        '<style>\n' + css + '\n</style>')
    # 2) 内联依赖库
    html = html.replace('<script src="lib/jszip.min.js"></script>',
                        '<script>\n' + jszip + '\n</script>')
    html = html.replace('<script src="lib/epub.min.js"></script>',
                        '<script>\n' + epub + '\n</script>')
    # 3) 内联应用逻辑
    html = html.replace('<script src="app.js"></script>',
                        '<script>\n' + js + '\n</script>')

    # 清理残留引用（防御）
    html = html.replace('href="style.css"', '').replace('src="app.js"', '')
    html = html.replace('src="lib/jszip.min.js"', '').replace('src="lib/epub.min.js"', '')

    os.makedirs(OUT, exist_ok=True)
    out_path = os.path.join(OUT, 'novel-reader.html')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    size = os.path.getsize(out_path)
    print('WROTE', out_path, f'({size/1024:.1f} KB)')
    return out_path

if __name__ == '__main__':
    main()
