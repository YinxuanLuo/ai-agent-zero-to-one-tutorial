// 第 00 章配套示例：演示 Agent 的两个核心概念
// 1) 模型是"无状态"的 —— 记忆由应用层拼回输入
// 2) 模型只能"表达想调工具的意愿"，真正干活的是代码
// 运行：node examples/00-设计哲学.mjs

// ---------- 概念一：无状态模型 ----------
// 一个"假模型"：它只做一件事——把收到的输入原样当作"记忆"处理。
// 注意：它内部没有任何跨调用的状态，完全靠传入的 messages。
function fakeModel(messages) {
  // 真实模型是概率性的，这里为了演示，我们返回一个确定性的"理解"。
  // 关键点：模型只看到 messages 里有什么，别的它一概不知。
  const last = messages[messages.length - 1];
  return `模型收到了 ${messages.length} 条消息，最后一条是："${last.content}"`;
}

const messages = [];

// 第 1 次调用：只有 1 条消息
messages.push({ role: 'user', content: '1+1 等于几？' });
console.log('[第1次调用]', fakeModel(messages));
// 输出：模型收到了 1 条消息，最后一条是："1+1 等于几？"

// 第 2 次调用：如果应用层不把历史拼回去，模型就"失忆"了
messages.push({ role: 'user', content: '那 2+2 呢？' });
console.log('[第2次调用·拼回历史]', fakeModel(messages));
// 输出：模型收到了 2 条消息…… ← 应用层把历史拼回来了，所以"记得"上一轮

// 对比：如果只传最后一条（应用层没拼历史），模型就完全不知道上一轮
console.log(
  '[第2次调用·不拼历史]',
  fakeModel([{ role: 'user', content: '那 2+2 呢？' }])
);
// 输出：模型收到了 1 条消息…… ← 模型"失忆"了，因为没人告诉它上一轮说了啥

// ---------- 概念二：模型只能"表达意愿"，代码才真正行动 ----------
console.log('\n---------- 工具调用演示 ----------');

// 一个"工具"：真正能查天气的代码（这里用假数据模拟）
function getWeather(city) {
  return `${city}：小雨，22℃`; // 真实场景这里会去请求天气 API
}

// 模型输出一段"它想调用工具"的文字（这就是它唯一能做的）
const modelWish = { tool: 'get_weather', args: { city: '北京' } };
console.log('[模型想做的]', JSON.stringify(modelWish));
// 输出：{"tool":"get_weather","args":{"city":"北京"}}

// 真正"动手"的是你的代码：解析模型的意愿，去执行工具
if (modelWish.tool === 'get_weather') {
  const result = getWeather(modelWish.args.city);
  console.log('[代码真正执行的结果]', result);
  // 输出：[代码真正执行的结果] 北京：小雨，22℃

  // 再把结果喂回给模型，让模型基于结果回答用户
  const finalAnswer = fakeModel([
    { role: 'user', content: '查北京天气' },
    { role: 'tool', content: result },
  ]);
  console.log('[模型基于结果回答]', finalAnswer);
}

console.log('\n✅ 两个核心概念演示完成：模型无状态、模型只表达意愿而代码执行。');
