# 部署问道（与 shennao 同机共存）

问道是深脑的下游应用，跟 shennao 部署在同一台服务器（`122.51.221.171`）。它是一个标准 Next.js Node 服务，默认监听 **3200** 端口（避开 shennao 的端口）。

## 一次性准备

```bash
# 服务器上，拉代码
cd /var/www          # 或你放 app 的目录
git clone https://github.com/qiuyiwu1989-star/openclaw-wendao.git wendao
cd wendao

# 装依赖 + 构建
npm ci
npm run build

# 配置密钥（不要提交进 git）
cp .env.example .env.local
#   编辑 .env.local，填 LLM_API_KEY=tp-...（MiMo 网关 key，对话+语音共用）
#   可选：WENDAO_TTS_VOICE 换音色，WENDAO_MODEL 换 mimo-v2.5 提速
```

## 常驻运行（二选一）

**PM2（跟 shennao 一致的话优先用这个）：**
```bash
pm2 start ecosystem.config.js   # 或：pm2 start npm --name wendao -- run start
pm2 save
```

**systemd：**
```ini
# /etc/systemd/system/wendao.service
[Service]
WorkingDirectory=/var/www/wendao
ExecStart=/usr/bin/npm run start
EnvironmentFile=/var/www/wendao/.env.local
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
```

## 对外暴露（两种方案）

### 方案 A：独立子域名（推荐，最省心）
用一个**已备案**子域名（沿用 `zaowuyun.com` 那套，绕开未备案被 ICP 墙拦的坑），
比如 `wendao.zaowuyun.com`，A 记录指向 `122.51.221.171`，nginx 反代：

```nginx
server {
    server_name wendao.zaowuyun.com;
    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;            # 流式输出必须关缓冲
        proxy_read_timeout 300s;
    }
}
```

### 方案 B：挂在深脑域名的子路径 `/wendao`
构建时设 `BASE_PATH=/wendao`（`npm run build` 前 `export BASE_PATH=/wendao`），nginx：

```nginx
location /wendao/ {
    proxy_pass http://127.0.0.1:3200/wendao/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

> **关键**：`proxy_buffering off;` —— 不关掉的话流式回复会被 nginx 攒着一次性吐出，失去逐字打字的体验。健康检查判「服务器有没有响应」（000/5xx 才算挂），不死等具体 code。

**签 HTTPS 证书（必做）：**
```bash
sudo certbot --nginx -d wendao.zaowuyun.com
```
> 语音输入（麦克风）依赖浏览器的**安全上下文**——只有 HTTPS 下才能用，HTTP 会被浏览器禁掉。所以证书不是可选项。

## 更新上线

```bash
cd /var/www/wendao
git pull
npm ci
npm run build
pm2 restart wendao      # 或 systemctl restart wendao
```

## 上线自检

- [ ] `curl -s https://<域名>/api/health` → `{"ok":true,...,"llmConfigured":true}`
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://<域名>/` → 200
- [ ] 首页能打开、能发一条消息、能看到逐字流式回复
- [ ] 回答播放出语音（TTS），点喇叭能静音、点「朗读」能重听
- [ ] 麦克风语音输入可用（需 HTTPS + Chrome/Edge，说完自动发送）
- [ ] `/about` 关于·方法页能打开
- [ ] `.env.local` 权限收紧（`chmod 600`），且不在 git 里
- [ ] 发布窗口：用户在用时冻结重启

## 坑：服务器 .env.local 会覆盖代码默认值

改了代码里的默认模型（如 `WENDAO_MODEL` 从 pro 改 v2.5）后，**必须同时检查服务器
`~/wendao/.env.local`**——那里若显式写了旧值，会盖掉代码默认，改动等于没生效。

```bash
ssh ubuntu@122.51.221.171 'grep -E "^WENDAO_MODEL" ~/wendao/.env.local'
```

## 坑：延迟要在服务器侧量，别从本地量

本地 curl 打公网含跨境往返（常见 +3s），量不出真实体感。正确做法：
`ssh ... 'curl localhost:3210/api/chat ...'`。国内真实首字基线 **0.6–1.0s**，
偶发 3s+ 是 MiMo 网关波动，非应用问题。
