# QuantX Engineering / Context MCP Server (`quantx-engineering-context`)

An MCP (Model Context Protocol) server dedicated exclusively to **repository intelligence, symbol extraction, dependency tracing, audit context, and targeted code retrieval** for AI coding assistants (such as Antigravity).

---

## Purpose & Value Proposition

- **Eliminates Token Waste**: Rather than scanning or reading the entire ~280,000-token repository, Antigravity uses `quantx_context_plan` to retrieve only the minimal sufficient context (typically `< 3,000` tokens, compression ratio `< 0.05`).
- **Completely Isolated**: Built in `apps/mcp-engineering/`, totally separated from the financial/trading MCP (`apps/mcp-server/`). No trading execution, no portfolio mutations, and no market-data queries.
- **Strictly Read-Only & Safe**: Operates via STDIO transport, path traversal guards (`PathGuard`), automated secret redaction (`SecretRedactor`), and treats all source code as data only (`UNTRUSTED_REPOSITORY_CONTENT`).
- **AST-Aware**: Uses the TypeScript compiler API and Python AST parser to extract symbols, classes, methods, decorators, and call hierarchies.
- **Incremental & Git-Aware**: Detects git SHA changes and only re-indexes modified files, persisting cache in `.quantx/context/`.

---

## 25 MCP Tools Reference

| Tool | Category | Description |
|---|---|---|
| `quantx_context_plan` | **Core Planning** | **Start here for non-trivial tasks.** Maps natural language tasks to minimal sufficient context (primary files, symbols, tests, dependencies, audit findings, token budget). |
| `quantx_search_code` | Search | Ranked code search across repository (exact & text matches). |
| `quantx_find_symbol` | Discovery | Look up symbols by name or partial match with definition location. |
| `quantx_get_file_context` | Context | Get targeted file context by retrieval level (0=metadata to 6=full). |
| `quantx_get_symbol_context`| Context | Definition, callers, callees, related tests, and audit findings. |
| `quantx_find_callers` | Graph | Find all symbols that call or import a given symbol. |
| `quantx_find_callees` | Graph | Find all symbols called or imported by a given symbol. |
| `quantx_get_dependencies` | Graph | Import/export dependency graph (bounded depth 1-5). |
| `quantx_trace_flow` | Graph | Trace execution flow from entry point symbol through call chains. |
| `quantx_get_module_context`| Architecture | Module summary (files, exported symbols, scope). |
| `quantx_get_architecture` | Architecture | High-level repository architecture map, module file counts, open bugs. |
| `quantx_find_tests` | Testing | Find tests covering a given symbol or file. |
| `quantx_get_test_context` | Testing | Extract test classes and methods from a test file. |
| `quantx_get_recent_changes`| Git | Recent git commits with touched files. |
| `quantx_get_commit_context`| Git | Detailed diff summary and changed files for a commit SHA. |
| `quantx_get_diff_context` | Git | Git diff between base and target refs. |
| `quantx_get_audit_context` | Audit | Audit findings for BUG-01 through BUG-04 and economic repairs. |
| `quantx_trace_bug` | Audit | Full bug trace: affected files, symbols, callers, regression tests. |
| `quantx_impact_analysis` | Safety | Blast radius analysis before modifying code: dependents, callers, tests. |
| `quantx_expand_context` | Context | Progressively expand context from a previous contextId outward. |
| `quantx_get_model_lineage` | Lineage | Data → features → training → calibration → export lineage. |
| `quantx_get_strategy_lineage`| Lineage | Signal → EV → ranking → portfolio → execution lineage. |
| `quantx_get_artifact_lineage`| Lineage | Research artifacts, hash engines, experiment registry lineage. |
| `quantx_health` | Ops | Server health: uptime, indexed files, symbols, git commit. |
| `quantx_start_full_audit` | Ops | Exception-only: force full repository re-index. |

---

## Configuration

Environment variables (with defaults):
```bash
QUANTX_REPO_ROOT=/path/to/stockPredictor      # Auto-detected if omitted
QUANTX_CONTEXT_INDEX=.quantx/context          # Relative to repo root
MCP_SERVER_NAME=quantx-engineering-context
MCP_SERVER_VERSION=1.0.0
MCP_LOG_LEVEL=info                           # debug | info | warn | error
```

---

## Running & Testing

```bash
# Build
npm run build --prefix apps/mcp-engineering
# or from repo root:
npm run mcp:eng:build

# Run tests
npm test --prefix apps/mcp-engineering
# or from repo root:
npm run mcp:eng:test

# Run dev mode
npm run dev --prefix apps/mcp-engineering

# Start production server (STDIO)
npm start --prefix apps/mcp-engineering
# or from repo root:
npm run mcp:eng:start
```
