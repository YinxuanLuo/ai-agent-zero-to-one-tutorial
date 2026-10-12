// ============================================================
// 状态层（Agent 核心层的一部分）
// 职责：把 agent 的中间状态收敛成一个「值」，可序列化、可恢复。
// 依赖：无（这是整个项目的最底层，谁都不依赖）。
// ============================================================

// Agent 状态必须是一个「纯数据」对象，不能有函数、不能有循环引用，
// 否则 JSON.stringify 会抛「Converting circular structure to JSON」。
// 所以这里只放：消息数组、业务数据（todos）、步数、是否结束、步数上限。
export class AgentState {
  constructor({ messages = [], todos = [], maxIterations = 5 } = {}) {
    this.messages = messages;     // 对话历史：{ role, content } 数组
    this.todos = todos;           // 业务状态：待办事项数组（演示「工具读写状态」）
    this.steps = 0;               // 已走的步数
    this.finished = false;        // 是否已产出最终回答
    this.maxIterations = maxIterations; // 兜底：最多循环多少步
  }

  // 序列化：状态 → 字符串，可以写文件、存数据库
  serialize() {
    return JSON.stringify({
      messages: this.messages,
      todos: this.todos,
      steps: this.steps,
      finished: this.finished,
      maxIterations: this.maxIterations,
    });
  }

  // 反序列化：字符串 → 状态，崩溃后从这里续跑
  static deserialize(json) {
    const data = JSON.parse(json);
    const s = new AgentState({
      messages: data.messages,
      todos: data.todos,
      maxIterations: data.maxIterations,
    });
    s.steps = data.steps;
    s.finished = data.finished;
    return s;
  }
}
