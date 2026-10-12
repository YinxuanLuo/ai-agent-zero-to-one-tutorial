// 第五关 · 第 5 题参考答案：可观测 + 测试
// 验收点：
//   1) AgentState 类：serialize / deserialize
//   2) createTracer：每一步留痕
//   3) node:test 两个测试：
//      - 状态序列化后能无损恢复（断言结构，不关心内容）
//      - "永远想调工具"的 mock 被 maxIterations 兜底，result.done === false
// 运行：node examples/answers/05-可观测与测试.mjs（退出码 0）

import { createMockLlm } from '../llm-mock.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 状态必须是"值"：只有纯数据（消息数组 + 数字 + 布尔），不含运行时对象，
// 这样 serialize 才不会因为循环引用/函数而炸掉。
class AgentState {
  constructor(messages = [], { maxIterations = 5 } = {}) {
    this.messages = messages;
    this.steps = 0;
    this.maxIterations = maxIterations;
    this.finished = false;
  }

  serialize() {
    return JSON.stringify({
      messages: this.messages,
      steps: this.steps,
      maxIterations: this.maxIterations,
      finished: this.finished,
    });
  }

  static deserialize(json) {
    const data = JSON.parse(json);
    const s = new AgentState(data.messages, { maxIterations: data.maxIterations });
    s.steps = data.steps;
    s.finished = data.finished;
    return s;
  }
}

// trace：一份"每一步做了什么"的流水账，出 bug 时有据可查。
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

// 可观测的 agent 循环：状态挂在 state 上推进，每一步记 trace，maxIterations 兜底。
async function runAgent(llm, state, tracer) {
  while (state.steps < state.maxIterations) {
    state.steps += 1;
    const res = await llm.invoke(state.messages);
    tracer.record({ step: state.steps, kind: 'llm' });

    if (!res.toolCall) {
      state.finished = true;
      tracer.record({ step: state.steps, kind: 'finish' });
      return { done: true, text: res.text, steps: state.steps };
    }

    const tool = { get_weather: () => '晴，25℃' }[res.toolCall.name];
    const content = tool ? tool(res.toolCall.args) : `未知工具：${res.toolCall.name}`;
    tracer.record({ step: state.steps, kind: 'tool', name: res.toolCall.name });
    state.messages.push({ role: 'tool', content });
  }
  tracer.record({ step: state.steps, kind: 'stop', reason: 'maxIterations' });
  return { done: false, reason: 'maxIterations', steps: state.steps };
}

// ---- 测试 1：状态序列化后能无损恢复（断言结构，不关心内容） ----
test('状态序列化后能无损恢复', () => {
  const s = new AgentState([{ role: 'user', content: 'hi' }]);
  s.steps = 3;
  const restored = AgentState.deserialize(s.serialize());
  assert.equal(restored.steps, 3);
  assert.equal(restored.messages.length, 1);
  // 断言结构：每条消息恰好有 role 和 content 两个字段（不关心具体内容）
  assert.deepEqual(Object.keys(restored.messages[0]).sort(), ['content', 'role']);
});

// ---- 测试 2：死循环被最大步数兜底 ----
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

console.log('✅ 第 5 题答案运行完成：两个测试通过，退出码 0。');
