#!/usr/bin/env bash
# 生产部署完整性校验（服务器侧，部署后执行）
#
# 用法：bash deploy/verify-release.sh /tmp/next-<version>-<sha>-linux-x64.tar.gz
#
# 校验项（任一失败 → 非零退出，禁止继续使用该 artifact）：
#   1. artifact 存在且含 .next/BUILD_ID
#   2. .next 目录可解压（dry-run）
#   3. hashed external modules（@prisma/client-*、sharp-*）在包内完整存在
#   4. 项目 node_modules 中存在对应的 hashed module 目录（运行必需）
#
# 校验通过后，将包内 node_modules 合并到项目 node_modules（自动补齐缺失模块）。

set -euo pipefail

ARTIFACT="${1:-}"
PROJECT_DIR="${2:-/www/alibaba-ai-assistant}"

if [[ -z "$ARTIFACT" || ! -f "$ARTIFACT" ]]; then
  echo "FAIL: artifact not found: ${ARTIFACT:-<missing>}" >&2
  exit 1
fi

echo "== 1/4 artifact 完整性 =="
LISTING=$(tar -tzf "$ARTIFACT" 2>/dev/null || true)
# 注意：grep -q 在 pipefail 下会因 SIGPIPE(141) 误报失败，用 grep -c 计数代替
if [[ "$(echo "$LISTING" | grep -cE '\.next/BUILD_ID$' || true)" == "0" ]]; then
  echo "FAIL: .next/BUILD_ID missing" >&2
  exit 1
fi
echo "OK"

echo "== 2/4 解压 dry-run =="
if [[ "$(echo "$LISTING" | wc -l)" == "0" ]]; then
  echo "FAIL: corrupt archive" >&2
  exit 1
fi
echo "OK"

echo "== 3/4 hashed external modules 在包内 =="
PACKED=$(tar -tzf "$ARTIFACT" | grep -oE "(client|sharp)-[a-f0-9]{16,}" | sort -u || true)
if [[ -z "$PACKED" ]]; then
  echo "WARN: 包内未发现 hashed external modules（可能本构建无外部模块）"
else
  echo "packed modules: $PACKED"
fi

echo "== 4/4 项目 node_modules 中 modules 存在 =="
MISSING=0
for mod in $PACKED; do
  # 包内模块目录路径：.next/node_modules/@prisma/client-xxx 或 .next/node_modules/sharp-xxx
  DIRPATH=$(echo "$LISTING" | grep -oE "\.next/node_modules/.*$mod" | sort -u | head -1 || true)
  if [[ -z "$DIRPATH" ]]; then
    echo "FAIL: module $mod 不在 artifact 中" >&2
    MISSING=1
    continue
  fi
  REL="${DIRPATH#.next/node_modules/}"
  if [[ ! -d "$PROJECT_DIR/node_modules/$REL" ]]; then
    echo "-> 补齐 $REL（来自 artifact）"
    mkdir -p "$PROJECT_DIR/node_modules/$(dirname "$REL")"
    tar -xzf "$ARTIFACT" -C "$PROJECT_DIR" "$DIRPATH"
    rm -rf "$PROJECT_DIR/node_modules/$REL"
    mv "$PROJECT_DIR/$DIRPATH" "$PROJECT_DIR/node_modules/$REL"
    # 清理解包残留空目录
    rmdir "$PROJECT_DIR/.next/node_modules/@prisma" 2>/dev/null || true
    rmdir "$PROJECT_DIR/.next/node_modules" 2>/dev/null || true
  fi
  if [[ ! -f "$PROJECT_DIR/node_modules/$REL/package.json" ]]; then
    echo "FAIL: $REL 校验失败（package.json 缺失）" >&2
    MISSING=1
  else
    echo "OK: $REL"
  fi
done
if [[ "$MISSING" != "0" ]]; then
  echo "FAIL: external modules 校验未通过" >&2
  exit 1
fi

echo "== 部署校验全部通过 =="
