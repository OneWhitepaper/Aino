记号：CC=`agent/context_compressor.py`；CD=`agent/compaction_display.py`；DT=`tools/delegate_tool.py`；DC=`tools/delegate_tool_config.py`；MS=`tui_gateway/model_switch.py`；SH=`tui_gateway/session_history.py`。

### ① 摘要触发、失败恢复、显示状态

确定：回滚漏字段：CC:4705-4710 保存 `previous_summary` 与 user provenance，4724-4735 会改后者；但 4844-4872 只恢复前者。触发：handoff 扫描后摘要失败进入 abort；后续摘要复用残留 provenance。普通 `None` 走 fallback，终止/配置 abort 保留消息[4844-4855,5131-5145]。显示分叉：CC:4518-4552 生成独立 replay user 行；CD:65-72 隐藏，CC:5250-5271 却返回 user view。  
疑点：CC:2774-2779 有阈值门禁，5046-5099 不复核；3622-3640 准备步骤在 `try` 外，取消仅按 `Exception` 捕获[3611-3613,3668-3669]；调用方/异常继承未证。

### ② 任务取消、并发上限、模型继承

确定风险：DC:93-108 对 `max_concurrent_children` 仅设下限 1、无上限；大于 10 只告警，121-132 忽略 legacy `max_async_children`。DC:61-77 未捕获 `OverflowError`；若配置值为 `float('inf')`，DC:93-102 的 `int()` 可逸出，有限浮点还会截断。继承构造在快照内一致：DT:503-535 取值并建批；DC:488-539 使用 `model` 或 `parent.model`，provider 改变则重导 `api_mode`，590-595 组装 AIAgent。  
疑点：stop 走外部控制器[DT:457-459]；先 attach[288-291]、worker 才 register[326-330]，队列 stop/完成竞态及实际 worker 上限未证。

### ③ 模型切换与历史恢复

确定：切换提交非事务：MS:231-272 在 `switch_model` 后才重启、持久化、写 marker、通知，one-turn restore 还最后写；MS:323-348 任一步失败都可能留下已切换的 live agent。MS:416-458 先写 `config_model_seen` 再切换；同一 session 的失败目标不会重复尝试。全图像路径无效且文本为空时，SH:24-42 对模型返回默认提问，45-65 持久化却为空。  
疑点：MS:15-50 快照不含 `capabilities`，fallback 传 `None`，影响依赖外部 `switch_model`；SH:287-358 无 turn id，clear/新 turn 后的迟到回调可能碰新 turn，顺序未证。

### 最值得优先验证的 Top 3

1. **模型切换的部分失败回滚**（MS:231-348）：最容易造成 live agent、session、配置和历史互相不一致。  
2. **摘要 abort 的 provenance 回滚**（CC:4705-72,4844-72）：一次失败尝试可能污染后续摘要对“是否存在真实用户输入”的判断。  
3. **委派 stop 与并发 admission 竞态**（DT:457-459,288-330；DC:93-108）：需验证排队任务能否取消、完成竞态是否幂等，以及无硬上限是否会导致负载和成本失控。

仅读取了指定六个文件；未联网、未修改文件、未安装依赖或运行外部测试。