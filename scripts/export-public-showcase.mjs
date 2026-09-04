/**
 * export-public-showcase.mjs
 *
 * 职责：
 * 从已完成的 Next.js 生产构建中提取公网 HR 展示页（/showcase），
 * 生成完全自包含、纯静态的部署产物（dist/public-showcase/）。
 *
 * 严格安全红线：
 * 1. 零 Server 代码（不复制 .next/server）；
 * 2. 零 API 路由（无 app/api）；
 * 3. 零数据库（无 dev.db / prisma / SQLite）；
 * 4. 零环境变量（无 .env / .env.local）；
 * 5. 零 Provider 与零业务代码；
 * 6. 仅精确复制 showcase.html 中实际引用的静态前端资源（JS/CSS/Media/Icon）。
 */

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const NEXT_DIR = path.join(PROJECT_ROOT, '.next');
const NEXT_STATIC_DIR = path.join(NEXT_DIR, 'static');
const SHOWCASE_HTML_SOURCE = path.join(NEXT_DIR, 'server', 'app', 'showcase.html');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist', 'public-showcase');

function log(msg) {
  console.log(`[showcase-export] ${msg}`);
}

function error(msg) {
  console.error(`[showcase-export ERROR] ${msg}`);
}

// 提取 HTML 中所有 _next/static 引用的资源相对路径
function extractReferencedAssets(html) {
  const assetSet = new Set();
  const assetRegex = /(?:\/|\.\/)?_next\/static\/([a-zA-Z0-9_\-./]+\.(?:js|css|woff2?|ttf|eot|svg|png|jpg|webp))/g;

  let match;
  while ((match = assetRegex.exec(html)) !== null) {
    assetSet.add(match[1]);
  }

  return Array.from(assetSet);
}

// 统计文件数与总大小
function getDirStats(dir) {
  let count = 0;
  let totalBytes = 0;

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        count++;
        totalBytes += fs.statSync(fullPath).size;
      }
    }
  }

  if (fs.existsSync(dir)) {
    walk(dir);
  }
  return { count, totalBytes };
}

// 递归复制目录中的非源码映射文件
function copyDirFiltered(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirFiltered(srcPath, destPath);
    } else {
      if (!entry.name.endsWith('.map')) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

// 负向安全审查扫描
function runSecurityAudit(dir) {
  const bannedPatterns = [
    /server/i,
    /api/i,
    /prisma/i,
    /\.db$/i,
    /\.sqlite/i,
    /\.env/i,
    /package\.json/i,
    /node_modules/i,
    /route\.js/i,
    /server-reference/i,
    /middleware/i,
  ];

  const violations = [];

  function scan(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const relative = path.relative(dir, path.join(current, entry.name));
      const name = entry.name;

      for (const pattern of bannedPatterns) {
        if (pattern.test(name)) {
          violations.push(relative);
        }
      }

      if (entry.isDirectory()) {
        scan(path.join(current, entry.name));
      }
    }
  }

  scan(dir);
  return violations;
}

function main() {
  log('Starting Public Showcase static snapshot export...');

  // 1. 检查构建产物
  if (!fs.existsSync(SHOWCASE_HTML_SOURCE)) {
    error(`Showcase static HTML not found at: ${SHOWCASE_HTML_SOURCE}`);
    error('Please run "npm run build" before exporting the showcase.');
    process.exit(1);
  }

  if (!fs.existsSync(NEXT_STATIC_DIR)) {
    error(`Next.js static assets directory not found at: ${NEXT_STATIC_DIR}`);
    process.exit(1);
  }

  // 2. 清理并创建目标目录 dist/public-showcase/
  log(`Target directory: ${DIST_DIR}`);
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 3. 读取并写入 index.html
  log('Copying showcase.html -> index.html...');
  const htmlContent = fs.readFileSync(SHOWCASE_HTML_SOURCE, 'utf8');
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), htmlContent, 'utf8');

  // 4. 解析并精确复制引用的静态资源
  log('Analyzing referenced browser assets in showcase.html...');
  const referencedAssets = extractReferencedAssets(htmlContent);
  log(`Found ${referencedAssets.length} referenced static assets in HTML.`);

  const targetStaticBase = path.join(DIST_DIR, '_next', 'static');
  for (const assetRel of referencedAssets) {
    const srcFile = path.join(NEXT_STATIC_DIR, assetRel);
    const destFile = path.join(targetStaticBase, assetRel);

    if (fs.existsSync(srcFile)) {
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.copyFileSync(srcFile, destFile);
    } else {
      log(`Warning: Referenced asset not found on disk: ${assetRel}`);
    }
  }

  // 复制 media 目录（字体/字体图标等公共资源，若存在）
  const srcMedia = path.join(NEXT_STATIC_DIR, 'media');
  if (fs.existsSync(srcMedia)) {
    copyDirFiltered(srcMedia, path.join(targetStaticBase, 'media'));
    log('Copied _next/static/media/ directory.');
  }

  // 5. 复制公共图标（优先检查 app/icon.svg 与 public/icon.svg）
  const appIconSource = path.join(PROJECT_ROOT, 'app', 'icon.svg');
  const publicIconSource = path.join(PUBLIC_DIR, 'icon.svg');
  if (fs.existsSync(appIconSource)) {
    fs.copyFileSync(appIconSource, path.join(DIST_DIR, 'icon.svg'));
    log('Copied app/icon.svg -> dist/public-showcase/icon.svg');
  } else if (fs.existsSync(publicIconSource)) {
    fs.copyFileSync(publicIconSource, path.join(DIST_DIR, 'icon.svg'));
    log('Copied public/icon.svg -> dist/public-showcase/icon.svg');
  }

  // 6. 复制展示媒体资源（如未来存在 public/showcase/）
  const showcaseMediaSource = path.join(PUBLIC_DIR, 'showcase');
  const showcaseMediaDest = path.join(DIST_DIR, 'showcase');
  if (fs.existsSync(showcaseMediaSource)) {
    copyDirFiltered(showcaseMediaSource, showcaseMediaDest);
    log('Copied public/showcase/ media folder to dist/public-showcase/showcase/');
  } else {
    log('public/showcase/ does not exist yet (media slots ready for future placement).');
  }

  // 7. 执行负向安全审计
  log('Running negative security audit on exported artifact...');
  const violations = runSecurityAudit(DIST_DIR);
  if (violations.length > 0) {
    error(`Security audit failed! Forbidden files detected in artifact: ${violations.join(', ')}`);
    process.exit(1);
  }
  log('Security audit PASSED: 0 server files, 0 APIs, 0 databases, 0 secrets.');

  // 8. 输出统计
  const stats = getDirStats(DIST_DIR);
  const sizeKb = (stats.totalBytes / 1024).toFixed(1);
  log(`Export finished successfully! Total files: ${stats.count}, Total size: ${sizeKb} KB (${stats.totalBytes} bytes)`);
  log(`Isolated static artifact is ready at: ${DIST_DIR}`);
}

main();
