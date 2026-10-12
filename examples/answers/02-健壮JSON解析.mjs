// 第五关 · 第 2 题参考答案：健壮 JSON 解析器
// 验收点：
//   1) 剥掉 ```json 代码块外壳
//   2) JSON.parse 失败后，修复尾逗号、中文引号再试一次
//   3) 解析成功后补默认值、校验必填字段
//   4) 返回 { ok:true, data } 或 { ok:false, error }
// 运行：node examples/answers/02-健壮JSON解析.mjs（退出码 0）

// 第一步：剥壳。模型以为你在聊天框看结果，常把 JSON 包进 ```json ... ```
function extractJsonBlock(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // 没有代码块：找第一个 { 到最后一个 } 之间
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.slice(start, end + 1).trim();

  return text.trim();
}

// 第二步：修复。模型真实会犯的两种错：尾逗号、中文引号。
// 注意：修复是有损的，所以只在 parse 失败后才调用，不做无脑预处理。
function repairJson(text) {
  return text
    .replace(/,\s*([}\]])/g, '$1')       // 去尾逗号：{... ,} 和 [... ,]
    .replace(/[\u201C\u201D]/g, '"');    // 中文引号 “ ” 换成 "
}

// 第三步：校验字段。JSON.parse 成功只代表"合法"，不代表"是我要的"。
function validateFields(obj, required) {
  const missing = required.filter((k) => obj[k] === undefined || obj[k] === null);
  return missing.length > 0
    ? { ok: false, error: `缺失字段：${missing.join(', ')}` }
    : { ok: true };
}

// 组合起来：剥壳 → 解析（失败就修复再解析）→ 补默认值 → 校验
function parseJsonOutput(text, { required = [], defaults = {} } = {}) {
  const cleaned = extractJsonBlock(text);
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    try {
      data = JSON.parse(repairJson(cleaned));
    } catch (e2) {
      return { ok: false, error: `JSON 解析失败：${e2.message}` };
    }
  }
  for (const [k, v] of Object.entries(defaults)) {
    if (data[k] === undefined) data[k] = v; // 补默认值
  }
  const check = validateFields(data, required);
  return check.ok ? { ok: true, data } : { ok: false, error: check.error, data };
}

// ---- 验证：覆盖验收点里的各种脏输出 ----
const cases = [
  ['```json\n{"summary":"不错","sentiment":"positive"}\n```', { required: ['sentiment'] }],
  ['{"summary":"不错","sentiment":"positive",}', { required: ['sentiment'] }],
  ['{“summary”:“不错”,“sentiment”:“positive”}', { required: ['sentiment'] }],
  ['{"summary":"不错"}', { required: ['sentiment'] }],           // 缺必填 → ok:false
  ['{"summary":"不错"}', { defaults: { sentiment: 'neutral' } }], // 缺省字段有默认值
];

for (const [input, opts] of cases) {
  const result = parseJsonOutput(input, opts);
  console.log(
    result.ok
      ? `✅ ${JSON.stringify(result.data)}`
      : `❌ ${result.error}`
  );
}
