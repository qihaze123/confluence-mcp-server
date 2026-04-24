# confluence-mcp-server

一个面向 Confluence Cloud / Server / Data Center 的 MCP 服务，提供页面搜索、CQL 查询、读取、创建、更新、附件上传和用户身份查询能力。

## 功能

- `confluence_search_pages`: 按关键词搜索页面
- `confluence_execute_cql_search`: 执行原生 CQL 查询
- `confluence_get_page`: 按页面 ID 获取内容（storage 格式）
- `confluence_get_page_outline`: 获取页面标题目录，适合低 token 导航
- `confluence_get_page_section`: 按标题读取单个 section，避免把整页正文返回给模型
- `confluence_get_page_anchor_block`: 按 Anchor 起止边界读取块内容
- `confluence_create_page`: 创建页面（支持可选 `parentId`）
- `confluence_update_page`: 更新页面内容并自动递增版本
- `confluence_update_page_section`: 按标题更新单个 section，由 MCP 服务端完成整页替换与提交
- `confluence_preview_page_section_update`: 预览按标题更新的命中范围，返回旧内容和确认 hash
- `confluence_update_page_section_confirmed`: 带 hash 确认提交按标题更新，避免 preview 后内容已变化
- `confluence_add_anchor_block_to_section`: 给一个标题 section 自动加上起止 Anchor，便于后续稳定更新
- `confluence_preview_page_anchor_block_update`: 预览按 Anchor 范围更新的命中块，返回旧内容和确认 hash
- `confluence_update_page_anchor_block_confirmed`: 带 hash 确认提交 Anchor 范围更新
- `confluence_upload_attachment`: 上传页面附件（支持本地文件路径或 base64，同名附件默认更新为新版本）
- `confluence_get_current_user`: 获取当前认证用户（whoami）

## 环境要求

- Node.js 18+
- 可访问的 Confluence Cloud / Server / Data Center

## 快速开始

```bash
npm install
npm run build
npm start
```

## 通过 npx 使用（推荐）

发布到 npm 后，可在 MCP 客户端中直接使用 `npx` 启动，无需手动克隆仓库：

```json
{
  "mcpServers": {
    "confluence": {
      "command": "npx",
      "args": ["-y", "confluence-mcp-server"],
      "env": {
        "CONF_MODE": "server",
        "CONF_BASE_URL": "https://confluence.example.com",
        "CONF_USERNAME": "your-username",
        "CONF_TOKEN": "your-token",
        "CONF_DEFAULT_SPACE": "DOC"
      }
    }
  }
}
```

## 环境变量

- `CONF_BASE_URL`: Confluence 基础地址，例如 `https://confluence.example.com`
- `CONF_MODE`: 部署模式，`cloud` 或 `server`（默认 `server`）
- `CONF_AUTH_MODE`: 认证模式，`auto` / `basic` / `bearer`（默认 `auto`）
- `CONF_USERNAME`: 登录用户名（Cloud 必填；Server 在 `basic` 模式或使用密码时必填）
- `CONF_PASSWORD`: 用户密码（与 `CONF_TOKEN` 组合按模式使用）
- `CONF_TOKEN`: 访问令牌（Cloud 下作为 API Token；Server 下默认走 Bearer）
- `CONF_DEFAULT_SPACE`: 默认空间 Key（可选）

## MCP 客户端配置示例

```json
{
  "mcpServers": {
    "confluence": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "CONF_MODE": "server",
        "CONF_BASE_URL": "https://confluence.example.com",
        "CONF_USERNAME": "your-username",
        "CONF_TOKEN": "your-token",
        "CONF_DEFAULT_SPACE": "DOC"
      }
    }
  }
}
```

## 说明

- 该项目当前聚焦 Confluence 能力，不包含 Jira 工具。
- Cloud 模式固定使用 Basic（`CONF_USERNAME` + `CONF_TOKEN/CONF_PASSWORD`）。
- Server 模式可用 Bearer 或 Basic（`CONF_AUTH_MODE=auto` 时优先 Bearer）。
- Cloud 模式 API 基础路径为 `/wiki/rest/api`，Server 模式为 `/rest/api`。
- 上传图片后，`confluence_upload_attachment` 会返回 `storageImageMarkup`，可把它拼到 `confluence_update_page` 的 `bodyStorageValue` 中展示图片。
- Confluence 原生更新仍是整页版本化 `PUT`；`confluence_update_page_section` 只是把“整页读取 + 局部替换 + 整页提交”放在 MCP 服务端完成，从而显著减少模型侧 tokens。
- 两阶段更新不会减少 Confluence 侧请求次数，但会显著降低误改风险：preview 返回旧内容和 `expectedCurrentHash`，confirmed update 会重新拉取页面并校验 hash 一致后才提交。
- Anchor 模式使用 Confluence Anchor 宏作为隐形边界，适合长期自动维护固定区域；普通阅读模式下通常不会显示这些锚点。

## 低 Token 推荐流程

1. 先用 `confluence_search_pages` 或 `confluence_execute_cql_search` 定位页面。
2. 再用 `confluence_get_page_outline` 获取标题目录，不直接读整页正文。
3. 用 `confluence_get_page_section` 按 `heading` 拉取需要处理的 section。
4. 修改完成后，用 `confluence_update_page_section` 只提交该 section 的 storage 内容。

如果页面里存在重复标题，可以配合 `occurrence` 指定第几个同名标题；`matchMode=contains` 可用于模糊匹配标题。

## 更安全的两阶段更新

1. 先调用 `confluence_preview_page_section_update`。
2. 检查返回的 `oldStorageValue` 和 `newStorageValue` 是否符合预期。
3. 把返回的 `expectedCurrentHash` 原样传给 `confluence_update_page_section_confirmed`。
4. 服务端会重新拉取页面并校验 hash，一致才真正提交更新。

## 更稳定的 Anchor 更新

1. 先用 `confluence_add_anchor_block_to_section` 给目标 section 加上 `startAnchor` / `endAnchor`。
2. 后续读取时用 `confluence_get_page_anchor_block`。
3. 更新时先用 `confluence_preview_page_anchor_block_update`，确认后再调用 `confluence_update_page_anchor_block_confirmed`。

Anchor 名称建议使用业务语义化命名，例如 `risk-summary-start`、`risk-summary-end`，避免依赖标题文本本身。
