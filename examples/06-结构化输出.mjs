// 第 06 章配套示例：结构化输出 —— 让模型输出能被代码消费的 JSON
// 核心演示四件事：
//   1) 模型输出的是"自由文本"，常常带 ```json 包裹、尾逗号、中文引号等脏东西
//   2) 一个健壮解析器：剥代码块 → 修脏 JSON → JSON.parse → 校验必填字段
//   3) JSON 的转义陷阱：字符串里的双引号必须写成 \"
//   4) 缺失字段怎么处理：给默认值还是报错，取决于你的业务
// 运行：node examples/06-结构化输出.mjs

import { createMockLlm } from './llm-mock.mjs';

// ---------- 第一步：剥掉 markdown 代码块 ----------
// 模型经常把 JSON 包在 ```json ... ``` 里（因为它以为你在聊天框里看）。
// 代码要先把这层壳剥掉。
function extractJsonBlock(text) {
  // 优先匹配 ```json ... ``` 或 ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // 没有代码块：找第一个 { 到最后一个 } 之间的内容
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.slice(start, end + 1).trim();

  return text.trim();
}

// ---------- 第二步：修复常见的脏 JSON ----------
// 这些都是模型真实会犯的错，逐个修。每个修复都标注了"为什么安全/不安全"。
function repairJson(text) {
  let s = text;

  // 1) 去尾逗号：{... ,} 和 [... ,] 是非法 JSON，但模型极爱写
  s = s.replace(/,\s*([}\]])/g, '$1');

  // 2) 中文引号当定界符：模型偶尔用 “ ” 代替 " 来包 key/value
  //    注意：这会把字符串内部的中文引号也一起替换掉，属于"有损修复"，
  //    所以只在 JSON.parse 失败后才调用本函数，而不是无脑预处理。
  s = s.replace(/[\u201C\u201D]/g, '"');

  return s;
}

// ---------- 第三步：校验必填字段 ----------
// JSON.parse 只能保证"是合法 JSON"，不能保证"是我要的那个 JSON"。
// 这一步检查模型有没有把关键字段吐全。
function validateFields(obj, required) {
  const missing = required.filter((k) => obj[k] === undefined || obj[k] === null);
  if (missing.length > 0) {
    return { ok: false, error: `缺失字段：${missing.join(', ')}` };
  }
  return { ok: true };
}

// ---------- 组合成一个健壮解析器 ----------
// 三步串起来：剥壳 → 修复 → 解析 → 校验。
// 每一步失败都返回结构化错误，而不是直接 throw，让调用方能优雅降级。
function parseJsonOutput(text, { required = [], defaults = {} } = {}) {
  const cleaned = extractJsonBlock(text);
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    // 第一次解析失败：尝试修复脏 JSON 再试一次
    try {
      data = JSON.parse(repairJson(cleaned));
    } catch (e2) {
      return {
        ok: false,
        error: `JSON 解析失败：${e2.message}`,
        cleaned,
      };
    }
  }

  // 补默认值（模型没给但业务允许缺省的字段）
  for (const [k, v] of Object.entries(defaults)) {
    if (data[k] === undefined) data[k] = v;
  }

  const check = validateFields(data, required);
  if (!check.ok) {
    return { ok: false, error: check.error, data };
  }
  return { ok: true, data };
}

// ---------- 演示：让"模型"吐出 6 种真实会遇到的输出 ----------
// 换真实 API 时，这些就是模型真实的概率输出，解析逻辑完全不变。
const script = [
  { content: '{"summary":"天气不错","sentiment":"positive","keywords":["天气","不错"]}' },          // 1 正常
  { content: '```json\n{"summary":"天气不错","sentiment":"positive","keywords":["天气"]}\n```' },   // 2 被代码块包裹
  { content: '{"summary":"天气不错","sentiment":"positive","keywords":["天气","不错",]}' },          // 3 尾逗号
  { content: '{"summary":"天气不错"}' },                                                            // 4 缺字段
  { content: '{“summary”:“天气不错”,“sentiment”:“positive”,“keywords”:[“天气”]}' },                // 5 中文引号
  { content: '{"quote":"他说"你好"","sentiment":"neutral","keywords":[]}' },                        // 6 转义陷阱：字符串里含未转义的英文引号
];

const llm = createMockLlm(script);
const required = ['summary', 'sentiment', 'keywords'];

console.log('约束模型输出 JSON，并健壮解析：\n');
for (let i = 0; i < script.length; i++) {
  const res = await llm.invoke([{ role: 'user', content: '总结这段话' }]);
  const raw = res.text;
  const result = parseJsonOutput(raw, {
    required,
    defaults: { keywords: [] }, // 允许 keywords 缺失，缺省给空数组
  });

  console.log(`--- 第 ${i + 1} 种输出 ---`);
  console.log(`[原始] ${raw}`);
  if (result.ok) {
    console.log(`[解析] ✅ ${JSON.stringify(result.data)}`);
  } else {
    console.log(`[解析] ❌ ${result.error}`);
  }
}

// ---------- 转义陷阱单独讲 ----------
// JSON 字符串里，英文双引号必须写成 \"，反斜杠必须写成 \\。
// 模型经常漏转义，导致整段 JSON 直接报废。看第 6 种输出的真实报错：
console.log('\n---------- 转义陷阱 ----------');
const bad = '{"quote":"他说"你好""}';
try {
  JSON.parse(bad);
} catch (e) {
  console.log(`坏转义 ${bad}`);
  console.log(`报错：${e.name}: ${e.message}`);
}
const good = '{"quote":"他说\\"你好\\""}';
console.log(`好转义 ${good} → ${JSON.stringify(JSON.parse(good))}`);

console.log('\n✅ 结构化输出演示完成。');
