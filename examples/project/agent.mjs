// ============================================================
// Agent 核心层：循环 + 工具分发 + trace
// 职责：把「调模型 → 判断输出 → 执行工具 → 喂回结果」这个循环跑起来，
//       每一步都留 trace，并用最大步数兜底防止死循环。
// 依赖：无（llm / tools / state 全部通过参数注入，本层不知道它们怎么实现）。
// ============================================================

// 可观测性：trace 是「每一步做了什么」的流水账。
export function createTracer() {
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

// 工具分发：把「模型想调用的工具」真正执行起来。
// 返回值约定：{ ok: true, result } 或 { ok: false, error }。
// 关键：工具报错不 throw、不崩，把「错误名 + 错误信息」当结果喂回给模型，
// 让模型自己决定重试还是换路（见第 03 章）。
function dispatchTool(tools, name, args) {
  const tool = tools[name];
  if (!tool) {
    return { ok: false, error: `未知工具：${name}，可用工具：${Object.keys(tools).join(', ')}` };
  }
  const check = tool.validate(args ?? {});
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  try {
    return { ok: true, result: tool.execute(args) };
  } catch (err) {
    return { ok: false, error: `${err.name}: ${err.message}` };
  }
}

// 工厂函数：把依赖（llm / tools / state / tracer）注入进来，返回一个 agent。
// 这样上层可以自由替换任意一个依赖，而循环逻辑不动 —— 这就是「可插拔」。
export function createAgent({ llm, tools, state, tracer }) {
  async function run(userInput) {
    state.messages.push({ role: 'user', content: userInput });

    while (state.steps < state.maxIterations) {
      state.steps += 1;

      const res = await llm.invoke(state.messages);
      tracer.record({ step: state.steps, kind: 'llm', output: res });

      // 模型给了文字 → 最终回答，结束循环
      if (!res.toolCall) {
        state.finished = true;
        tracer.record({ step: state.steps, kind: 'finish', text: res.text });
        return { done: true, text: res.text, steps: state.steps };
      }

      // 模型想调工具 → 真正执行
      const { name, args } = res.toolCall;
      const out = dispatchTool(tools, name, args);
      tracer.record({ step: state.steps, kind: 'tool', name, args, ok: out.ok });

      // 把「模型的工具调用」和「工具的结果（或错误）」都拼回消息，
      // 下一轮模型才知道自己做过什么、结果如何。
      state.messages.push({ role: 'assistant', content: null, toolCall: { name, args } });
      state.messages.push({ role: 'tool', content: out.ok ? out.result : `[错误] ${out.error}` });
    }

    // 兜底：步数用完了还没结束，强制停止
    tracer.record({ step: state.steps, kind: 'stop', reason: 'maxIterations' });
    return { done: false, reason: 'maxIterations', steps: state.steps };
  }

  return { run };
}
