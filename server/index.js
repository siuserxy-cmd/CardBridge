const express = require('express');
const cors = require('cors');
const compression = require('compression');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

function captureRawBody(req, res, buf) {
    if (buf && buf.length) {
        req.rawBody = buf.toString('utf8');
    }
}

// ============================================
// 中间件配置
// ============================================

// CORS 跨域配置
const allowedOrigins = [process.env.APP_URL]
    .filter(Boolean)
    .map(url => {
        try {
            return new URL(url).origin;
        } catch (error) {
            return null;
        }
    })
    .filter(Boolean);

app.disable('x-powered-by');
app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (process.env.NODE_ENV !== 'production') return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('CORS origin not allowed'));
    },
    maxAge: 86400 // 预检请求缓存 24 小时
}));

// Gzip/Brotli 压缩（Cloudflare 也会压缩，双重保险）
app.use(compression());

// 安全头
app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
});

// 解析 JSON 请求体
app.use(bodyParser.json({ verify: captureRawBody, limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, verify: captureRawBody, limit: '1mb' }));

// 静态文件服务（前端页面）—— 设置缓存头让 Cloudflare 缓存
app.use(express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '7d',           // 静态资源缓存 7 天
    etag: true,             // 启用 ETag
    lastModified: true,     // 启用 Last-Modified
    setHeaders(res, filePath) {
        // 图片和字体缓存更久
        if (/\.(jpg|jpeg|png|gif|svg|ico|woff2?|ttf|eot)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 天
        }
        // CSS/JS 缓存 7 天
        else if (/\.(css|js)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 天
        }
        // HTML 不缓存太久（内容可能变）
        else if (/\.html$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=300'); // 5 分钟
        }
    }
}));

// 请求日志（生产环境只记录非静态资源请求，减少噪音）
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && /\.(js|css|jpg|png|svg|ico|woff2?)$/i.test(req.path)) {
        return next();
    }
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ============================================
// API 路由
// ============================================

// 引入路由模块
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const { dbAll } = require('./utils/database');
const { orderLimit, authLimit, apiLimit } = require('./middleware/rate-limit');

// 挂载路由（含限流）
app.use('/api/auth', authLimit, authRoutes);
app.use('/api/products', apiLimit, productRoutes);
// 订单路由：只对下单接口限流，轮询和回调不限
app.post('/api/orders/guest-create', orderLimit);
app.post('/api/orders/create', orderLimit);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', apiLimit, adminRoutes);

// 公开配置（前端统计等）—— 配置很少变，缓存 10 分钟
app.get('/api/config/public', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json({
        analytics51laId: process.env.ANALYTICS_51LA_ID || '',
        shopName: process.env.SHOP_NAME || '数字商店',
        tutorialVideoUrl: process.env.TUTORIAL_VIDEO_URL || '',
        stripeEnabled: Boolean(process.env.STRIPE_PUBLISHABLE_KEY)
    });
});

// ============================================
// 首页路由
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// 动态 sitemap.xml（SEO）
app.get('/sitemap.xml', async (req, res) => {
    try {
        const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        const products = await dbAll("SELECT id, updated_at FROM products WHERE status = 'in_stock' ORDER BY id");
        const now = new Date().toISOString().slice(0, 10);

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
        xml += `  <url><loc>${appUrl}/</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
        xml += `  <url><loc>${appUrl}/articles</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
        xml += `  <url><loc>${appUrl}/lookup</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>\n`;
        for (const p of products) {
            const lastmod = p.updated_at ? p.updated_at.slice(0, 10) : now;
            xml += `  <url><loc>${appUrl}/product/${p.id}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
        }
        for (const a of listArticles()) {
            const lastmod = (a.updated_at || a.published_at || now).slice(0, 10);
            xml += `  <url><loc>${appUrl}/articles/${a.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>\n`;
        }
        xml += `</urlset>`;

        res.header('Content-Type', 'application/xml');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // sitemap 缓存 1 小时
        res.send(xml);
    } catch (e) {
        res.status(500).send('');
    }
});

// 商品详情页 —— SSR 注入 JSON-LD / OG / title / canonical，让 AI 爬虫无需执行 JS 就能读到结构化数据
const fs = require('fs');
const { loadArticles, list: listArticles, get: getArticle, escapeHtml: escArticleHtml } = require('./utils/articles');
loadArticles();
const PRODUCT_HTML_TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'public', 'product.html'), 'utf8');
const htmlEscape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

app.get('/product/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(404).send('Not Found');

        const product = await dbAll(
            "SELECT id, name, description, price, status FROM products WHERE id = ? LIMIT 1",
            [id]
        ).then(rows => rows[0]);

        // 找不到时也返回模板（前端 JS 会自己渲染 404），但不注入 SEO 元数据
        if (!product) {
            res.setHeader('Cache-Control', 'public, max-age=60');
            return res.send(PRODUCT_HTML_TEMPLATE);
        }

        const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        const canonical = `${appUrl}/product/${product.id}`;
        const title = `${product.name} - 数字商店`;
        const desc = (product.description || `${product.name} - 数字商店优质商品，安全快捷，自动发卡。`)
            .replace(/\s+/g, ' ').trim().slice(0, 160);
        const availability = product.status === 'in_stock'
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock';

        const jsonLd = {
            "@context": "https://schema.org",
            "@type": "Product",
            "@id": canonical,
            "name": product.name,
            "description": desc,
            "url": canonical,
            "brand": { "@type": "Brand", "name": "数字商店" },
            "offers": {
                "@type": "Offer",
                "url": canonical,
                "price": Number(product.price).toFixed(2),
                "priceCurrency": "CNY",
                "availability": availability,
                "seller": { "@type": "Organization", "name": "数字商店" }
            }
        };

        const seoHead = `
    <meta property="og:type" content="product">
    <meta property="og:title" content="${htmlEscape(title)}">
    <meta property="og:description" content="${htmlEscape(desc)}">
    <meta property="og:url" content="${htmlEscape(canonical)}">
    <meta property="product:price:amount" content="${Number(product.price).toFixed(2)}">
    <meta property="product:price:currency" content="CNY">
    <meta property="product:availability" content="${product.status === 'in_stock' ? 'in stock' : 'out of stock'}">
    <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;

        let html = PRODUCT_HTML_TEMPLATE
            .replace('<title>商品详情 - 数字商店</title>', `<title>${htmlEscape(title)}</title>`)
            .replace(
                '<link rel="canonical" id="canonicalLink" href="">',
                `<link rel="canonical" id="canonicalLink" href="${htmlEscape(canonical)}">`
            )
            .replace(
                '<meta name="description" id="metaDesc" content="数字商店优质商品，安全快捷，自动发卡。">',
                `<meta name="description" id="metaDesc" content="${htmlEscape(desc)}">`
            )
            .replace('<!--SEO_HEAD-->', seoHead);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300'); // 5 分钟
        res.send(html);
    } catch (e) {
        console.error('[SSR /product/:id]', e);
        res.status(500).send(PRODUCT_HTML_TEMPLATE);
    }
});

// 支付页面
app.get('/payment/:orderNo', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'payment.html'));
});

// 订单成功页（展示卡密）
app.get('/order/:orderNo', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'order.html'));
});

// 订单查询页
app.get('/lookup', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'lookup.html'));
});

// ============================================
// 文章子站 /articles 和 /articles/:slug
// ============================================

const articleSharedCSS = `
<style>
  :root { --bg:#0b0d10; --panel:rgba(17,21,27,0.94); --line:rgba(180,192,205,0.14); --line-strong:rgba(216,228,240,0.22); --text:#eef4fb; --text-soft:#b6c2cf; --text-dim:#728092; --accent:#c7ff6b; --radius:26px; }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{background:radial-gradient(circle at top left,rgba(199,255,107,0.08),transparent 26%),radial-gradient(circle at 85% 15%,rgba(125,211,252,0.08),transparent 24%),linear-gradient(180deg,#090b0e 0%,#0d1014 45%,#090b0e 100%);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.75;min-height:100vh}
  a{color:var(--accent);text-decoration:none;border-bottom:1px solid transparent;transition:0.2s}
  a:hover{border-bottom-color:var(--accent)}
  .site-header{position:sticky;top:0;z-index:50;backdrop-filter:blur(18px);background:rgba(9,11,14,0.72);border-bottom:1px solid rgba(255,255,255,0.06)}
  .site-header-inner{max-width:880px;margin:0 auto;padding:1.1rem 1.5rem;display:flex;align-items:center;justify-content:space-between}
  .brand{font-weight:800;font-size:1rem;letter-spacing:-0.02em;color:var(--text)}
  .nav-links a{color:var(--text-soft);margin-left:1.2rem;font-size:0.88rem;border:none}
  .nav-links a:hover{color:var(--accent)}
  .shell{max-width:840px;margin:0 auto;padding:3rem 1.5rem 4rem}
  h1.article-title{font-size:clamp(2rem,4.5vw,2.9rem);line-height:1.15;letter-spacing:-0.035em;margin-bottom:0.8rem;font-weight:800}
  .article-meta{color:var(--text-dim);font-size:0.84rem;margin-bottom:2.4rem;padding-bottom:1.5rem;border-bottom:1px solid var(--line)}
  .article-body{font-size:1.02rem;color:var(--text-soft)}
  .article-body h1{font-size:1.85rem;margin:3rem 0 1.1rem;color:var(--text);font-weight:800;letter-spacing:-0.03em}
  .article-body h2{font-size:1.5rem;margin:2.6rem 0 1rem;color:var(--text);font-weight:800;letter-spacing:-0.02em}
  .article-body h3{font-size:1.18rem;margin:2rem 0 0.8rem;color:var(--text);font-weight:700}
  .article-body p{margin:1.1rem 0}
  .article-body ul,.article-body ol{margin:1.1rem 0 1.1rem 1.6rem}
  .article-body li{margin:0.45rem 0}
  .article-body strong,.article-body b{color:var(--text);font-weight:700}
  .article-body code{font-family:"SFMono-Regular","JetBrains Mono","Menlo",monospace;background:rgba(199,255,107,0.08);color:var(--accent);padding:0.1rem 0.4rem;border-radius:4px;font-size:0.9em}
  .article-body pre{background:#0a0c10;border:1px solid var(--line);border-radius:14px;padding:1rem 1.2rem;overflow-x:auto;margin:1.5rem 0;font-size:0.86rem}
  .article-body pre code{background:none;color:var(--text-soft);padding:0}
  .article-body table{width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:0.88rem;border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .article-body th,.article-body td{padding:0.7rem 0.9rem;border-bottom:1px solid var(--line);text-align:left}
  .article-body th{background:rgba(255,255,255,0.04);color:var(--text);font-weight:700;font-size:0.82rem;letter-spacing:0.02em}
  .article-body tr:last-child td{border-bottom:none}
  .article-body blockquote{border-left:3px solid var(--accent);padding:0.4rem 1rem;margin:1.5rem 0;color:var(--text-dim);background:rgba(199,255,107,0.04);border-radius:0 8px 8px 0}
  .article-body hr{border:none;border-top:1px solid var(--line);margin:2.5rem 0}
  .article-list{display:grid;gap:1rem}
  .article-card{padding:1.5rem 1.6rem;border-radius:18px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(22,26,33,0.9),rgba(13,17,22,0.96));transition:0.24s ease;display:block;color:inherit;border-bottom:1px solid var(--line)}
  .article-card:hover{transform:translateY(-2px);border-color:rgba(199,255,107,0.3)}
  .article-card-title{font-size:1.18rem;font-weight:800;color:var(--text);margin-bottom:0.5rem}
  .article-card-desc{color:var(--text-soft);font-size:0.88rem;line-height:1.65}
  .article-card-meta{color:var(--text-dim);font-size:0.76rem;margin-top:0.8rem}
  .back-home{display:inline-flex;align-items:center;gap:0.4rem;color:var(--text-dim);font-size:0.84rem;margin-bottom:2rem;border:none}
  .back-home:hover{color:var(--accent)}
</style>
`;

function articleHeader() {
    return `
    <header class="site-header">
      <div class="site-header-inner">
        <a class="brand" href="/" style="border:none;">数字商店</a>
        <nav class="nav-links">
          <a href="/">首页</a>
          <a href="/articles">教程</a>
          <a href="/#faq">FAQ</a>
          <a href="/lookup">订单查询</a>
        </nav>
      </div>
    </header>
    `;
}

// 列表页
app.get('/articles', (req, res) => {
    const articles = listArticles();
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const itemList = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "数字商店 - 教程与帮助",
        "itemListElement": articles.map((a, i) => ({
            "@type": "ListItem",
            "position": i + 1,
            "url": `${appUrl}/articles/${a.slug}`,
            "name": a.title
        }))
    };
    const cards = articles.map(a => `
        <a class="article-card" href="/articles/${escArticleHtml(a.slug)}">
            <div class="article-card-title">${escArticleHtml(a.title)}</div>
            <div class="article-card-desc">${escArticleHtml(a.description)}</div>
            <div class="article-card-meta">${escArticleHtml(a.published_at)} · ${escArticleHtml(a.author)}</div>
        </a>
    `).join('');
    const html = `<!doctype html><html lang="zh-CN"><head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>教程与帮助 - 数字商店</title>
      <meta name="description" content="ChatGPT Plus 代充、Token 获取、Plus vs Pro 对比等实用教程。读完就能上手，遇到问题先翻这里。">
      <link rel="canonical" href="${appUrl}/articles">
      ${articleSharedCSS}
      <script type="application/ld+json">${JSON.stringify(itemList).replace(/</g, '\\u003c')}</script>
    </head><body>
      ${articleHeader()}
      <main class="shell">
        <div style="margin-bottom:2.5rem;">
          <div style="color:var(--accent);font-size:0.74rem;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.5rem;">教程与帮助</div>
          <h1 class="article-title">上手指南与常见问题</h1>
          <p style="color:var(--text-soft);font-size:1rem;max-width:36rem;">实用教程，从 ChatGPT Plus 代充到 Token 获取，手把手带你走完每一步。</p>
        </div>
        <div class="article-list">${cards || '<p style="color:var(--text-dim);">暂无文章。</p>'}</div>
      </main>
    </body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.send(html);
});

// 详情页
app.get('/articles/:slug', (req, res) => {
    const a = getArticle(req.params.slug);
    if (!a) return res.status(404).send('Not Found');
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const canonical = `${appUrl}/articles/${a.slug}`;
    const schema = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": a.title,
        "description": a.description,
        "datePublished": a.published_at,
        "dateModified": a.updated_at,
        "author": { "@type": "Organization", "name": a.author },
        "publisher": {
            "@type": "Organization",
            "name": "数字商店",
            "logo": { "@type": "ImageObject", "url": `${appUrl}/icon.svg` }
        },
        "mainEntityOfPage": canonical
    };
    const html = `<!doctype html><html lang="zh-CN"><head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${escArticleHtml(a.title)} - 数字商店</title>
      <meta name="description" content="${escArticleHtml(a.description)}">
      <meta property="og:type" content="article">
      <meta property="og:title" content="${escArticleHtml(a.title)}">
      <meta property="og:description" content="${escArticleHtml(a.description)}">
      <meta property="og:url" content="${escArticleHtml(canonical)}">
      <link rel="canonical" href="${escArticleHtml(canonical)}">
      ${articleSharedCSS}
      <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
    </head><body>
      ${articleHeader()}
      <main class="shell">
        <a class="back-home" href="/articles">← 返回教程列表</a>
        <h1 class="article-title">${escArticleHtml(a.title)}</h1>
        <div class="article-meta">
          ${escArticleHtml(a.published_at)}${a.updated_at && a.updated_at !== a.published_at ? ` · 更新于 ${escArticleHtml(a.updated_at)}` : ''} · ${escArticleHtml(a.author)}${a.tags.length ? ' · ' + a.tags.map(t => escArticleHtml(t)).join(' · ') : ''}
        </div>
        <div class="article-body">${a.html}</div>
      </main>
    </body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.send(html);
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// ============================================
// 发票 / 订单凭证页面（可打印为 PDF）
// URL: /invoice/:orderNo?t=<access_token>
// ============================================
const { tokenMatchesHash } = require('./utils/crypto');
const INVOICE_SHOP_NAME = process.env.SHOP_NAME || '数字商店';
const INVOICE_TAX_ID = process.env.INVOICE_TAX_ID || '';

function escInv(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

app.get('/invoice/:orderNo', async (req, res) => {
    try {
        const { orderNo } = req.params;
        const token = req.query.t;

        const order = await dbAll(`
            SELECT o.id, o.buyer_email, o.product_id, o.quantity, o.amount,
                   o.payment_method, o.payment_status, o.transaction_id,
                   o.created_at, o.paid_at, o.order_access_token_hash,
                   p.name AS product_name, p.price AS product_price
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.transaction_id = ?
            LIMIT 1
        `, [orderNo]).then(rows => rows[0]);

        if (!order) return res.status(404).send('订单不存在');

        // 访问控制：要求 ?t=<token>，hash 匹配才放行
        if (!token || !tokenMatchesHash(token, order.order_access_token_hash)) {
            return res.status(403).send('访问令牌无效');
        }

        if (order.payment_status !== 'paid') {
            return res.status(400).send('订单尚未支付，无法开具发票');
        }

        const unitPrice = Number(order.product_price || 0).toFixed(2);
        const total = Number(order.amount || 0).toFixed(2);
        const payMethod = order.payment_method === 'alipay' ? '支付宝' : '微信支付';
        const paidAt = order.paid_at ? String(order.paid_at).slice(0, 19) : '';
        const createdAt = order.created_at ? String(order.created_at).slice(0, 19) : '';

        const html = `<!doctype html><html lang="zh-CN"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>订单凭证 ${escInv(order.transaction_id)} - ${escInv(INVOICE_SHOP_NAME)}</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root { --ink:#0b0d10; --ink-soft:#4a5568; --ink-dim:#9aa4b2; --line:#e5e7eb; --accent:#5b8def; }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:var(--ink);background:#f4f5f7;min-height:100vh;padding:2rem 1rem;line-height:1.6}
  .sheet{max-width:720px;margin:0 auto;background:#fff;padding:3rem 3rem 2.5rem;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.08)}
  .top{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid var(--ink);padding-bottom:1.4rem;margin-bottom:2rem}
  .brand{font-size:1.55rem;font-weight:900;letter-spacing:-0.02em}
  .brand-sub{color:var(--ink-dim);font-size:0.82rem;margin-top:0.3rem}
  .doctype{text-align:right}
  .doctype h1{font-size:1.4rem;letter-spacing:0.1em;font-weight:800}
  .doctype .no{color:var(--ink-soft);font-size:0.82rem;margin-top:0.3rem;font-family:"SFMono-Regular",Menlo,monospace}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem 2rem;margin-bottom:2rem}
  .field-label{color:var(--ink-dim);font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.25rem}
  .field-value{color:var(--ink);font-size:0.92rem;font-weight:600}
  table.items{width:100%;border-collapse:collapse;margin:1.5rem 0}
  table.items th{background:#f7f8fa;border:1px solid var(--line);padding:0.75rem 0.9rem;text-align:left;font-size:0.78rem;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.04em}
  table.items td{border:1px solid var(--line);padding:0.9rem;font-size:0.92rem}
  table.items .num{text-align:right;font-variant-numeric:tabular-nums}
  .totals{display:flex;justify-content:flex-end;margin-top:1.5rem}
  .totals-box{min-width:260px}
  .total-row{display:flex;justify-content:space-between;padding:0.5rem 0;font-size:0.88rem;color:var(--ink-soft)}
  .total-row.grand{border-top:2px solid var(--ink);margin-top:0.5rem;padding-top:0.9rem;font-size:1.15rem;color:var(--ink);font-weight:800}
  .meta-block{margin-top:2.2rem;padding-top:1.5rem;border-top:1px dashed var(--line);color:var(--ink-soft);font-size:0.8rem;line-height:1.8}
  .footer-note{margin-top:2rem;padding-top:1.2rem;border-top:1px solid var(--line);color:var(--ink-dim);font-size:0.72rem;text-align:center}
  .actions{max-width:720px;margin:1.5rem auto 0;display:flex;gap:0.8rem;justify-content:center}
  .btn{padding:0.7rem 1.5rem;border-radius:8px;border:1px solid var(--ink);background:var(--ink);color:#fff;cursor:pointer;font-size:0.9rem;font-weight:600}
  .btn.ghost{background:#fff;color:var(--ink)}
  @media print {
    body{background:#fff;padding:0}
    .sheet{box-shadow:none;border-radius:0;max-width:none;margin:0}
    .actions{display:none}
  }
</style>
</head><body>
  <div class="sheet">
    <div class="top">
      <div>
        <div class="brand">${escInv(INVOICE_SHOP_NAME)}</div>
        <div class="brand-sub">数字商品与代充服务</div>
        ${INVOICE_TAX_ID ? `<div class="brand-sub">税号 / Tax ID: ${escInv(INVOICE_TAX_ID)}</div>` : ''}
      </div>
      <div class="doctype">
        <h1>订单凭证</h1>
        <div class="no">No. ${escInv(order.transaction_id)}</div>
      </div>
    </div>
    <div class="grid">
      <div>
        <div class="field-label">收件方 / Bill To</div>
        <div class="field-value">${escInv(order.buyer_email)}</div>
      </div>
      <div>
        <div class="field-label">支付方式 / Payment</div>
        <div class="field-value">${escInv(payMethod)}</div>
      </div>
      <div>
        <div class="field-label">下单时间 / Created</div>
        <div class="field-value">${escInv(createdAt)}</div>
      </div>
      <div>
        <div class="field-label">支付时间 / Paid At</div>
        <div class="field-value">${escInv(paidAt)}</div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>商品 / Item</th>
          <th class="num" style="width:90px;">数量</th>
          <th class="num" style="width:120px;">单价 (¥)</th>
          <th class="num" style="width:120px;">小计 (¥)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escInv(order.product_name)}</td>
          <td class="num">${order.quantity || 1}</td>
          <td class="num">${unitPrice}</td>
          <td class="num">${total}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-box">
        <div class="total-row"><span>小计 Subtotal</span><span>¥${total}</span></div>
        <div class="total-row"><span>税费 Tax</span><span>¥0.00</span></div>
        <div class="total-row grand"><span>合计 Total</span><span>¥${total}</span></div>
      </div>
    </div>

    <div class="meta-block">
      本凭证由 ${escInv(INVOICE_SHOP_NAME)} 根据订单 ${escInv(order.transaction_id)} 自动生成，记录商品交付与收款信息，可作为报销依据。
      如需增值税发票请联系客服 Telegram: <strong>@siuser</strong>。
    </div>
    <div class="footer-note">
      感谢您的支持 · Thank you for your business · ${escInv(new Date().getFullYear())} ${escInv(INVOICE_SHOP_NAME)}
    </div>
  </div>

  <div class="actions">
    <button class="btn" onclick="window.print()">打印 / 另存 PDF</button>
    <button class="btn ghost" onclick="history.length > 1 ? history.back() : location.href='/'">返回</button>
  </div>
</body></html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'private, no-store');
        res.send(html);
    } catch (err) {
        console.error('[invoice]', err);
        res.status(500).send('生成发票失败');
    }
});

// ============================================
// 错误处理
// ============================================

// 404 处理
app.use((req, res) => {
    // API 请求返回 JSON
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: '接口不存在' });
    }
    // 页面请求返回友好的 404 页面
    res.status(404).send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>页面不存在</title></head><body style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d10;color:#eef4fb;font-family:monospace;"><div style="text-align:center;"><div style="font-size:4rem;margin-bottom:1rem;color:#728092;">404</div><p style="color:#728092;margin-bottom:1.5rem;">页面不存在或已被移除</p><a href="/" style="color:#c7ff6b;border:1px solid rgba(199,255,107,0.2);padding:0.6rem 1.4rem;border-radius:999px;text-decoration:none;">返回首页</a></div></body></html>`);
});

// 全局错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({
        error: '服务器内部错误',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ============================================
// 启动服务器
// ============================================

app.listen(PORT, () => {
    console.log('\n🚀 服务器启动成功！');
    console.log(`\n📍 访问地址:`);
    console.log(`   前台商城: http://localhost:${PORT}`);
    console.log(`   管理后台: http://localhost:${PORT}/admin`);
    console.log(`\n⚙️  环境: ${process.env.NODE_ENV || 'development'}`);
    console.log(`\n💡 提示: 使用 Ctrl+C 停止服务器\n`);
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，正在关闭服务器...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n收到 SIGINT 信号，正在关闭服务器...');
    process.exit(0);
});
