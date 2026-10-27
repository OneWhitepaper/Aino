export const zhSharedMetrics = {
  consentTitle: '分享使用统计？',
  dialogTitle: '使用统计',
  consentBody:
    'Aino 可以统计你的使用情况：会话时长、运行了哪些模型和工具，以及何时出错。它绝不会记录你的消息、文件、路径或错误文本。',
  whatIsCollected: '统计哪些内容',
  collectedActivity: '会话：时长、结果、错误类型、每天的活跃时间',
  collectedModels: '模型：使用了哪些模型、token 总量',
  collectedNames: '功能：使用或关闭的内置工具、命令、应用区域和设置',
  collectedMilestones: '设置：完成了哪些步骤、提供商连接，以及技能、插件和任务的数量',
  collectedReliability: '应用状况：崩溃、启动与回复速度、更新、消息平台连接',
  collectedUsage: '代理质量：未成功的编辑、出错的工具调用、卡住的循环、每个任务的成本',
  collectedMachine: '机器：操作系统、内存范围、GPU 类型、Aino 版本、本地模型使用情况',
  sending:
    '如果你选择分享，Aino 每天将汇总计数发送到 api.agentera.com.cn，附带此配置的随机 ID，不附带账号令牌。Aino 管理员可以读取。14 天后停止访问，随后 1 小时内清除在线数据；备份按部署保留策略清理。除同意后计入的一次安装记录外，不发送本次同意之前的数据。你可以随时在设置中关闭。',
  readDocs: '查看完整说明',
  share: '分享给 Aino',
  off: '不用了',
  saveFailed: '无法保存你的选择',
  sendLabel: '与 Aino 分享使用统计',
  sendDesc: '仅包含计数，每天发送一次，并附带此配置文件的随机 ID。绝不包含你的消息、文件、路径或错误文本。',
  unavailable: '请更新 Aino 后端以更改此设置。',
  stripBody: '仅包含计数，绝不包含你的消息或文件。',
  stripReaskBody: '统计接收方已变更为 Aino。之前的选择不代表同意向 Aino 分享，请重新选择。',
  stripChoices: { share: '分享给 Aino', off: '不用了' },
  stripDetails: '详情'
}
