# confluence-mcp-server

一个面向 Confluence Cloud / Server / Data Center 的 MCP 服务，提供页面搜索、CQL 查询、读取、创建、更新和用户身份查询能力。

## 功能

- `confluence_search_pages`: 按关键词搜索页面
- `confluence_execute_cql_search`: 执行原生 CQL 查询
- `confluence_get_page`: 按页面 ID 获取内容（storage 格式）
- `confluence_create_page`: 创建页面（支持可选 `parentId`）
- `confluence_update_page`: 更新页面内容并自动递增版本
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
