// 第 05 章配套示例：ReAct 循环 —— 让模型交替「思考」和「调工具」
// 核心演示三件事：
//   1) 模型不是"一步出答案"，而是 Thought → Action → Observation 反复循环
//   2) 真正执行工具的是你的代码，模型只输出"我想调哪个工具"的文本
//   3) 循环有最大步数兜底，防止模型死循环
// 运行：node examples/05-多步推理.mjs

import { createMockLlm } from './llm-mock.mjs';

// ---------- 工具集：真正能"动手"的代码 ----------
// 注意：这里才是真正执行动作的地方，模型永远碰不到这些函数内部。
const tools = {
  get_weather({ city }) {
    // 真实场景这里会去请求天气 API；这里用确定性假数据保证离线可跑
    return `${city}：小雨，22℃`;
  },
  get_rain_probability({ city }) {
    return `${city} 未来 3 小时降水概率 80%`;
  },
};

// ---------- ReAct 的提示词：约定模型的"输出格式" ----------
// ReAct（Yao et al., 2022）的精髓：让模型用纯文本输出一套固定格式，
// 你的代码解析这套文本，决定下一步干什么。和 function calling 不同，
// 它不依赖任何厂商私有 API，任何一个能吐字的模型都能用。
const REACT_PROMPT = [
  '你是一个助手。回答用户问题前，请按下面格式一步一步来：',
  '',
  'Thought: 你当前在想什么、下一步要做什么',
  'Action: 要调用的工具名（可选，需要动手时才有）',
  'Action Input: 传给工具的 JSON 参数（可选）',
  'Observation: 工具返回的结果（由系统填，你不需要写）',
  '...（重复 Thought / Action，直到有足够信息）',
  'Final Answer: 最终给用户的回答',
  '',
  '可用工具：get_weather(city), get_rain_probability(city)',
  '规则：得到足够信息后，必须输出 Final Answer 结束。',
].join('\n');

// ---------- 解析 ReAct 文本 ----------
// 模型吐的是"自由文本"，代码要从中抠出结构化信息。
// 这里用正则解析，正是 ReAct 论文里的原始做法。
function parseReAct(text) {
  const thought = text.match(/Thought:\s*([\s\S]*?)(?=\n(?:Action|Final Answer):|$)/)?.[1]?.trim() ?? '';

  // 优先判断是否给出了最终答案
  const finalMatch = text.match(/Final Answer:\s*([\s\S]+)/);
  if (finalMatch) {
    return { type: 'final', thought, answer: finalMatch[1].trim() };
  }

  const actionMatch = text.match(/Action:\s*([A-Za-z_]\w*)/);
  const inputMatch = text.match(/Action Input:\s*(\{[\s\S]*\})/);
  if (actionMatch) {
    let input = {};
    if (inputMatch) {
      try {
        input = JSON.parse(inputMatch[1]);
      } catch {
        // 参数解析失败：保持空对象，让工具用默认值，不让循环崩掉
        input = {};
      }
    }
    return { type: 'action', thought, action: actionMatch[1], input };
  }

  return { type: 'unknown', thought };
}

// ---------- ReAct 主循环 ----------
// 这一步一步的循环，就是"agent loop"里最经典的一种：
// 调模型 → 解析意图 → 执行工具 → 把观察结果拼回消息 → 再调模型……
async function runReAct(question, script) {
  const llm = createMockLlm(script);
  const messages = [
    { role: 'system', content: REACT_PROMPT },
    { role: 'user', content: question },
  ];

  const MAX_STEPS = 5; // 兜底：最多循环 5 步，防止模型死循环烧钱

  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await llm.invoke(messages);
    const text = res.text ?? '';
    const parsed = parseReAct(text);

    console.log(`\n--- 第 ${step} 步 ---`);
    console.log(`[模型思考] ${parsed.thought}`);

    if (parsed.type === 'final') {
      console.log(`[最终答案] ${parsed.answer}`);
      console.log(`\n✅ 循环结束：共 ${step} 步，调用模型 ${llm.getCallCount()} 次。`);
      return parsed.answer;
    }

    if (parsed.type === 'action') {
      // 代码执行工具，得到 Observation
      const tool = tools[parsed.action];
      const observation = tool
        ? tool(parsed.input)
        : `未知工具：${parsed.action}`;

      console.log(`[调用工具] ${parsed.action}(${JSON.stringify(parsed.input)})`);
      console.log(`[观察结果] ${observation}`);

      // 关键：把「模型的发言」和「工具的观察」都拼回消息，
      // 这样下一轮模型才知道自己做过什么、结果如何。
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'tool', content: `Observation: ${observation}` });
      continue;
    }

    // 模型既没给 Final Answer 也没给 Action：格式坏了，直接兜底退出
    console.log('[兜底] 模型输出无法解析，强制结束循环');
    return '[兜底] 模型输出无法解析';
  }

  console.log(`[兜底] 达到最大步数 ${MAX_STEPS}，强制结束`);
  return '[兜底] 达到最大步数';
}

// ---------- 剧本：预置模型每一步的"发言" ----------
// 换真实 API 时，这些文本就是模型真实的概率输出，循环逻辑完全不变。
const script = [
  // 第 1 步：模型判断"需要查天气"
  {
    content:
      'Thought: 用户想知道北京的天气情况，我需要先调用天气工具获取数据。\n' +
      'Action: get_weather\n' +
      'Action Input: {"city": "北京"}',
  },
  // 第 2 步：看到"小雨"，模型还想确认降水概率
  {
    content:
      'Thought: 天气是小雨，但我还不确定下雨的可能性有多大，再查一下降水概率。\n' +
      'Action: get_rain_probability\n' +
      'Action Input: {"city": "北京"}',
  },
  // 第 3 步：拿到降水概率 80%，判断该提醒带伞，给出最终答案
  {
    content:
      'Thought: 降水概率 80%，超过 50%，很可能下雨，我应该提醒用户带伞。\n' +
      'Final Answer: 北京今天有小雨，降水概率 80%，出门记得带伞。',
  },
];

// 跑起来
console.log('用户问题：北京今天天气怎么样？下雨的话我要不要带伞？');
await runReAct('北京今天天气怎么样？下雨的话我要不要带伞？', script);
