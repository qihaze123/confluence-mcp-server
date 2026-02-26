# confluence-mcp-server

一个面向 Confluence Server/Data Center 的 MCP 服务，提供页面搜索、读取、更新能力。

## 功能

- `confluence_search_pages`: 按关键词搜索页面
- `confluence_get_page`: 按页面 ID 获取内容（storage 格式）
- `confluence_update_page`: 更新页面内容并自动递增版本

## 环境要求

- Node.js 18+
- 可访问的 Confluence Server/Data Center

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
- `CONF_USERNAME`: 登录用户名
- `CONF_PASSWORD`: 用户密码（与 `CONF_TOKEN` 二选一）
- `CONF_TOKEN`: 访问令牌（与 `CONF_PASSWORD` 二选一）
- `CONF_DEFAULT_SPACE`: 默认空间 Key（可选）

## MCP 客户端配置示例

```json
{
  "mcpServers": {
    "confluence": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
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
- 认证已支持 Bearer/Basic 两种头格式（由环境变量决定）。
