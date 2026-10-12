// 第五关 · 第 4 题参考答案：记忆管理
// 验收点：
//   1) estimateTokens：中文 1 字约 1 token，其余约 4 字符 1 token
//   2) strategySlidingWindow：保留 system + 最近 keepLast 条
//   3) strategySummary：早期消息压成摘要 + 最近 keepLast 条
// 运行：node examples/answers/04-记忆管理.mjs（退出码 0）

import { createMockLlm } from '../llm-mock.mjs';

// token 粗算：中文 1 字 ≈ 1 token，其余约 4 字符 ≈ 1 token。
// 这只是"量级估算"，用于预估成本；精确裁剪必须用官方 tokenizer。
function estimateTokens(text) {
  const cjk = (text.match(/[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk + other / 4);
}

function totalTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.role + ': ' + (m.content ?? '')), 0);
}

// 策略二：滑动窗口。只留 system + 最近 keepLast 条，更早的直接丢弃。
// system 必须单独保留——它是行为约束，被裁掉模型就跑偏。
function strategySlidingWindow(messages, keepLast) {
  const system = messages[0];
  const tail = messages.slice(-keepLast);
  return [system, ...tail];
}

// 策略三：摘要。把早期历史压成一段摘要，再拼上最近 keepLast 条。
// 代价：多一次模型调用 + 有幻觉/丢细节风险。
async function strategySummary(messages, llm, keepLast) {
  const system = messages[0];
  const head = messages.slice(1, messages.length - keepLast);
  const tail = messages.slice(-keepLast);
  const headText = head.map((m) => `${m.role}: ${m.content}`).join('\n');
  const summaryReply = await llm.invoke([
    { role: 'user', content: `把这段对话压缩成不超过 60 字的摘要：\n${headText}` },
  ]);
  return [system, { role: 'assistant', content: `[历史摘要] ${summaryReply.text}` }, ...tail];
}

// ---- 构造 10 条消息做演示 ----
const ten = [
  { role: 'system', content: '你是订票助手' },
  { role: 'user', content: '查北京到上海的航班' },
  { role: 'assistant', content: '有 CA1858，08:00 起飞' },
  { role: 'user', content: '乘客身份证号 110101199001011234' },
  { role: 'assistant', content: '好的，已记录' },
  { role: 'user', content: '靠窗座位' },
  { role: 'assistant', content: '已为你锁定靠窗' },
  { role: 'user', content: '需要积分抵扣' },
  { role: 'assistant', content: '可用 5000 积分抵扣 50 元' },
  { role: 'user', content: '确认出票' },
];

console.log(`原始：${ten.length} 条，估算 ${totalTokens(ten)} token`);

// 滑动窗口：留 system + 最近 3 条
const sw = strategySlidingWindow(ten, 3);
console.log(`滑动窗口 keepLast=3：${sw.length} 条，估算 ${totalTokens(sw)} token`);
console.log('  保留的 role：', sw.map((m) => m.role).join('-'));

// 摘要：前段压成摘要 + 最近 3 条。mock 返回一个固定的摘要文本。
const summaryLlm = createMockLlm([
  { content: '用户订北京到上海机票，已记录身份证，选靠窗，用积分抵扣 50 元，待确认出票' },
]);
const sm = await strategySummary(ten, summaryLlm, 3);
console.log(`摘要 keepLast=3：${sm.length} 条，估算 ${totalTokens(sm)} token`);
console.log('  结构：', sm.map((m) => m.role).join('-'));
console.log('  摘要内容：', sm[1].content);
