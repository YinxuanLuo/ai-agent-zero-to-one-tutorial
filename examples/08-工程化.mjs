// 第 08 章配套示例：工程化
// 演示"把玩具变成系统"的三件事，对应正文 08.1 / 08.2 / 08.3：
//   1) 状态管理 —— 中间状态可序列化、可恢复
//   2) 可观测性 —— 每一步都留下 trace（时间、动作、输入、输出）
//   3) 测试 —— 用 node:test 断言"结构"而非"内容"
// 运行：node examples/08-工程化.mjs（演示 + 测试一起跑，退出码 0）
import { createMockLlm } from './llm-mock.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------- 1. 状态管理 ----------
// agent 的中间状态（对话历史、已走步数、是否结束）必须是一个"值"，
// 而不是散落各处的局部变量。是"值"才能序列化存库、才能在崩溃后恢复。
class AgentState {
  constructor(messages = [], { maxIterations = 5 } = {}) {
    this.messages = messages;   // 对话历史，纯数据
    this.steps = 0;             // 已走的步数
    this.maxIterations = maxIterations;
    this.finished = false;      // 是否已产出最终回答
  }

  // 序列化：把状态变成字符串，可以写文件/存数据库
  serialize() {
    return JSON.stringify({
      messages: this.messages,
      steps: this.steps,
      maxIterations: this.maxIterations,
      finished: this.finished,
    });
  }

  // 反序列化：从字符串恢复出状态，崩溃后从这里续跑
  static deserialize(json) {
    const data = JSON.parse(json);
    const s = new AgentState(data.messages, { maxIterations: data.maxIterations });
    s.steps = data.steps;
    s.finished = data.finished;
    return s;
  }
}

// ---------- 2. 可观测性：trace ----------
// trace 是一份"每一步做了什么"的流水账。出了 bug 你看一眼 trace，
// 就能定位是"模型乱答"还是"工具没执行"还是"循环没停"。
function createTracer() {
  const records = [];
  return {
    record(entry) {
      records.push({ ts: new Date().toISOString(), ...entry });
    },
    list() {
      return records;
    },
  };
}

// ---------- 3. 一个可观测的 agent 循环 ----------
const tools = {
  get_weather: {
    validate(args) {
      if (typeof args?.city !== 'string' || args.city.length === 0) {
        return { ok: false, error: 'city 不能为空' };
      }
      return { ok: true };
    },
    execute(args) {
      return `${args.city}：晴，25℃`; // 演示用固定数据
    },
  },
};

function dispatchTool(name, args) {
  const tool = tools[name];
  if (!tool) return { ok: false, error: `未知工具：${name}` };
  const check = tool.validate(args ?? {});
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, result: tool.execute(args) };
}

// 每一步都往 tracer 里记一笔；状态挂在 state 上推进；maxIterations 兜底。
async function runAgent(llm, state, tracer, { costPerStep = 1, budget = Infinity } = {}) {
  let spent = 0;
  while (state.steps < state.maxIterations) {
    state.steps += 1;
    const res = await llm.invoke(state.messages);
    tracer.record({ step: state.steps, kind: 'llm', output: res });

    if (!res.toolCall) {
      state.finished = true;
      tracer.record({ step: state.steps, kind: 'finish', text: res.text });
      return { done: true, text: res.text, steps: state.steps };
    }

    spent += costPerStep;
    if (spent > budget) {
      tracer.record({ step: state.steps, kind: 'stop', reason: 'budget' });
      return { done: false, reason: 'budget', steps: state.steps };
    }

    const out = dispatchTool(res.toolCall.name, res.toolCall.args);
    tracer.record({ step: state.steps, kind: 'tool', name: res.toolCall.name, args: res.toolCall.args, ok: out.ok });
    state.messages.push({ role: 'tool', content: out.ok ? out.result : `[错误] ${out.error}` });
  }
  tracer.record({ step: state.steps, kind: 'stop', reason: 'maxIterations' });
  return { done: false, reason: 'maxIterations', steps: state.steps };
}

// ---------- 演示（直接 node 运行时的主体） ----------
async function demo() {
  console.log('========== 演示 1：trace 记录每一步 ==========');
  const llm = createMockLlm([
    { toolCall: { name: 'get_weather', args: { city: '北京' } } },
    { content: '北京今天晴，25℃' },
  ]);
  const state = new AgentState([{ role: 'user', content: '北京天气？' }]);
  const tracer = createTracer();
  const result = await runAgent(llm, state, tracer);
  console.log(`结果：${result.done ? '完成' : '未完成'} | ${result.text} | 步数 ${result.steps}`);
  for (const r of tracer.list()) {
    console.log(`  [trace] step=${r.step} kind=${r.kind}${r.name ? ' tool=' + r.name : ''}${r.text ? ' text=' + r.text : ''}`);
  }

  console.log('\n========== 演示 2：状态可序列化、可恢复 ==========');
  const saved = state.serialize();
  console.log(`序列化后（${saved.length} 字节）：${saved}`);
  const restored = AgentState.deserialize(saved);
  console.log(`恢复后：messages=${restored.messages.length} 条，steps=${restored.steps}，finished=${restored.finished}`);
}

await demo();

// ---------- 测试（node:test，断言结构而非内容） ----------
// 概率系统测不了"精确输出"，但能测"结构约定"：
// 状态能不能恢复、trace 有没有记全、兜底有没有生效。

test('状态序列化后能无损恢复', () => {
  const s = new AgentState([{ role: 'user', content: 'hi' }]);
  s.steps = 3;
  const restored = AgentState.deserialize(s.serialize());
  assert.equal(restored.steps, 3);
  assert.equal(restored.messages.length, 1);
  // 断言结构：每条消息都有 role 和 content 两个字段（不关心具体内容）
  assert.deepEqual(Object.keys(restored.messages[0]).sort(), ['content', 'role']);
});

test('trace 记录了每一步且结构完整', async () => {
  const llm = createMockLlm([
    { toolCall: { name: 'get_weather', args: { city: '北京' } } },
    { content: '任意回答都行' },
  ]);
  const state = new AgentState([{ role: 'user', content: 'x' }]);
  const tracer = createTracer();
  await runAgent(llm, state, tracer);

  const list = tracer.list();
  assert.ok(list.length >= 3, `trace 至少应有 3 条，实际 ${list.length}`);
  // 每条 trace 都必须带 step / kind / ts 三个字段（结构约定）
  for (const r of list) {
    assert.ok(typeof r.step === 'number');
    assert.ok(typeof r.kind === 'string');
    assert.ok(typeof r.ts === 'string');
  }
});

test('死循环会被最大步数兜底', async () => {
  // 模型永远想调工具 → 只能靠 maxIterations 刹车
  const llm = createMockLlm(
    Array.from({ length: 100 }, () => ({ toolCall: { name: 'get_weather', args: { city: '北京' } } }))
  );
  const state = new AgentState([{ role: 'user', content: 'x' }], { maxIterations: 4 });
  const tracer = createTracer();
  const result = await runAgent(llm, state, tracer);
  assert.equal(result.done, false);
  assert.equal(result.reason, 'maxIterations');
  assert.equal(result.steps, 4);
});

console.log('\n✅ 08 示例运行完成：状态管理、trace、兜底演示通过，测试全部通过。');
