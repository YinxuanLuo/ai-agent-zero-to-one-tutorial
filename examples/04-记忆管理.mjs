// 第 04 章配套示例：跟上下文窗口抢空间 —— 三种记忆策略对比
// 演示：
//   1) 什么是 token、怎么粗略估算（中文 1 字 ≈ 1 token，其余约 4 字符 ≈ 1 token）
//   2) 上下文窗口是硬上限，全量塞入会"爆"
//   3) 三种省空间的策略：全量 / 滑动窗口 / 摘要，各自的 token 数和代价
// 运行：node examples/04-记忆管理.mjs
// 依赖：./llm-mock.mjs（摘要用 mock LLM，零第三方依赖）

import { createMockLlm } from './llm-mock.mjs';

// 教学用的上下文窗口大小（真实模型有大有小：几 k 到几百万 token，机制相同）
const CONTEXT_WINDOW = 512;

// ---------- 1. token 估算（教学用粗略版，非精确 tokenizer） ----------
// 真实 token 数要用模型官方的 tokenizer（如 OpenAI 的 tiktoken）逐 token 切分，
// 这里用"中文 1 字 ≈ 1 token、其余约 4 字符 ≈ 1 token"的量级估算，够教学用。
function estimateTokens(text) {
  const cjk = (text.match(/[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk + other / 4);
}

// 统计一组消息的总 token（每条消息的 role + content 都算进输入）
function totalTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.role + ': ' + (m.content ?? '')), 0);
}

// ---------- 2. 造一段"订机票"的长对话（模拟 agent 的多轮历史） ----------
function buildLongConversation() {
  return [
    { role: 'system', content: '你是机票预订助手，帮用户订票、改签、选座、办行李。' },
    { role: 'user', content: '帮我订一张周五从北京到上海的机票，上午出发。' },
    { role: 'assistant', content: '周五上午北京到上海有 CA1858（08:00 起飞，10:15 到虹桥），经济舱 980 元，余票 6 张。' },
    { role: 'user', content: '就它了，要一个靠窗的位置。' },
    { role: 'assistant', content: '已为你锁定 CA1858 靠窗座位 12A。请问需要托运行李吗？' },
    { role: 'user', content: '有一件 20 公斤的托运行李。' },
    { role: 'assistant', content: 'CA1858 经济舱含 20 公斤免费托运，你的行李在额度内，不需要额外付费。' },
    { role: 'user', content: '好的，用身份证订。' },
    { role: 'assistant', content: '请提供乘机人身份证号和姓名，用于实名出票。' },
    { role: 'user', content: '张三，身份证 110101199001011234。' },
    { role: 'assistant', content: '已录入乘机人张三，身份证号尾号 1234。是否需要购买航意险？' },
    { role: 'user', content: '买一份 30 元的航意险吧。' },
    { role: 'assistant', content: '已添加航意险 30 元，总价 1010 元。是否现在支付？' },
    { role: 'user', content: '等等，我改成周六同一班。' },
    { role: 'assistant', content: '周六 CA1858 同样有时刻，改签手续费 100 元，需要重新确认靠窗座位。' },
    { role: 'user', content: '改，座位继续要靠窗。' },
    { role: 'assistant', content: '已提交改签申请，周六 CA1858 靠窗座位 12A 暂锁，请在 15 分钟内支付差价 100 元。' },
    { role: 'user', content: '对了，我有会员积分，能抵扣吗？' },
    { role: 'assistant', content: '检测到你有 800 积分，可抵扣 40 元。是否需要使用积分抵扣？' },
    { role: 'user', content: '用掉吧。' },
    { role: 'assistant', content: '已使用 800 积分抵扣 40 元，最终待支付 60 元。' },
    { role: 'user', content: '用微信支付。' },
    { role: 'assistant', content: '已生成微信支付二维码，请在 15 分钟内完成支付 60 元，超时订单自动取消。' },
    { role: 'user', content: '支付好了。' },
    { role: 'assistant', content: '支付成功，出票中。是否需要开具电子发票？' },
    { role: 'user', content: '要，抬头写个人，开给张三。' },
    { role: 'assistant', content: '发票将在行程结束后 7 个工作日内发到你手机。出票成功：周六 CA1858 08:00 北京-上海，靠窗 12A，张三。' },
  ];
}

// ---------- 3. 三种记忆策略 ----------

// 策略一：全量塞入 —— 什么都不做，把历史一条不落全发给模型
function strategyAll(messages) {
  return { label: '① 全量塞入（不做任何处理）', messages };
}

// 策略二：滑动窗口 —— 永远保留 system + 最近 N 条，早期的直接丢弃
function strategySlidingWindow(messages, keepLast) {
  const system = messages[0];
  const tail = messages.slice(-keepLast);
  return { label: `② 滑动窗口（保留 system + 最近 ${keepLast} 条）`, messages: [system, ...tail] };
}

// 策略三：摘要 —— 把早期历史压缩成一段 summary，再拼上最近 N 条
async function strategySummary(messages, llm, keepLast) {
  const head = messages.slice(0, messages.length - keepLast); // 要被压缩的前段
  const tail = messages.slice(-keepLast); // 保留的最近 N 条
  const headText = head.map((m) => `${m.role}: ${m.content}`).join('\n');
  // 用 mock LLM 把前段历史"读一遍"生成摘要（真实场景这一下也要花 token）
  const summaryReply = await llm.invoke([{ role: 'user', content: `请把下面这段对话压缩成一段不超过 60 字的摘要：\n${headText}` }]);
  const summaryMsg = { role: 'assistant', content: `[历史摘要] ${summaryReply.text}` };
  return {
    label: `③ 摘要（前段压成摘要 + 保留最近 ${keepLast} 条）`,
    messages: [messages[0], summaryMsg, ...tail],
  };
}

// ---------- 4. 主流程：跑三种策略，对比 token 数和代价 ----------
const messages = buildLongConversation();
const summaryLlm = createMockLlm([
  {
    content:
      '用户订周五北京飞上海 CA1858，靠窗 12A，乘客张三（身份证尾号1234），20kg 托运，买 30 元航意险；后改签周六同班次继续靠窗，用 800 积分抵扣 40 元。',
  },
]);

// 摘要只算一次，后面复用同一份结果（避免重复调用 mock 导致剧本耗尽）
const summaryResult = await strategySummary(messages, summaryLlm, 6);
const strategies = [
  strategyAll(messages),
  strategySlidingWindow(messages, 6),
  summaryResult,
];

console.log(`假设上下文窗口 = ${CONTEXT_WINDOW} token（教学值）`);
console.log(`原始对话共 ${messages.length} 条消息。三种策略对比：\n`);

for (const s of strategies) {
  const tokens = totalTokens(s.messages);
  const over = tokens > CONTEXT_WINDOW;
  const status = over ? `爆了（超出 ${tokens - CONTEXT_WINDOW} token）` : '没爆';
  console.log(`${s.label}`);
  console.log(`  → 条数 ${s.messages.length}，估算 ${tokens} token → ${status}\n`);
}

// 展示"滑动窗口"到底丢了什么
console.log('--- 代价演示：滑动窗口丢掉了什么 ---');
const sw = strategySlidingWindow(messages, 6);
console.log(`滑动窗口丢弃了 ${messages.length - sw.messages.length} 条早期消息。`);
console.log('被丢弃的消息里有身份证号、座位号等关键信息。如果下一步要出票，');
console.log('模型只能靠最近的 6 条去猜，这就是"早期信息丢失"的代价。\n');

// 展示"摘要"保留了关键信息
console.log('--- 代价演示：摘要保留了关键信息 ---');
console.log(`摘要消息内容：${summaryResult.messages[1].content}\n`);

console.log('✅ 三种记忆策略对比演示完成：全量会爆、滑动窗口省但丢早期、摘要折中。');
