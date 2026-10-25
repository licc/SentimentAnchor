"""纯函数测试：表格解析、字段映射、弹窗判定、交易规则。"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from thsapi.config import SafetyConfig  # noqa: E402
from thsapi.guard import RiskGuard, is_trading_time, lot_rule  # noqa: E402
from thsapi.gui.grid import parse_tsv, pick, to_float, to_int  # noqa: E402
from thsapi.gui.ths import ThsClient  # noqa: E402
from thsapi.models import OrderRequest, Side  # noqa: E402


POSITION_TSV = (
    "证券代码\t证券名称\t股票余额\t可用余额\t参考成本价\t市价\t市值\t盈亏\t盈亏比例\n"
    "600000\t浦发银行\t1,000\t1,000\t7.100\t7.500\t7500.00\t400.00\t5.63\n"
    "000001\t平安银行\t500\t0\t11.200\t11.100\t5550.00\t-50.00\t-0.89\n"
)


def test_parse_tsv_positions():
    data = parse_tsv(POSITION_TSV)
    assert data.headers[0] == "证券代码"
    assert len(data.rows) == 2
    rows = data.dicts()
    assert rows[0]["证券名称"] == "浦发银行"
    assert to_int(pick(rows[0], "股票余额")) == 1000
    assert to_float(pick(rows[1], "盈亏")) == -50.0


def test_parse_tsv_ignores_total_row_and_blank_lines():
    text = POSITION_TSV + "合计\t\t1500\t\t\t\t13050.00\t350.00\t\n"
    data = parse_tsv(text)
    assert all(r[0] != "合计" for r in data.rows)


def test_parse_tsv_quoted_cells():
    data = parse_tsv('代码\t名称\n"600000"\t"浦发 银行"\n')
    assert data.rows[0] == ["600000", "浦发 银行"]


def test_pick_tolerates_spaces_and_suffixes():
    row = {"委托 数量": "100", "合同编号": "123456"}
    assert pick(row, "委托数量") == "100"
    assert pick(row, "合同号") == "123456"


def test_parse_contract_no():
    assert ThsClient.parse_contract_no("委托成功\n合同编号: 12345678") == "12345678"
    assert ThsClient.parse_contract_no("委托编号：987654") == "987654"
    assert ThsClient.parse_contract_no("委托成功") is None


def test_judge_dialog():
    assert ThsClient.judge_dialog("委托成功") == "success"
    assert ThsClient.judge_dialog("资金不足，委托失败") == "failed"
    assert ThsClient.judge_dialog("请确认委托信息") == "unknown"


@pytest.mark.parametrize(
    "symbol,expected",
    [("600000", (100, 100)), ("000001", (100, 100)), ("688981", (200, 1)), ("830799", (100, 1))],
)
def test_lot_rule(symbol, expected):
    assert lot_rule(symbol) == expected


def test_trading_time():
    assert is_trading_time(datetime(2026, 10, 21, 10, 0))  # 周三上午
    assert not is_trading_time(datetime(2026, 10, 21, 12, 0))
    assert is_trading_time(datetime(2026, 10, 21, 14, 59))
    assert not is_trading_time(datetime(2026, 10, 24, 10, 0))  # 周六


def _guard(**kw):
    return RiskGuard(SafetyConfig(**kw))


def test_guard_rejects_odd_lot():
    g = _guard(allow_out_of_hours=True)
    with pytest.raises(Exception):
        g.validate_request(OrderRequest(symbol="600000", side=Side.BUY, price=7.5, quantity=150))


def test_guard_symbol_whitelist():
    g = _guard(allow_out_of_hours=True, allowed_symbols=["600xxx"])
    g.validate_request(OrderRequest(symbol="600000", side=Side.BUY, price=7.5, quantity=100))
    with pytest.raises(Exception):
        g.validate_request(OrderRequest(symbol="000001", side=Side.BUY, price=7.5, quantity=100))


def test_guard_amount_limit():
    g = _guard(allow_out_of_hours=True, max_order_amount=10_000)
    with pytest.raises(Exception) as exc:
        g.validate_request(OrderRequest(symbol="600000", side=Side.BUY, price=100.0, quantity=1000))
    assert "上限" in str(exc.value)
