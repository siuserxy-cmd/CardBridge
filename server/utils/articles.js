// 文章加载器：从 content/articles/*.md 读取并解析 frontmatter + Markdown
// 启动时一次性加载，热更新不需要重启（content 改变后重启即可）

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ARTICLES_DIR = path.join(__dirname, '..', '..', 'content', 'articles');

// 极简 frontmatter 解析：只认 key: value，支持 --- 定界
function parseFrontmatter(raw) {
    const fm = {};
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { fm, body: raw };
    const lines = match[1].split('\n');
    for (const line of lines) {
        const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
        if (m) fm[m[1]] = m[2].trim();
    }
    return { fm, body: match[2] };
}

// 配置 marked：启用 GFM（表格、任务列表等）
marked.setOptions({ gfm: true, breaks: false });

// 简单 HTML 转义（用于 title / description 注入）
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// 从 body 中提取首段作为摘要（去掉标题行）
function extractExcerpt(body, maxLen = 160) {
    const lines = body.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('#')) continue;
        if (trimmed.startsWith('---')) continue;
        const clean = trimmed.replace(/[*_`[\]]/g, '');
        return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
    }
    return '';
}

const ARTICLES = new Map();

function loadArticles() {
    ARTICLES.clear();
    if (!fs.existsSync(ARTICLES_DIR)) {
        console.warn('[articles] content/articles/ 不存在，跳过加载');
        return;
    }
    const files = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.md'));
    for (const file of files) {
        const slug = file.replace(/\.md$/, '');
        const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), 'utf8');
        const { fm, body } = parseFrontmatter(raw);
        const html = marked.parse(body);
        ARTICLES.set(slug, {
            slug,
            title: fm.title || slug,
            description: fm.description || extractExcerpt(body),
            published_at: fm.published_at || '',
            updated_at: fm.updated_at || fm.published_at || '',
            author: fm.author || '数字商店',
            tags: (fm.tags || '').split(',').map(s => s.trim()).filter(Boolean),
            html
        });
    }
    console.log(`[articles] 加载 ${ARTICLES.size} 篇文章`);
}

function list() {
    return Array.from(ARTICLES.values()).sort((a, b) => {
        return (b.published_at || '').localeCompare(a.published_at || '');
    });
}

function get(slug) {
    return ARTICLES.get(slug) || null;
}

module.exports = { loadArticles, list, get, escapeHtml };
