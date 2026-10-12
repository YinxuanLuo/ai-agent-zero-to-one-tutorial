// ============================================================
// 端到端自测：覆盖四层 + 完整多步推理 + 兜底。
// 运行：node --test examples/project/self-test.mjs
// 全部通过 → 退出码 0。
// 测试思想（见第 08 章）：概率系统测「结构」和「边界」，不测「措辞」。
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AgentState } from './state.mjs';
import { createTools } from './tools.mjs';
import { createAgent, createTracer } from './agent.mjs';
import { createLlm } from './llm.mjs';
import { runTaskAssistant } from './app.mjs';

// ---------- 1. 状态层：可序列化、可恢复 ----------
test('状态序列化后能无损恢复（含待办）', () => {
  const s = new AgentState({ messages: [{ role: 'user', content: 'hi' }], todos: [{ id: 1, content: '带伞', done: false }] });
  s.steps = 3;
  s.finished = true;

  const restored = AgentState.deserialize(s.serialize());

  assert.equal(restored.steps, 3);
  assert.equal(restored.finished, true);
  assert.equal(restored.maxIterations, 5);
  assert.equal(restored.messages.length, 1);
  assert.equal(restored.todos.length, 1);
  assert.equal(restored.todos[0].content, '带伞');
});

// ---------- 2. 工具层：参数校验（模型参数不可信） ----------
test('工具校验会拦住非法参数', () => {
  const tools = createTools({ todos: [] });

  // city 传数字：拦
  assert.equal(tools.get_weather.validate({ city: 123 }).ok, false);
  // city 传空串：拦
  assert.equal(tools.get_weather.validate({ city: '' }).ok, false);
  // city 正常：放行
  assert.equal(tools.get_weather.validate({ city: '北京' }).ok, true);

  // content 传数字：拦
  assert.equal(tools.add_todo.validate({ content: 42 }).ok, false);
  // content 正常：放行
  assert.equal(tools.add_todo.validate({ content: '出门带伞' }).ok, true);
});

// ---------- 3. Agent 核心层：未知工具不崩、报错喂回 ----------
test('未知工具返回错误而不是崩溃', async () => {
  const llm = createLlm([
    { toolCall: { name: 'not_exist', args: {} } }, // 模型调了一个不存在的工具
    { content: '我不知道这个工具' },                // 看到错误后放弃，给最终回答
  ]);
  const state = new AgentState({ messages: [{ role: 'system', content: 's' }] });
  const tracer = createTracer();
  const agent = createAgent({ llm, tools: createTools({ todos: state.todos }), state, tracer });

  const result = await agent.run('x');

  assert.equal(result.done, true); // 最终仍然正常结束，没有 throw
  assert.equal(llm.getCallCount(), 2); // 调了两次模型：一次工具调用，一次最终回答
  // trace 里那条 tool 记录的 ok 必须是 false（被错误兜住，而不是崩掉）
  const toolRecord = tracer.list().find((r) => r.kind === 'tool');
  assert.equal(toolRecord.ok, false);
});

// ---------- 4. 端到端：查天气 + 判断下雨 + 加待办 + 最终回答 ----------
test('完整多步推理：查天气后按条件加待办', async () => {
  const llm = createLlm([
    { toolCall: { name: 'get_weather', args: { city: '北京' } } },  // 第 1 步：查天气
    { toolCall: { name: 'add_todo', args: { content: '出门带伞' } } }, // 第 2 步：判断下雨，加待办
    { content: '北京今天小雨，已帮你把「出门带伞」加入待办。' },      // 第 3 步：最终回答
  ]);

  const { result, state, tracer } = await runTaskAssistant({
    llm,
    userInput: '北京今天天气怎么样？如果下雨，帮我在待办里加一条「出门带伞」。',
  });

  assert.equal(result.done, true);                 // 正常结束
  assert.equal(result.steps, 3);                   // 恰好 3 步
  assert.equal(llm.getCallCount(), 3);             // 3 次模型调用 = 3 步
  assert.equal(state.todos.length, 1);             // 待办加进去了
  assert.equal(state.todos[0].content, '出门带伞'); // 内容正确
  assert.equal(state.finished, true);              // 状态标记已结束

  // 结构断言：trace 里恰好有一次 get_weather 和一次 add_todo
  const toolNames = tracer.list().filter((r) => r.kind === 'tool').map((r) => r.name);
  assert.deepEqual(toolNames, ['get_weather', 'add_todo']);
});

// ---------- 5. 兜底：模型死循环，靠 maxIterations 刹车 ----------
test('死循环会被最大步数兜底', async () => {
  // 模型永远想调同一个工具 → 只能靠 maxIterations 强制停止
  const llm = createLlm(
    Array.from({ length: 100 }, () => ({ toolCall: { name: 'get_weather', args: { city: '北京' } } }))
  );
  const state = new AgentState({ maxIterations: 4 });
  const tracer = createTracer();
  const agent = createAgent({ llm, tools: createTools({ todos: state.todos }), state, tracer });

  const result = await agent.run('x');

  assert.equal(result.done, false);             // 没正常结束
  assert.equal(result.reason, 'maxIterations'); // 原因是步数用尽
  assert.equal(result.steps, 4);                // 恰好走了 4 步就停
});

// ---------- 6. 自我修正：工具报错喂回，模型改参数重试 ----------
test('工具报错喂回后模型能自我修正', async () => {
  const llm = createLlm([
    { toolCall: { name: 'get_weather', args: { city: 123 } } },  // 第 1 步：参数传错
    { toolCall: { name: 'get_weather', args: { city: '北京' } } }, // 第 2 步：修正后重试
    { content: '北京今天小雨，18℃。' },                            // 第 3 步：最终回答
  ]);

  const { result, tracer } = await runTaskAssistant({
    llm,
    userInput: '北京天气？',
  });

  assert.equal(result.done, true);
  assert.equal(llm.getCallCount(), 3);
  // 结构断言：两次 get_weather 调用，第一次 ok=false（报错喂回），第二次 ok=true（修正成功）
  const weatherRecords = tracer.list().filter((r) => r.kind === 'tool' && r.name === 'get_weather');
  assert.equal(weatherRecords.length, 2);
  assert.equal(weatherRecords[0].ok, false);
  assert.equal(weatherRecords[1].ok, true);
});
