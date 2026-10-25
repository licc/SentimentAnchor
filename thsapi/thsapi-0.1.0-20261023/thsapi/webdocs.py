"""在线 API 文档页面（单文件、离线可用，不依赖 CDN）。"""
from __future__ import annotations

import json

ENDPOINTS = [
    {
        "group": "状态",
        "method": "GET",
        "path": "/api/v1/health",
        "summary": "健康检查：客户端进程、登录状态、是否有阻塞弹窗",
        "desc": "查看客户端是否在运行、是否已登录。只在调用方主动请求时执行，文档页不会自动调用。",
        "params": [],
        "resp": {
            "ok": True,
            "client_running": True,
            "client_logged_in": True,
            "broker": "gui",
            "mode": "live",
            "version": "0.1.0",
            "now": "2026-10-21T18:30:00",
            "last_order_at": "2026-10-21T14:59:58",
            "detail": {"client_running": True, "client_logged_in": True},
        },
    },
    {
        "group": "查询",
        "method": "GET",
        "path": "/api/v1/portfolio",
        "summary": "资金 + 持仓（同一页，一次读回）",
        "desc": "切到「资金股票」页：资金读控件文本，持仓截屏 OCR。两者本来就在同一屏，合并成一个接口，少切一次页。",
        "params": [
            {
                "name": "fresh",
                "in": "query",
                "type": "bool",
                "required": False,
                "default": "true",
                "desc": "true=强制重新读页面（默认）",
            }
        ],
        "resp": {
            "account": {
                "total_asset": 100000.0,
                "cash_available": 50000.0,
                "cash_withdrawable": 50000.0,
                "frozen": 0.0,
                "market_value": 50000.0,
                "pnl_today": 120.0,
                "pnl_total": 1500.0,
                "currency": "CNY",
                "updated_at": "2026-10-21T18:30:00",
            },
            "positions": [
                {
                    "symbol": "513100",
                    "name": "纳指ETF",
                    "quantity": 1000,
                    "available": 1000,
                    "cost_price": 1.8,
                    "last_price": 1.85,
                    "market_value": 1850.0,
                    "pnl": 50.0,
                    "pnl_pct": 2.78,
                }
            ],
        },
    },
    {
        "group": "查询",
        "method": "GET",
        "path": "/api/v1/orders",
        "summary": "当日委托",
        "desc": "切到「当日委托」页 OCR 读表。refresh=true 时先刷新一次。",
        "params": [{"name": "refresh", "in": "query", "type": "bool", "required": False, "default": "true", "desc": "是否先刷新"}],
        "resp": [
            {
                "order_id": "12345678",
                "symbol": "513100",
                "name": "纳指ETF",
                "side": "买入",
                "price": 1.85,
                "quantity": 100,
                "filled": 100,
                "status": "全部成交",
                "time": "14:59:58",
            }
        ],
    },
    {
        "group": "查询",
        "method": "GET",
        "path": "/api/v1/trades",
        "summary": "当日成交",
        "desc": "切到「当日成交」页 OCR 读表。",
        "params": [],
        "resp": [
            {
                "trade_id": "87654321",
                "order_id": "12345678",
                "symbol": "513100",
                "name": "纳指ETF",
                "side": "买入",
                "price": 1.849,
                "quantity": 100,
                "amount": 184.9,
                "time": "14:59:59",
            }
        ],
    },
    {
        "group": "交易",
        "method": "POST",
        "path": "/api/v1/orders",
        "summary": "下单（限价）",
        "desc": "填写代码/价格/数量 → 点买入 → 解析确认框里的合同编号 → 回读当日委托。全程不复制表格，不受验证码影响。",
        "params": [
            {"name": "symbol", "in": "body", "type": "string", "required": True, "desc": "6 位代码，支持 513100 / sh513100"},
            {"name": "side", "in": "body", "type": "string", "required": True, "desc": "buy / sell"},
            {"name": "price", "in": "body", "type": "number", "required": True, "desc": "限价（元）"},
            {"name": "quantity", "in": "body", "type": "int", "required": True, "desc": "股数，主板 100 的整数倍"},
            {"name": "client_order_id", "in": "body", "type": "string", "required": False, "desc": "幂等 ID，重复提交返回首次结果"},
            {"name": "ref_price", "in": "body", "type": "number", "required": False, "desc": "参考价，用于价格偏离校验"},
            {"name": "order_type", "in": "body", "type": "string", "required": False, "desc": "limit（默认）"},
        ],
        "example": {
            "symbol": "513100",
            "side": "buy",
            "price": 1.85,
            "quantity": 100,
            "client_order_id": "20261022-0001",
            "ref_price": 1.85,
        },
        "resp": {
            "ok": True,
            "order_id": "12345678",
            "order_key": "20261023-093015-12345",
            "client_order_id": "20261022-0001",
            "symbol": "513100",
            "side": "buy",
            "price": 1.85,
            "quantity": 100,
            "status": "accepted",
            "message": "委托成功",
            "elapsed_ms": 1830,
            "raw": {"name": "纳指ETF", "dialogs": ["委托确认 ..."]},
        },
    },
    {
        "group": "交易",
        "method": "POST",
        "path": "/api/v1/cancel",
        "summary": "撤单（按合同编号或代码）",
        "desc": "切到撤单页 → OCR 找到目标行 → 点中它 → 点「撤单(Del)」。找不到就报错，绝不乱点。",
        "params": [
            {"name": "order_id", "in": "body", "type": "string", "required": False, "desc": "合同编号"},
            {"name": "symbol", "in": "body", "type": "string", "required": False, "desc": "按代码撤（与 order_id 二选一）"},
        ],
        "example": {"order_id": "12345678"},
        "resp": {"ok": True, "message": "撤单成功", "dialog_texts": ["撤单成功"]},
    },
]

_IMAGES = {}  # 截图已移除以避免暴露真实账户信息
for _e in ENDPOINTS:
    _e["image"] = _IMAGES.get((_e["method"], _e["path"]))

PATHS = [
    {
        "api": "GET /health",
        "steps": ["枚举客户端进程的窗口", "检查左侧导航树是否存在（=已登录）", "检查是否有模态框挡住界面"],
    },
    {
        "api": "GET /portfolio",
        "steps": ["点击「资金股票」", "刷新", "读 6 个资金字段", "截屏 + OCR 识别持仓表", "过滤 0 股占位行"],
    },
    {
        "api": "GET /orders",
        "steps": ["点击「当日委托」", "刷新", "截屏 + OCR 识别委托表", "过滤汇总行/水印行"],
    },
    {
        "api": "GET /trades",
        "steps": ["点击「当日成交」", "刷新", "截屏 + OCR 识别成交表"],
    },
    {
        "api": "POST /orders",
        "steps": [
            "（卖出时）先查 /positions 核对可用数量",
            "点击「买入」或「卖出」",
            "填写证券代码 → 等名称联动",
            "填写价格（3 位小数）",
            "填写数量",
            "点击「买入 / 卖出」按钮",
            "处理确认框（是/确定）",
            "点击「当日委托」",
            "OCR 回读核实（合同编号 / 代码+数量）",
        ],
    },
    {
        "api": "POST /cancel",
        "steps": [
            "点击「撤单」",
            "OCR 在可撤列表里定位合同编号所在行",
            "点击该行",
            "点击「撤单(Del)」",
            "处理确认框",
            "点击「当日委托」回读核实（委托消失或已撤）",
        ],
    },
]

ERRORS = [
    ("400", "order_rejected", "客户端拒绝（资金不足、涨跌停、非交易时间等）"),
    ("401", "unauthorized", "API Key 错误"),
    ("409", "duplicate_client_order_id", "同一 client_order_id 正在处理中"),
    ("400", "risk_rejected", "本地风控拦截（限额/整手/白名单/价格偏离）"),
    ("502", "order_result_unknown", "结果未知：已发出但未确认，需人工核对"),
    ("503", "client_not_running", "客户端未运行"),
    ("503", "client_not_logged_in", "客户端未登录"),
    ("503", "client_needs_attention", "客户端有需要人工处理的弹窗"),
    ("504", "ui_timeout", "界面操作超时"),
    ("504", "ui_element_not_found", "控件找不到（客户端升级后需重新校准）"),
    ("400", "cancel_failed", "撤单失败（委托仍在可撤列表）"),
    ("404", "order_not_found", "可撤列表和当日委托里都没有这笔委托"),
]

PAGE = r"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>交易接口 · API 文档</title>
<style>
  :root{
    --bg:#0f1115; --panel:#161a21; --panel2:#1c222b; --line:#262d38;
    --text:#e6e9ef; --muted:#98a2b3; --accent:#4c8dff; --green:#2fbf71;
    --orange:#f5a623; --red:#ff5c5c; --code:#0b0e13;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  header{position:sticky;top:0;z-index:20;background:rgba(15,17,21,.92);backdrop-filter:blur(8px);
    border-bottom:1px solid var(--line);padding:14px 24px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
  header h1{font-size:16px;margin:0;font-weight:600;letter-spacing:.3px}
  .badge{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--panel2);color:var(--muted);border:1px solid var(--line)}
  .spacer{flex:1}
  .keybox{display:flex;gap:8px;align-items:center}
  input[type=text]{background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 10px;width:260px;outline:none}
  input[type=text]:focus{border-color:var(--accent)}
  button{cursor:pointer;border:1px solid var(--line);background:var(--panel2);color:var(--text);
    border-radius:8px;padding:7px 12px;font-size:13px}
  button:hover{border-color:var(--accent)}
  button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  main{display:grid;grid-template-columns:250px 1fr;gap:0;max-width:1400px;margin:0 auto}
  nav{position:sticky;top:65px;align-self:start;height:calc(100vh - 65px);overflow:auto;
    border-right:1px solid var(--line);padding:16px 12px}
  nav .grp{font-size:12px;color:var(--muted);margin:14px 8px 6px;letter-spacing:1px}
  nav a{display:block;padding:6px 10px;border-radius:8px;color:var(--text);text-decoration:none;font-size:13px}
  nav a:hover{background:var(--panel)}
  section{padding:22px 28px;border-bottom:1px solid var(--line)}
  .ep-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .m{font-size:12px;font-weight:700;padding:3px 8px;border-radius:6px;letter-spacing:.5px}
  .m.GET{background:#123b2a;color:#5fe0a0}
  .m.POST{background:#1b2f52;color:#8bb8ff}
  code,.path{font-family:Consolas,"Cascadia Mono",monospace}
  .path{font-size:15px;color:#cfe0ff}
  .summary{color:var(--muted);margin:6px 0 14px}
  h3{font-size:13px;color:var(--muted);font-weight:600;margin:18px 0 8px;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--muted);font-weight:500;font-size:12px}
  pre{background:var(--code);border:1px solid var(--line);border-radius:10px;padding:14px;
    overflow:auto;font-size:12.5px;line-height:1.55;margin:0}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:900px){main{grid-template-columns:1fr}nav{display:none}.row{grid-template-columns:1fr}}
  .toolbar{display:flex;gap:8px;margin:10px 0}
  .note{border-left:3px solid var(--orange);background:rgba(245,166,35,.08);padding:10px 14px;border-radius:0 8px 8px 0;color:#f0d3a1;font-size:13px;margin:12px 0}
  .ok{border-left-color:var(--green);background:rgba(47,191,113,.08);color:#a9e8c6}
  .err{border-left-color:var(--red);background:rgba(255,92,92,.08);color:#ffb3b3}
  .shot{width:100%;max-width:900px;border:1px solid var(--line);border-radius:10px;margin-top:6px}
  .shotbox{margin:10px 0 2px}
  .shotbox>summary{cursor:pointer;font-size:13px;color:var(--muted);list-style:none;padding:6px 0}
  .shotbox>summary::-webkit-details-marker{display:none}
  .shotbox>summary:before{content:"▸ "}
  .shotbox[open]>summary:before{content:"▾ "}
  .small{font-size:12px;color:var(--muted)}
  .tag{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px;margin-left:6px}
</style>
</head>
<body>
<header>
  <h1>交易接口</h1>
  <span class="badge" id="ver">v__VERSION__</span>
  <span class="badge" id="mode">mode: __MODE__</span>
  <span class="badge">http://127.0.0.1:__PORT__</span>
  <div class="spacer"></div>
  <div class="keybox">
    <span id="keywrap">
      <input id="apikey" type="text" placeholder="X-API-Key（保存在浏览器本地）">
      <button onclick="saveKey()">保存</button>
    </span>

    <a href="/docs" target="_blank"><button>Swagger</button></a>
  </div>
</header>

<main>
  <nav id="nav"></nav>
  <div id="content"></div>
</main>

<script>
const ENDPOINTS = __ENDPOINTS__;
const PATHS = __PATHS__;
const ERRORS = __ERRORS__;
const AUTH = __AUTH__;
const BASE = location.origin;

if (!AUTH){
  const kw = document.getElementById('keywrap');
  if (kw) kw.style.display = 'none';
  const b = document.createElement('span');
  b.className = 'badge';
  b.textContent = '内网 · 免鉴权';
  document.querySelector('.badge').after(b);
}

function saveKey(){ localStorage.setItem('api_key', document.getElementById('apikey').value.trim()); }
document.getElementById('apikey').value = localStorage.getItem('api_key') || '';

function render(){
  const nav = document.getElementById('nav');
  const content = document.getElementById('content');
  let groups = {};
  ENDPOINTS.forEach((e,i)=>{ (groups[e.group] ||= []).push({e,i}); });

  let navHtml = '';
  for (const g in groups){
    navHtml += `<div class="grp">${g}</div>`;
    groups[g].forEach(({e,i})=>{ navHtml += `<a href="#ep${i}">${e.path.replace('/api/v1','')}</a>`; });
  }
  nav.innerHTML = navHtml;

  let html = `
    <section id="paths">
      <div class="ep-head"><span class="path">固定操作路径</span></div>
      <div class="summary">每个接口对应唯一一条界面操作路径，不含动态探索；失败只会按固定次数重试。</div>
      <table><thead><tr><th style="width:170px">接口</th><th>固定步骤</th></tr></thead><tbody>
      ${PATHS.map(p=>`<tr><td><code>${p.api}</code></td><td>${p.steps.map((s,i)=>`${i+1}. ${s}`).join('<br>')}</td></tr>`).join('')}
      </tbody></table>
      <div class="note ok">下单 / 撤单结束后都会回读「当日委托」核实，核实不到就返回 <code>order_result_unknown</code>，不会谎报成功。</div>
    </section>`;
  ENDPOINTS.forEach((e,i)=>{
    const params = e.params || [];
    const paramRows = params.length ? `
      <h3>参数</h3>
      <table><thead><tr><th>名称</th><th>位置</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>
      ${params.map(p=>`<tr><td><code>${p.name}</code></td><td>${p.in}</td><td>${p.type}</td>
        <td>${p.required?'是':'否'}</td><td>${p.desc}${p.default!==undefined?` <span class="small">默认 ${p.default}</span>`:''}</td></tr>`).join('')}
      </tbody></table>` : '';

    const body = e.example ? JSON.stringify(e.example, null, 2) : '';
    const curl = e.method === 'GET'
      ? `curl -H "X-API-Key: <key>" "${BASE}${e.path}${(params.length&&params[0].in==='query')?'?limit=50':''}"`
      : `curl -X POST -H "X-API-Key: <key>" -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(e.example||{})}' \\\n  ${BASE}${e.path}`;

    html += `
    <section id="ep${i}">
      <div class="ep-head">
        <span class="m ${e.method}">${e.method}</span>
        <span class="path">${e.path}</span>
      </div>
      <div class="summary">${e.summary}</div>
      <div>${e.desc||''}</div>
      ${e.image ? `<details class="shotbox"><summary>操作现场（点击展开截图）</summary><img class="shot" src="${e.image}" alt="${e.path}" loading="lazy"></details>` : ''}
      ${paramRows}
      <h3>调用示例</h3>
      <div class="toolbar">
        <button onclick="copyText(this, ${JSON.stringify(curl).replace(/"/g,'&quot;')})">复制 curl</button>
        <button class="primary" onclick="tryCall(${i})">试一下</button>
      </div>
      <pre>${escapeHtml(curl)}</pre>
      ${e.method==='POST' && body ? `<h3>请求体</h3><pre>${escapeHtml(body)}</pre>` : ''}
      <h3>响应示例</h3>
      <pre>${escapeHtml(JSON.stringify(e.resp, null, 2))}</pre>
      <div id="out${i}"></div>
    </section>`;
  });

  html += `<section><div class="ep-head"><span class="path">错误码</span></div>
    <table><thead><tr><th>HTTP</th><th>code</th><th>含义</th></tr></thead><tbody>
    ${ERRORS.map(([h,c,d])=>`<tr><td>${h}</td><td><code>${c}</code></td><td>${d}</td></tr>`).join('')}
    </tbody></table>
    <div class="note">统一错误结构：<code>{"ok": false, "code": "...", "message": "...", "detail": {}}</code></div>
    </section>`;

  content.innerHTML = html;
}

function escapeHtml(s){ return s.replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function copyText(btn, text){
  navigator.clipboard.writeText(text).then(()=>{ const o=btn.textContent; btn.textContent='已复制'; setTimeout(()=>btn.textContent=o,1200); });
}

async function tryCall(i){
  const e = ENDPOINTS[i];
  const key = document.getElementById('apikey').value.trim();
  const out = document.getElementById('out'+i);
  out.innerHTML = '<div class="note">请求中 …</div>';
  const t0 = performance.now();
  try{
    const opt = { method:e.method, headers:{'X-API-Key':key} };
    if (e.method === 'POST'){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(e.example||{}); }
    const r = await fetch(BASE + e.path, opt);
    const text = await r.text();
    let pretty = text;
    try{ pretty = JSON.stringify(JSON.parse(text), null, 2); }catch(_){}
    const ms = Math.round(performance.now()-t0);
    out.innerHTML = `<div class="note ${r.ok?'ok':'err'}">HTTP ${r.status} · ${ms} ms</div><pre>${escapeHtml(pretty)}</pre>`;
  }catch(err){
    out.innerHTML = `<div class="note err">请求失败：${escapeHtml(String(err))}</div>`;
  }
}

render();
</script>
</body>
</html>
"""


def render(version: str, mode: str, port: int, auth_required: bool = True) -> str:
    return (
        PAGE.replace("__ENDPOINTS__", json.dumps(ENDPOINTS, ensure_ascii=False))
        .replace("__ERRORS__", json.dumps(ERRORS, ensure_ascii=False))
        .replace("__PATHS__", json.dumps(PATHS, ensure_ascii=False))
        .replace("__VERSION__", version)
        .replace("__MODE__", mode)
        .replace("__PORT__", str(port))
        .replace("__AUTH__", "true" if auth_required else "false")
    )
