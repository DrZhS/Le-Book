[README.md](https://github.com/user-attachments/files/31877704/README.md)
# 随身阅读器 (NovelReader)

一个面向手机的 **EPUB / TXT 离线阅读器**，开源自用，方便你随时修改调整。

- 单文件、离线可用、无需应用商店 / 无需签名 / 无需注册。
- 手机上用浏览器打开即可使用，也可"添加到主屏幕"当作 App 用。
- 支持 `.epub` 与 `.txt` 导入、翻章、目录、进度记忆、主题切换、字号调整。

## 目录结构（开源库源码）

```
novelreader/
├── build.py            # 构建脚本：把 src/ 打包成单个 dist/novel-reader.html
├── README.md
├── LICENSE
├── src/                # 可维护的源码
│   ├── index.html      # 页面结构（书架 / 阅读界面 / 设置抽屉）
│   ├── style.css       # 样式
│   ├── app.js          # 应用逻辑（导入、分章、epub 渲染、主题、进度）
│   └── lib/
│       ├── jszip.min.js   # zip 解析库（epub 依赖）
│       └── epub.min.js    # epub 渲染库（epub.js）
└── dist/
    └── novel-reader.html  # 构建产物 = 你直接拿去手机用的那个文件
```

## 如何修改并重新打包

```bash
# 1) 修改 src/ 下的 index.html / style.css / app.js
# 2) 重新构建
python3 build.py
# 3) 输出在 dist/novel-reader.html，替换手机上的旧文件即可
```

## 依赖说明

`src/lib/` 下的库来自 CDN（epub.js@0.3.93、JSZip@3.10.1），已下载到本地内联进制品，
因此**最终 HTML 不需要联网**。若你想升级 epub.js，替换 `src/lib/` 下文件后重新 build 即可。

## 许可

MIT License（见 `LICENSE`）。epub.js / JSZip 版权归其原作者所有。
