// ============================================================
// 接口层：LLM 抽象
// 职责：定义「调用模型」的接口，让上层（agent 核心层）不关心底层
//       到底是 mock 还是真实 API。换模型 = 换这里的实现，调用方不改。
// 依赖：../llm-mock.mjs（本教程的统一可插拔 mock 接口）。
// ============================================================

import { createMockLlm } from '../llm-mock.mjs';

// 本教程约定的 LLM 接口形状（interface）：
//   {
//     invoke(messages) => Promise<{ text } | { toolCall: { name, args } }>
//     getCallCount()  => number   // 统计调用了多少次模型（计费用）
//   }
// 上层 agent 只依赖这个形状，不依赖具体实现。

// 默认实现：走 mock。传入一个「剧本」数组，模型按顺序返回剧本内容。
// 剧本里每条是 { content: '文字回答' } 或 { toolCall: { name, args } }。
export function createLlm(script = []) {
  return createMockLlm(script);
}

// 真实实现（对照用，离线跑不通，仅作注释）：
// 把 mock 换成一次 fetch，接口形状完全一致，上层代码一行不用改。
//
// export function createLlm({ apiKey, model = 'gpt-4o' }) {
//   return {
//     async invoke(messages) {
//       const resp = await fetch('https://api.openai.com/v1/chat/completions', {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           Authorization: `Bearer ${apiKey}`,
//         },
//         body: JSON.stringify({ model, messages, tools: buildOpenAiTools(tools) }),
//       });
//       const data = await resp.json();
//       const msg = data.choices[0].message;
//       // 关键差异：真实 API 的 tool_calls 是数组、arguments 是 JSON 字符串，
//       // 这里要转换成我们约定的 { toolCall: { name, args } } 形状。
//       if (msg.tool_calls?.length) {
//         const fn = msg.tool_calls[0].function;
//         return { toolCall: { name: fn.name, args: JSON.parse(fn.arguments) } };
//       }
//       return { text: msg.content };
//     },
//   };
// }
