// 第 03 章配套示例：一个完整可运行的工具调用（function calling）循环
// 演示四件事：
//   1) 模型输出 tool_call → 代码解析参数 → 执行工具 → 把结果以 role:tool 喂回
//   2) 工具描述（schema）长什么样、为什么重要
//   3) 参数校验：模型传了错类型，工具拒绝执行
//   4) 工具执行出错（除零），把错误喂回给模型，让它自我修正
// 运行：node examples/03-工具调用.mjs
// 依赖：./llm-mock.mjs（可插拔 mock，零第三方依赖）

import { createMockLlm } from './llm-mock.mjs';

// ---------- 1. 定义工具（schema + 实现放一起） ----------
// 每个工具有两个部分：
//   - description / parameters：给模型看的"说明书"，模型靠它理解这个工具能干嘛
//   - execute：真正干活的代码，模型永远碰不到，只有你的代码能调
const tools = {
  calculator: {
    description:
      '计算一个数学表达式，支持 + - * / 和括号。' +
      '入参 expression 必须是字符串，例如 "1 + 2 * 3"。返回数值结果。',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '要计算的算术表达式，例如 "1 + 2 * 3"',
        },
      },
      required: ['expression'],
    },
    execute(args) {
      return safeCalculate(args.expression);
    },
  },
};

// 受限版 eval：先做白名单校验，只放行数字和算术字符，再交给 Function 计算。
// 真实场景里你可能接一个更专业的表达式引擎，但这里展示"边界校验"的思路。
function safeCalculate(expression) {
  // 校验 1：类型必须是字符串（模型可能传数字、对象、null）
  if (typeof expression !== 'string') {
    throw new TypeError(
      `参数 expression 必须是字符串，但收到 ${typeof expression}`
    );
  }
  // 校验 2：白名单，只允许数字、四则运算、括号、小数点、空白
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
    throw new Error(
      `表达式包含非法字符："${expression}"，只允许数字和 + - * / ( )`
    );
  }
  // 校验 3：禁止注释符号，防止把 "//" 或 "/*" 注入进 eval
  if (/\/\/|\/\*|\*\//.test(expression)) {
    throw new Error(`表达式包含注释符号："${expression}"`);
  }
  // 校验 4：至少有一个数字，否则是空表达式
  if (!/[0-9]/.test(expression)) {
    throw new Error(`表达式里没有数字："${expression}"`);
  }
  // 已通过白名单，这里只用算术字符构造函数，是"受限的 eval"
  const value = Function('"use strict"; return (' + expression + ')')();
  // 校验 5：结果必须是有限数（除零会得到 Infinity 或 NaN）
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`计算失败：${expression} = ${value}（可能是除零）`);
  }
  return value;
}

// ---------- 2. 执行单个工具，并把"错误"转成可喂回模型的结果 ----------
// 关键设计：工具报错不直接 throw 让程序崩掉，而是把错误信息（带错误名）
// 塞进 role:tool 的 content 里喂回模型，让模型有机会自我修正。
function runTool(name, args) {
  const tool = tools[name];
  if (!tool) {
    return { ok: false, content: `未知工具：${name}，可用工具：${Object.keys(tools).join(', ')}` };
  }
  try {
    const value = tool.execute(args);
    return { ok: true, content: JSON.stringify(value) };
  } catch (err) {
    return { ok: false, content: `${err.name}: ${err.message}` };
  }
}

// ---------- 3. agent loop：模型"想"一步，代码"动"一步 ----------
async function runAgent(llm, userInput) {
  const messages = [
    { role: 'system', content: '你是助手，会用 calculator 工具来回答数学问题。' },
    { role: 'user', content: userInput },
  ];

  let toolCallCount = 0;
  let errorCount = 0;
  const maxIterations = 10; // 防止死循环的兜底

  for (let i = 0; i < maxIterations; i++) {
    const reply = await llm.invoke(messages);

    // 情况 A：模型想调用工具
    if (reply.toolCall) {
      const { name, args } = reply.toolCall;
      toolCallCount += 1;
      console.log(`[第${i + 1}轮] 模型想调用工具: ${name} ${JSON.stringify(args)}`);

      // 记录 assistant 的 tool_call（真实 API 里这一步也要写进 messages，
      // 字段名叫 tool_calls，且带一个 tool_call_id，这里 mock 做了简化）
      messages.push({ role: 'assistant', content: null, toolCall: reply.toolCall });

      // 真正干活的是你的代码
      const result = runTool(name, args);
      if (!result.ok) errorCount += 1;
      console.log(`          ${result.ok ? '执行结果' : '执行出错'}: ${result.content}`);

      // 把结果（或错误）以 role:tool 喂回给模型
      messages.push({ role: 'tool', content: result.content });
      continue; // 回到循环顶部，再问一次模型
    }

    // 情况 B：模型给了最终文字答案 → 结束
    console.log(`[第${i + 1}轮] 模型最终回答: ${reply.text}`);
    return { messages, toolCallCount, errorCount, iterations: i + 1 };
  }

  throw new Error(`达到最大循环次数 ${maxIterations}，强制停止`);
}

// ---------- 4. 用"剧本"驱动 mock，演示完整流程 ----------
// 剧本按调用顺序依次弹出：正常调用 → 错类型 → 除零 → 修正 → 最终回答。
const llm = createMockLlm([
  { toolCall: { name: 'calculator', args: { expression: '1 + 2 * 3' } } },
  { toolCall: { name: 'calculator', args: { expression: 12345 } } },
  { toolCall: { name: 'calculator', args: { expression: '100 / 0' } } },
  { toolCall: { name: 'calculator', args: { expression: '100 / 4' } } },
  { content: '1 + 2 * 3 = 7，100 / 4 = 25。' },
]);

console.log('=== 工具调用循环开始 ===');
const stat = await runAgent(llm, '帮我算 1 + 2 * 3 和 100 / 4');
console.log('=== 循环结束 ===');
console.log(`共调用模型 ${stat.iterations} 次，调用工具 ${stat.toolCallCount} 次，其中 ${stat.errorCount} 次出错被喂回修正。`);

// ---------- 附：接真实 API 时的格式对照（本示例不执行，仅作对照） ----------
// mock 用的简化格式：
//   { role: 'assistant', toolCall: { name, args } }
//   { role: 'tool', content: '...' }
// OpenAI 真实 function calling 的格式长这样：
//   messages.push({ role: 'assistant', content: null, tool_calls: [
//     { id: 'call_abc123', type: 'function',
//       function: { name: 'calculator', arguments: JSON.stringify({ expression: '1+2' }) } }
//   ]});
//   messages.push({ role: 'tool', tool_call_id: 'call_abc123', content: '7' });
// 差异就两点：字段名 toolCall → tool_calls（数组）、arguments 是 JSON 字符串、
// tool 消息要带 tool_call_id 跟 assistant 的 tool_call 对上。
// 换成真实模型时，只需把 createMockLlm 换成一次 fetch：
//   const resp = await fetch('https://api.openai.com/v1/chat/completions', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
//     body: JSON.stringify({ model: 'gpt-4o', messages, tools: buildOpenAiTools(tools) }),
//   });
//   const data = await resp.json();
//   // data.choices[0].message.tool_calls 就是模型想调用的工具

console.log('\n✅ 工具调用循环演示完成：正常调用、参数校验、错误喂回、自我修正都跑通了。');
