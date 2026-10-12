// 第 02 章配套示例：提示词与消息结构
// 演示三件事：
//   1) 四种 role（system/user/assistant/tool）各自在什么时机出现、放什么内容
//   2) system prompt 如何改变模型行为
//   3) few-shot（给示例）如何约束输出格式
// 运行：node examples/02-提示词与消息.mjs
// 退出码：0

import { createMockLlm } from './llm-mock.mjs';

// ---------- Part 1：四种 role 的完整时序 ----------
console.log('=== Part 1: 四种 role 在什么时机出现 ===');

// 剧本式 mock：按调用顺序依次弹出 3 次响应
// 第 1 次：直接回答；第 2 次：想调工具；第 3 次：基于工具结果回答
const llm = createMockLlm([
  { content: 'Hello.' },
  { toolCall: { name: 'lookup', args: { word: '再见' } } },
  { content: 'Goodbye.' },
]);

const messages = [];

// system：整段对话的"规则"，只在最开始放一次
messages.push({ role: 'system', content: '你是翻译助手，必要时调用 lookup 工具查词。' });

// user：人的输入
messages.push({ role: 'user', content: '把"你好"翻译成英文。' });

// 第 1 次调用：模型直接回答
const r1 = await llm.invoke(messages);
messages.push({ role: 'assistant', content: r1.text });

// 用户继续问，触发工具调用
messages.push({ role: 'user', content: '那"再见"呢？' });
const r2 = await llm.invoke(messages); // 这次返回 toolCall
messages.push({ role: 'assistant', content: `[调用工具 ${r2.toolCall.name}]` });

// tool：工具执行的结果，由代码回填，不是模型说的
const toolResult = `lookup("再见") = Goodbye`;
messages.push({ role: 'tool', content: toolResult });

// 第 3 次调用：模型看到 tool 结果，给出最终回答
const r3 = await llm.invoke(messages);
messages.push({ role: 'assistant', content: r3.text });

// 打印完整结构，看清每条消息的角色
for (const m of messages) {
  console.log(`  [${m.role.padEnd(9)}] ${m.content}`);
}

// ---------- Part 2：system prompt 如何改变行为 ----------
console.log('\n=== Part 2: 有没有 system prompt，行为不一样 ===');

// 一个"读 system prompt 决定身份"的规则 mock
function createRoleMockLlm() {
  return {
    async invoke(msgs) {
      const system = msgs.find((m) => m.role === 'system');
      // 规则：system 里提到了"翻译"，就假装自己是翻译；否则装傻
      if (system && /翻译/.test(system.content)) {
        return { text: '译文：Hello.' };
      }
      return { text: '我不确定你想让我做什么，请补充指令。' };
    },
  };
}

const roleLlm = createRoleMockLlm();

console.log('[有 system prompt]',
  (await roleLlm.invoke([
    { role: 'system', content: '你是翻译助手，只输出译文，不解释。' },
    { role: 'user', content: '把"你好"翻译成英文。' },
  ])).text);

console.log('[无 system prompt]',
  (await roleLlm.invoke([
    { role: 'user', content: '把"你好"翻译成英文。' },
  ])).text);

// ---------- Part 3：few-shot 如何约束输出格式 ----------
console.log('\n=== Part 3: few-shot（给示例）如何约束输出格式 ===');

// 一个"看输入里有没有示例"决定输出格式的规则 mock
function createJsonMockLlm() {
  return {
    async invoke(msgs) {
      const joined = msgs.map((m) => m.content).join('\n');
      // 规则：输入里出现过 JSON 示例（含 "译文" 字段），就输出 JSON；否则输出自然语言
      if (/"译文"/.test(joined)) {
        return { text: '{"原句": "再见", "译文": "Goodbye"}' };
      }
      return { text: '好的，再见翻译成英文是 Goodbye。' };
    },
  };
}

const jsonLlm = createJsonMockLlm();

console.log('[无示例] 只说了"输出 JSON"');
console.log('  ->', (await jsonLlm.invoke([
  { role: 'system', content: '你是翻译助手，请输出 JSON。' },
  { role: 'user', content: '把"再见"翻译成英文，输出 JSON。' },
])).text);

console.log('[有示例] 先给了一组输入输出的 JSON 示范');
console.log('  ->', (await jsonLlm.invoke([
  { role: 'system', content: '你是翻译助手，输出 JSON，格式如下。' },
  { role: 'user', content: '把"你好"翻译成英文。' },
  { role: 'assistant', content: '{"原句": "你好", "译文": "Hello"}' },
  { role: 'user', content: '把"再见"翻译成英文。' },
])).text);

console.log('\n✅ 三种演示完成：四种 role、system prompt 的作用、few-shot 的效果。');
