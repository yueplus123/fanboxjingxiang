# Fanbox 作者投稿作品统计

无需登录 Fanbox 账号，查询任意公开创作者的赞助档位与作品统计。

## 功能

- 输入创作者 ID、`@id` 或 Fanbox 主页/帖子链接
- 展示赞助方案列表、各档位专属作品数、累计可见作品数
- 服务端内存缓存（默认 10 分钟）
- 分享链接：`?creator=zzab` 自动查询

## 环境要求

- Python 3.10+
- 无第三方 pip 依赖

## 本地启动

```bash
cd fanbox-analyze   # 或本项目根目录
python server.py
```

浏览器打开 [http://127.0.0.1:8766/](http://127.0.0.1:8766/)

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `127.0.0.1` | 监听地址；生产改为 `0.0.0.0` |
| `PORT` | `8766` | 监听端口 |
| `CACHE_TTL_SEC` | `600` | 缓存秒数 |

示例：

```bash
HOST=0.0.0.0 PORT=8766 python server.py
```

## CLI 调试

```bash
python count_plans.py zzab
python count_plans.py "https://www.fanbox.cc/@zzab" --json
```

## API

```
GET /api/analyze?creator={id或链接}
```

成功返回 JSON，含 `creator_id`、`total`、`plans`、`tiers` 等字段。错误返回 `{ "error": "..." }`。

## 生产部署

### systemd

```ini
[Unit]
Description=Fanbox Author Statistics
After=network.target

[Service]
WorkingDirectory=/opt/fanbox-analyze
Environment=HOST=0.0.0.0
Environment=PORT=8766
ExecStart=/usr/bin/python3 server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable fanbox-analyze
sudo systemctl start fanbox-analyze
```

### Nginx 反向代理（HTTPS）

```nginx
server {
    listen 443 ssl http2;
    server_name analyze.example.com;

    ssl_certificate     /etc/letsencrypt/live/analyze.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analyze.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8766;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/analyze {
        limit_req zone=api burst=5 nodelay;
        proxy_pass http://127.0.0.1:8766;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 30s;
    }
}
```

在 `http` 块中配置速率限制：

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
```

## 目录结构

```
├── server.py           # HTTP 服务
├── count_plans.py      # 统计业务逻辑
├── fanbox_client.py    # Fanbox API 客户端
├── static/index.html   # 前端单页
├── requirements.txt
└── docs/               # 开发文档
```

## 免责声明

本工具非 Fanbox 官方产品，数据来自公开 API，可能有延迟。不收集、不存储用户登录信息。
