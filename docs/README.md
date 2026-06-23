# 堰塞湖專家評估外網發布版

這個資料夾是乾淨的靜態網站發布目錄，只包含：

- `index.html`
- `styles.css`
- `app.js`

可用於 GitHub Pages、Render Static Site、Netlify 或其他靜態網站服務。

## 穩定外網建議

臨時 tunnel 會斷線或被回收，不適合正式分享。正式分享請使用以下任一方式：

1. GitHub Pages：將此專案推到 GitHub，Pages 來源選 `docs/`。
2. Render：使用根目錄 `render.yaml`，Static Publish Path 為 `docs`。
3. Netlify：使用根目錄 `netlify.toml`，Publish directory 為 `docs`。
