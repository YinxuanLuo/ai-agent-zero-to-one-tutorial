// 共享的可插拔 LLM 接口（mock 实现）
// 本教程所有示例的 LLM 调用都走这个接口，保证：
// 1) 离线可跑、退出码 0（默认用 mock，不需要真实 API）
// 2) 接真实模型时只需替换实现，调用方代码不用改
// 用法：import { createMockLlm } from './llm-mock.mjs'

// 消息对象结构（本教程统一约定）
// { role: 'system' | 'user' | 'assistant' | 'tool', content: string }

// 创建一个 mock LLM：根据预置的"剧本"依次返回响应。
// @param {Array<{content?: string, toolCall?: {name: string, args: object}}>} script
//   预置的响应序列，按调用顺序依次弹出。
// @returns {{ invoke(messages) => Promise<object> }} 一个 llm 接口对象
export function createMockLlm(script = []) {
  const queue = [...script];
  let callCount = 0;

  return {
    // 调用模型：返回 { text } 或 { toolCall }
    async invoke(messages) {
      callCount += 1;
      const next = queue.shift();
      if (!next) {
        // 剧本用完了，给一个兜底响应
        return { text: '[mock] 剧本耗尽，无更多响应' };
      }
      if (next.toolCall) {
        return { toolCall: next.toolCall };
      }
      return { text: next.content ?? '' };
    },
    getCallCount() {
      return callCount;
    },
  };
}

// 一个"会判断天气"的 mock：看到用户问天气就返回工具调用，否则返回文字。
// 用简单规则模拟"模型决策"，方便示例演示完整循环。
export function createWeatherMockLlm() {
  return {
    async invoke(messages) {
      const last = messages[messages.length - 1];
      const text = (last?.content ?? '').toString();

      // 规则 1：如果最后一条是 tool 消息（工具刚返回结果），就基于结果作答
      if (last?.role === 'tool') {
        return { text: `根据查询结果：${text}。提醒你出门带伞。` };
      }
      // 规则 2：用户问题里带"天气"，就调用天气工具
      if (/天气/.test(text)) {
        return { toolCall: { name: 'get_weather', args: { city: extractCity(text) } } };
      }
      // 规则 3：其它情况直接回答
      return { text: `收到，你说的是："${text}"` };
    },
  };
}

// 从文本里抠一个城市名（超简化演示，别当真）
function extractCity(text) {
  const m = text.match(/(北京|上海|广州|深圳|杭州|成都)/);
  return m ? m[1] : '北京';
}
