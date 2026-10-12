// 第 01 章配套示例：最小可运行的 Agent Loop
// 完整演示四个零件如何协作：
//   大脑（llm 接口）→ 记忆（messages 数组）→ 工具（get_weather）→ 循环（for + 判断）
// 运行：node examples/01-最小Agent.mjs
// 退出码：0（本示例离线可跑，不依赖真实模型）

import { createWeatherMockLlm } from './llm-mock.mjs';

// ---------- 零件 3：工具（真正干活的代码） ----------
// 真实场景里这里会 fetch 天气 API，这里用写死的数据模拟。
// 注意：工具是一个普通函数，模型不能调用它，只有你的代码能调用。
const tools = {
  get_weather: ({ city }) => `${city}：小雨，22℃`,
};

// ---------- 零件 1：大脑（LLM） ----------
// createWeatherMockLlm 是一个"用规则模拟的模型"：
//   - 看到用户消息里带"天气" → 返回工具调用 get_weather
//   - 看到最后一条是 tool 消息 → 基于结果作答
// 接真实模型时，把这里换成一次 fetch 调用即可，循环代码一行不用改。
const llm = createWeatherMockLlm();

// ---------- 零件 2：记忆（messages 数组） ----------
// 所有跨轮次的状态都存在这个数组里，模型本身一个字都不记。
const messages = [
  { role: 'system', content: '你是天气助手。用户问天气时，先调用 get_weather 工具拿到结果再回答。' },
  { role: 'user', content: '帮我查一下北京天气，要是下雨提醒我带伞。' },
];

console.log('=== 初始记忆（2 条消息） ===');
for (const m of messages) {
  console.log(`  [${m.role}] ${m.content}`);
}

// ---------- 零件 4：循环 ----------
const MAX_TURNS = 10; // 防止死循环的硬上限

let callCount = 0; // 记录模型被调用了多少次（真实场景里这是烧钱的次数）

console.log('\n=== Agent Loop 开始 ===');

for (let turn = 0; turn < MAX_TURNS; turn++) {
  console.log(`\n--- 第 ${turn + 1} 轮 ---`);

  // 第 1 步：把整段记忆交给模型（模型只看得到这个数组，别的它一概不知）
  const response = await llm.invoke(messages);
  callCount += 1;
  console.log('[模型输出]', JSON.stringify(response));

  // 第 2 步：模型想"调工具"还是"直接回答"？
  if (response.toolCall) {
    const { name, args } = response.toolCall;

    // 记下模型的"意愿"（真实 API 里这一步是 assistant 消息 + tool_calls 数组）
    messages.push({
      role: 'assistant',
      content: `[决定调用工具 ${name}]`,
      toolCall: response.toolCall,
    });

    // 第 3 步：真正执行工具——动手的是你的代码，不是模型
    const result = tools[name] ? tools[name](args) : `未知工具：${name}`;
    console.log('[工具执行]', `get_weather(${JSON.stringify(args)}) -> ${result}`);

    // 第 4 步：把结果作为 tool 消息回填记忆，进入下一轮循环
    messages.push({ role: 'tool', content: result });
    continue;
  }

  // 模型给了最终文字 → 任务完成，跳出循环
  messages.push({ role: 'assistant', content: response.text });
  console.log('\n[最终回答]', response.text);
  break;
}

console.log('\n=== 循环结束 ===');
console.log('模型被调用了', callCount, '次');
console.log('记忆里最终有', messages.length, '条消息：');
for (const m of messages) {
  console.log(`  [${m.role}] ${m.content}`);
}
