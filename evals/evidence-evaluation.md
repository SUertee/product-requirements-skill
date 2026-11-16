# Evidence 评估

## 确定性检查

- Evidence ID 唯一，Source 与 Segment 真实存在。
- `original_quote` 是对应 Segment `original_text` 的连续子串，不允许润色后冒充原话。
- Evidence 时间与 Segment 完全一致，结束不早于开始。
- 仅 E1/E2/E3/E0 合法；推断内容不得标 E1。
- 每条 REQ 至少关联一条真实 Evidence。

## Agent 语义检查

- E1 是否确实为客户明确表达，而非模型补充。
- E2 是否保留推断属性，E3 是否明确为建议。
- 冲突和模糊表达是否降为 E0 并进入待确认。
- 多角色观点是否并列保留，未擅自合并成一致决定。

固定样例运行：`python scripts/validate_evidence.py --project examples/output/demo`。
