// ============================================================
// 应用层：智能任务助手（业务）
// 职责：把下面三层「组装」成一个具体应用 —— 拼系统提示词、初始化状态、
//       注入依赖、跑 agent。这是唯一知道「这是个任务助手」的地方。
// 依赖：state / tools / agent / llm（向下依赖，方向单一）。
// ============================================================

import { pathToFileURL } from 'node:url';
import { AgentState } from './state.mjs';
import { createTools } from './tools.mjs';
import { createAgent, createTracer } from './agent.mjs';
import { createLlm } from './llm.mjs';

// 系统提示词：告诉模型「你是谁、有哪些工具、该怎么协作」。
const SYSTEM_PROMPT = [
  '你是一个智能任务助手，能帮用户查天气、管理待办清单。',
  '规则：',
  '1. 先用工具查信息，得到足够信息后再回答，不要凭空编造。',
  '2. 如果用户说「如果下雨就……」，你必须先查天气，再决定是否执行后续动作。',
  '3. 待办清单的操作用 add_todo / list_todos 工具完成。',
  '4. 所有动作做完后，用一句话总结你做了什么。',
].join('\n');

// 组装并运行一次完整的任务。
// 返回 { result, state, tracer }，上层可据此做断言、展示 trace、序列化状态。
export async function runTaskAssistant({ llm, userInput, initialState } = {}) {
  const state = initialState ?? new AgentState();
  state.messages.push({ role: 'system', content: SYSTEM_PROMPT });

  // 关键的一步：store.todos 和 state.todos 是「同一个数组引用」。
  // 工具往 store.todos 里加待办，等于往 state.todos 里加 —— 序列化时不会丢。
  const store = { todos: state.todos };
  const tools = createTools(store);
  const tracer = createTracer();
  const agent = createAgent({ llm, tools, state, tracer });

  const result = await agent.run(userInput);
  return { result, state, tracer };
}

// ---------- 演示入口（直接 node app.mjs 时运行） ----------
// 判断「是不是被直接执行」，而不是被 import（import 时不跑演示，方便自测复用）。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  // 剧本：预置模型每一步的决策。换真实 API 时，这些就是模型真实的概率输出。
  const script = [
    // 第 1 步：模型判断「用户问了天气，得先查」
    { toolCall: { name: 'get_weather', args: { city: '北京' } } },
    // 第 2 步：看到「小雨」，判断「下雨了」，按用户要求加待办
    { toolCall: { name: 'add_todo', args: { content: '出门带伞' } } },
    // 第 3 步：动作做完，给最终回答
    { content: '北京今天小雨，18℃，我已经帮你把「出门带伞」加到待办清单了。' },
  ];

  const llm = createLlm(script);
  const { result, state, tracer } = await runTaskAssistant({
    llm,
    userInput: '北京今天天气怎么样？如果下雨，帮我在待办里加一条「出门带伞」。',
  });

  console.log('========== 智能任务助手运行结果 ==========');
  console.log(`最终回答：${result.text}`);
  console.log(`步数：${result.steps}，模型调用次数：${llm.getCallCount()}`);
  console.log('\n待办清单：');
  for (const t of state.todos) console.log(`  ${t.id}. ${t.content}`);
  console.log('\ntrace：');
  for (const r of tracer.list()) {
    console.log(`  [step=${r.step} kind=${r.kind}]${r.name ? ' tool=' + r.name + ' ok=' + r.ok : ''}${r.text ? ' text=' + r.text : ''}`);
  }
  console.log('\n序列化后的状态（可存库/续跑）：');
  console.log(`  ${state.serialize()}`);
}
