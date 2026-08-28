# Antigravity Engineering Context Guide

This repository contains a dedicated **Engineering / Context MCP Server** (`apps/mcp-engineering/`) designed to provide surgical code context to Antigravity while minimizing token consumption.

---

## Operating Protocol for Agents

Whenever executing a non-trivial development, debugging, audit, or refactoring task in the QuantX repository:

### 1. START WITH `quantx_context_plan`
Before scanning directories or reading multiple source files, call `quantx_context_plan` with your task description:
```json
{
  "task": "Fix calibration leakage in probability model"
}
```
**Why**:
- The repository contains ~280,000 tokens of code.
- `quantx_context_plan` analyzes the request against known domain keywords, symbol graphs, and past audit findings (BUG-01 to BUG-04).
- It returns a targeted `ContextPlan` containing only the relevant primary files, primary symbols, related regression tests, and audit history.
- Typical retrieved context is **< 3,000 tokens** (compression ratio **< 0.02**).

### 2. USE TARGETED RETRIEVAL TOOLS
Do not read whole files if only a function or class is needed:
- `quantx_find_symbol`: Locate exact symbol signatures, start/end lines, and docstrings.
- `quantx_get_symbol_context`: Get the symbol definition along with callers, callees, and related tests.
- `quantx_get_file_context`: Query files with progressive levels (`level: 0` for metadata, `level: 2` for symbols, `level: 6` only when full content is mandatory).

### 3. ASSESS BLAST RADIUS BEFORE EDITING
Before modifying existing shared classes, services, or engines:
- Call `quantx_impact_analysis` on the target file or symbol.
- Inspect dependent files, callers, and test files that must be verified.

### 4. RECONCILE WITH HISTORICAL AUDITS
- Call `quantx_get_audit_context` or `quantx_trace_bug` (e.g. `bugId: "BUG-04"`) to review prior failure modes, fixed files, and regression test suites.

---

## Server Configuration in MCP Client

To add `quantx-engineering-context` to an MCP client configuration (e.g. `claude_desktop_config.json` or Antigravity MCP settings):

```json
{
  "mcpServers": {
    "quantx-engineering": {
      "command": "node",
      "args": ["<PATH_TO_REPO>/apps/mcp-engineering/dist/index.js"],
      "env": {
        "QUANTX_REPO_ROOT": "<PATH_TO_REPO>",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```
*(Note: Keep this completely separate from the financial trading MCP server `apps/mcp-server`)*.
