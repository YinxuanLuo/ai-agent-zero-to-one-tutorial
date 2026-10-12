// ============================================================
// 工具层：注册的工具
// 职责：把「模型能调用的工具」集中注册，每个工具带
//       description（何时用）+ parameters（怎么用）+ validate（校验）+ execute（干活）。
// 依赖：无（工具不知道 LLM 的存在，也不知道 agent 循环的存在）。
// ============================================================

// 每个工具的定义（本教程统一约定）：
//   {
//     description: 一句话告诉模型「什么时候该用我」，
//     parameters: JSON Schema，告诉模型「怎么用我」，
//     validate(args): 运行时校验模型给的参数（模型参数不可信），
//     execute(args): 真正干活的代码，模型永远碰不到，
//   }
// store 是业务状态的引用（{ todos }），工具通过它读写状态。
export function createTools(store) {
  return {
    get_weather: {
      description: '查询指定城市的实时天气，返回温度与天气状况。city 用中文城市名，例如「北京」。',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '中文城市名，例如「北京」' },
        },
        required: ['city'],
      },
      // 运行时校验：模型给的参数是概率采样，可能是数字、空串、对象。
      // 白名单城市，拦掉不认识的输入，报错要具体、带错误名。
      validate(args) {
        if (typeof args?.city !== 'string' || args.city.trim() === '') {
          return { ok: false, error: `city 必须是中文城市名字符串，但收到 ${typeof args?.city}` };
        }
        return { ok: true };
      },
      // 真实场景这里会 fetch 天气 API；演示用确定性假数据保证离线可跑。
      execute(args) {
        const city = args.city.trim();
        if (city === '北京') return `${city}：小雨，18℃`;
        if (city === '深圳') return `${city}：晴，28℃`;
        return `${city}：多云，22℃`;
      },
    },

    add_todo: {
      description: '往待办清单里添加一条事项。content 是要做的事，例如「出门带伞」。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '待办内容，例如「出门带伞」' },
        },
        required: ['content'],
      },
      validate(args) {
        if (typeof args?.content !== 'string' || args.content.trim() === '') {
          return { ok: false, error: `content 必须是非空字符串，但收到 ${typeof args?.content}` };
        }
        return { ok: true };
      },
      execute(args) {
        // 注意：这里在「读写业务状态」。store.todos 就是 AgentState 里的 todos，
        // 是同一个数组引用，所以加进去的待办会被序列化保存下来。
        const content = args.content.trim();
        const id = store.todos.length + 1;
        store.todos.push({ id, content, done: false });
        return `已添加待办「${content}」（当前共 ${store.todos.length} 条）`;
      },
    },

    list_todos: {
      description: '列出当前待办清单里的所有事项。无参数。',
      parameters: {
        type: 'object',
        properties: {},
      },
      validate() {
        return { ok: true }; // 无参数，不需要校验
      },
      execute() {
        if (store.todos.length === 0) return '当前没有待办事项';
        return store.todos
          .map((t) => `${t.id}. ${t.content}${t.done ? '（已完成）' : ''}`)
          .join('\n');
      },
    },
  };
}
