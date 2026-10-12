// 第五关 · 第 1 题参考答案：最小 Agent 循环
// 验收点：
//   1) 循环最多 maxIterations（默认 10）次，超限强制停止并返回兜底话术
//   2) 模型返回 toolCall → 执行工具 → 以 role:'tool' 回填 → continue
//   3) 模型返回 text → 返回这段文字并结束
//   4) 模型要调不存在的工具 → 不崩，返回"未知工具"信息喂回
// 运行：node examples/answers/01-最小Agent循环.mjs（退出码 0）

import { createMockLlm } from '../llm-mock.mjs';

// 工具表：真正干活的代码。模型永远碰不到这些函数，只能"点菜"。
const tools = {
  get_weather: ({ city }) => `${city}：小雨，22℃`,
};

// 核心循环：把记忆交给模型 → 判断文字/工具调用 → 执行回填 → 继续或结束。
// 为什么工具结果必须 push 成 role:'tool'？因为模型无状态，
// 它记得的一切都是你每次重新塞给它的数组（第 00/01 章的核心结论）。
async function runAgent(llm, messages, { maxIterations = 10 } = {}) {
  for (let steps = 0; steps < maxIterations; steps++) {
    const r = await llm.invoke(messages);

    // 模型给了文字回答 → 正常出口
    if (!r.toolCall) {
      return r.text;
    }

    // 模型想调工具 → 执行。关键：先查工具是否存在，防幻觉编出未知工具
    const fn = tools[r.toolCall.name];
    const result = fn
      ? fn(r.toolCall.args)
      : `未知工具：${r.toolCall.name}，可用工具：${Object.keys(tools).join(', ')}`;

    // 关键：结果必须回填，否则下一轮模型"看不见"工具干了什么
    messages.push({ role: 'tool', content: result });
  }

  // 走到这里 = 达到最大步数还没得到最终回答，是"异常终止"
  return `超过最大步数 ${maxIterations}，强制停止`;
}

// ---- 验证：用 mock LLM 依次返回「toolCall → text」 ----
const llm = createMockLlm([
  { toolCall: { name: 'get_weather', args: { city: '北京' } } }, // 第 1 轮：想调工具
  { content: '北京今天有小雨，22℃，出门记得带伞。' },           // 第 2 轮：最终回答
]);

const messages = [
  { role: 'system', content: '你是天气助手，问天气先调 get_weather 工具。' },
  { role: 'user', content: '帮我查一下北京天气。' },
];

const answer = await runAgent(llm, messages);
console.log('最终回答：', answer);
console.log('messages 条数：', messages.length); // 3 条：system/user/tool（本示例未 push assistant 发言）
console.log('最后一条消息：', JSON.stringify(messages[messages.length - 1]));

// ---- 验证：未知工具不崩 ----
const llm2 = createMockLlm([
  { toolCall: { name: 'get_stock', args: {} } },  // 幻觉编的工具
  { content: '好的。' },
]);
const messages2 = [{ role: 'user', content: '查股票' }];
const answer2 = await runAgent(llm2, messages2);
console.log('\n未知工具场景：', answer2);
console.log('喂回给模型的内容：', messages2[1].content);

// ---- 验证：死循环被最大步数兜底 ----
const llm3 = createMockLlm(
  Array.from({ length: 100 }, () => ({ toolCall: { name: 'get_weather', args: { city: '北京' } } }))
);
const messages3 = [{ role: 'user', content: '天气' }];
const answer3 = await runAgent(llm3, messages3, { maxIterations: 3 });
console.log('\n死循环场景：', answer3);
