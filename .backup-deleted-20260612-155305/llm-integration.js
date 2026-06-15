// ============================================================
// 优面AI · LLM 集成模块（v0.6 W4 升级）
// 接入 MiniMax-M3 真实 API · 4 家人设 · 3 压力级别 · 5 套 prompt
// 依赖：config.js（必须先加载）
// 关联文档：02-PRD.md §11 AI 能力附录
// ============================================================

(function() {
  'use strict';

  // ============================================================
  // 1. Prompt 模板库（5 套，全部 M3-optimized）
  // ============================================================

  // P1: 4 家人设 system prompt
  const PERSONAS = {
    '字节': `你是字节跳动产品岗的资深面试官，你的风格是：
- ⚡ 节奏快，1-2 句话内必追问
- 📊 数据驱动，开口就要"数据基线 / 对比对象"
- 🔥 压力测试，连续追问 3 次以上，不轻易放过模糊回答
- 💬 表达直接，不绕弯子，"这个数据有问题，重说"
- 🎯 关注点：增长逻辑、ROI、AB 实验、结论先行
- 🚫 红线：禁止"我觉得 / 大概 / 差不多"等模糊词；禁止空泛回答无数据
- 🎓 追问模板："这个数据 X% 是怎么算的？分母是什么？对比对象是谁？"
你叫"张磊"，3 年字节产品经验，面试过 200+ 候选人。`,

    '腾讯': `你是腾讯产品岗的资深面试官，你的风格是：
- 🧠 系统思考，注重"底层逻辑 / 思考过程"
- 🔍 追问"为什么"，要"为什么"的"为什么"
- 📚 关注点：用户需求定义、判断依据、思考路径
- 💡 风格温和但犀利，喜欢引导式提问
- 🚫 红线：禁止"我猜 / 应该是"；禁止给方案不给依据
- 🎓 追问模板："你为什么这样判断？基于什么事实？还有什么可能性？"
你叫"陈昊"，5 年腾讯产品经验，面试过 300+ 候选人。`,

    '美团': `你是美团产品岗的资深面试官，你的风格是：
- 💼 业务落地型，关注"商业化 / ROI / 核心指标"
- 📈 数字敏感，开口就是 GMV / 订单量 / 履约成本
- 🎯 关注点：业务流程、效率提升、商业模式
- 💬 表达务实，"别讲理论，讲你怎么做的"
- 🚫 红线：禁止空想不落地；禁止"未来可能"等虚词
- 🎓 追问模板："这个业务的核心指标是什么？你做的动作对指标的影响是多少？"
你叫"王敏"，4 年美团产品经验，面试过 250+ 候选人。`,

    '小红书': `你是小红书产品岗的资深面试官，你的风格是：
- 🌸 内容感知，看重"网感 / 用户洞察 / 内容生态"
- 💕 关注点：用户画像、创作者运营、内容策略
- 🎨 表达感性，"你能感受到这个功能背后的用户情绪吗？"
- 🚫 红线：禁止只看数据不看人；禁止忽略内容属性
- 🎓 追问模板："这个用户为什么会发这条内容？她/他的情绪是什么？你怎么量化？"
你叫"林悦"，3 年小红书内容产品经验，面试过 180+ 候选人。`
  };

  // P3: 3 个压力级别 prompt
  const PRESSURE_LEVELS = {
    '温和': `【压力级别：温和】- 适合初次体验
- 每次用户回答后，给 1 条具体反馈
- 追问次数 0-1 次，让用户喘气
- 语气温和但保持专业，不"捧"
- 例："嗯，听起来不错。但 XX 这一点能再展开吗？"`,

    '标准': `【压力级别：标准】- 默认难度
- 每次用户回答后，给 1-2 条反馈（优点 1 + 不足 1）
- 追问次数 1-2 次，逐步深入
- 语气中性，"这个回答有亮点也有改进空间"
- 例："回答结构不错。但 XX 数据需要解释分母，另外 YY 情况你没考虑。"`,

    '字节式': `【压力级别：字节式】- 高压挑战
- 每次用户回答后，必须追问至少 1 次，连续追问 3 次以上
- 语气直接犀利，**不轻易放过模糊回答**
- 反驳 + 重构："这个数据不对，重说。" / "你避开了我的问题。"
- 例："等一下，你刚才说 X%，但我注意到你的样本量是 80，这个比例代表什么？"`,

    // 兼容 v0.2.3 的旧称
    '标准型': '标准',
    '温和型': '温和',
    '字节式高压': '字节式'
  };

  // P5: 经历包装 prompt（精简版，避免 token 超限）
  const PACKAGE_EXPERIENCE_PROMPT = `你是产品经理求职辅导专家，擅长将非产品岗经历转化为产品岗视角的能力标签。

【严格约束】
1. **不编造事实**：只能基于用户提供的真实经历做能力映射
2. **每段经历 2-3 个标签**（不要更多）
3. **name 是 2-6 字的能力标签**
4. **reason 不超过 15 字**（精炼）

【产品岗标签池】
用户洞察 / 需求分析 / 数据分析 / 用户调研 / 跨部门协作 / 商业化思考 / 增长策略 / 内容运营 / 流程优化 / 系统思维 / 团队协作 / 商业洞察

【输出 JSON 格式】
{"packages":[{"experience":"原标题","tags":[{"name":"标签","reason":"映射说明"}]}]}

【用户输入】
{experiences}

请输出 JSON：`;

  // P4: 诚实反馈 prompt
  const HONEST_FEEDBACK_PROMPT = `你是 {company} 的产品面试官，刚面试完一位校招候选人。
候选人简历：{resume}
面试记录：{conversation}

【敢说真话要求】（最重要，不允许任何"鼓励式"话术）
1. **优点和不足并列**：必须同时指出 2-3 个优点 + 2-3 个不足，不允许只夸不批
2. **数据基线**：评分必须有"为什么是这个分"的依据，对比同档位候选人
3. **可执行改进**：建议必须具体到"下次回答 X 类问题时，先说 Y，再展开 Z"
4. **避免空泛**：禁止"回答不错 / 表达流畅"等无信息反馈；必须"好在哪里 / 差在哪里"

【评分锚点】（0-100 分）
- 60 = 明显不足（信息密度低 / 缺乏数据 / 反思浅）
- 70 = 勉强达标（有基本逻辑但缺亮点）
- 80 = 达到校招 bar（结构清晰 + 有数据 + 有思考）
- 90 = 超出预期（结构 + 数据 + 反思 + 创新点）

【6 维评分】（必须全部输出）
- 产品感 / 逻辑 / 表达 / 案例 / 反问 / 抗压（结合 {pressureLevel} 压力级别调整抗压权重）

【输出 JSON 格式】
{
  "overall_score": 72,
  "radar": {
    "产品感": 75, "逻辑": 70, "表达": 80, "案例": 65, "反问": 60, "抗压": 70
  },
  "考点分析": [
    { "考点": "用户增长方法论", "得分": 7, "要点": "提到 AARRR 但未分流量来源" }
  ],
  "回答分析": [
    { "问题": "自我介绍", "得分": 7, "优势": "突出产品实习数据", "不足": "未说为什么选这个岗位" },
    { "问题": "DAU 提升 20%", "得分": 6, "优势": "有数据", "不足": "没说是怎么归因的" }
  ],
  "优势": [
    "具体优势 1（带数据依据）",
    "具体优势 2"
  ],
  "不足": [
    "具体不足 1（敢说的真话）",
    "具体不足 2"
  ],
  "改进建议": [
    { "优先级": "P0", "类别": "题目类型", "建议": "做 5 道陌生人场景的'如何验证需求'题" },
    { "优先级": "P1", "类别": "思维框架", "建议": "下次回答'为什么是 X 而非 Y'前，先说对比对象" }
  ]
}

请严格按以上 JSON 结构输出：`;

  // P2: 6 维评分 system prompt 补充
  const SCORING_SYSTEM = `【6 维评分标准】（每次回答评估）
1. 产品感（Product Sense）：对用户需求 / 商业模式的理解深度
2. 逻辑（Logic）：思考链条是否清晰、有没有前后矛盾
3. 表达（Communication）：语言精炼度、是否抓重点
4. 案例（Examples）：是否能用具体数据 / 经历支撑观点
5. 反问（Counter-questions）：被追问时是否能接住、是否反思
6. 抗压（Stress）：面对质疑 / 挑战时的稳定性（结合压力级别）

【反馈原则】
- 敢说不好的，避免鼓励式
- 给具体改进（"下次回答用户增长类问题时，先说'流量来源分层'，再说'验证方法'"）
- 用 1-5 分评每维度（5=优秀，3=达标，1=不足），便于用户看到短板`;

  // ============================================================
  // 2. LLM 调用封装（callLLM）
  // ============================================================

  let _debugStats = { calls: 0, tokens: 0, errors: 0, fallbacks: 0 };

  /**
   * 统一 LLM 调用入口
   * @param {Object} opts
   * @param {string} opts.system - system prompt
   * @param {Array} opts.messages - [{role, content}, ...]
   * @param {boolean} opts.stream - 是否流式
   * @param {boolean} opts.jsonMode - 是否 JSON 模式
   * @param {function} opts.onChunk - 流式回调 (chunk, full) => void
   * @param {function} opts.onDone - 完成回调 (fullText) => void
   * @param {function} opts.onError - 错误回调 (error, provider) => void
   */
  async function callLLM(opts) {
    const cfg = (window.YOUMIAN_CONFIG || {});
    const providers = [cfg.PRIMARY, cfg.BACKUP_QWEN].filter(p => p && p.API_KEY);
    if (providers.length === 0) {
      // 无 API key，直接降级到 mock
      _debugStats.fallbacks++;
      if (opts.onError) opts.onError(new Error('未配置 API key，回退到 mock 模式'), null);
      return null;
    }

    let lastError = null;
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      try {
        const result = await _callOneProvider(provider, opts);
        _debugStats.calls++;
        if (result) _debugStats.tokens += result.usage?.total_tokens || 0;
        if (opts.onDone) opts.onDone(result?.text);
        return result;
      } catch (e) {
        lastError = e;
        _debugStats.errors++;
        console.warn(`[callLLM] ${provider.PROVIDER} 失败:`, e.message);
        // 切到下一个 provider
      }
    }
    // 全部失败
    _debugStats.fallbacks++;
    if (opts.onError) opts.onError(lastError || new Error('所有模型均失败'), null);
    return null;
  }



  // ============================================================
  // 辅助：鲁棒 JSON 解析（处理 <think> 块 + `json markdown 包裹）
  // ============================================================

  function _robustParseJSON(text, source) {
    if (!text) return null;
    let cleaned = text.trim();

    // 1. 去除 <think>...</think> 推理块
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // 2. 提取 `json ... ` 代码块
    const codeBlockMatch = cleaned.match(/```(?:json)?\\s*([\\s\\S]*?)```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    } else {
      // 3. 尝试提取第一个 { ... } 块
      const braceStart = cleaned.indexOf('{');
      const braceEnd = cleaned.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        cleaned = cleaned.slice(braceStart, braceEnd + 1);
      }
    }

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.error('[' + source + '] JSON parse failed:', e.message, '\\n原文:', text.slice(0, 200));
      return null;
    }
  }

  
  // ============================================================
  // 辅助：鲁棒 JSON 解析（处理 <think> 块 + ```json markdown 包裹）
  // ============================================================

  function _robustParseJSON(text, source) {
    if (!text) return null;
    let cleaned = text.trim();

    // 1. 去除 <think>...</think> 推理块
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // 2. 提取 ```json ... ``` 代码块
    const codeBlockRegex = new RegExp("```(?:json)?\\s*([\\s\\S]*?)```");
    const codeBlockMatch = cleaned.match(codeBlockRegex);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    } else {
      // 3. 尝试提取第一个 { ... } 块
      const braceStart = cleaned.indexOf("{");
      const braceEnd = cleaned.lastIndexOf("}");
      if (braceStart >= 0 && braceEnd > braceStart) {
        cleaned = cleaned.slice(braceStart, braceEnd + 1);
      }
    }

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("[" + source + "] JSON parse failed:", e.message, "原文:", text.slice(0, 200));
      return null;
    }
  }

  async function _callOneProvider(provider, opts) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), provider.TIMEOUT_MS || 15000);

    const body = {
      model: provider.MODEL,
      messages: [
        { role: 'system', content: opts.system },
        ...(opts.messages || [])
      ],
      stream: opts.stream && provider.STREAM,
      temperature: opts.temperature || 0.7,
      max_tokens: opts.maxTokens || 1000
    };
    if (opts.jsonMode && provider.JSON_MODE) {
      body.response_format = { type: 'json_object' };
    }

    const resp = await fetch(provider.ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + provider.API_KEY
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }).catch(e => {
      throw new Error('网络错误 / CORS 拒绝: ' + e.message);
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }

    if (opts.stream && provider.STREAM) {
      // 流式：SSE 解析
      return await _parseSSE(resp, opts.onChunk);
    } else {
      // 非流式
      const data = await resp.json();
      return { text: data.choices?.[0]?.message?.content || '', usage: data.usage };
    }
  }

  async function _parseSSE(resp, onChunk) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留未完成行
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            if (onChunk) onChunk(delta, fullText);
          }
        } catch (e) {
          // 忽略非 JSON 行（keepalive 等）
        }
      }
    }
    return { text: fullText, usage: null };
  }

  // ============================================================
  // 3. 三个高阶 API（P05 / P07 / P08）
  // ============================================================

  /**
   * P05: 经历包装
   * @param {Array} experiences - 简历经历 [{title, text, isCrossMajor}, ...]
   * @returns {Promise<{packages: [...]}|null>}
   */
  async function llmPackageExperience(experiences) {
    const system = '你是产品经理求职辅导专家，输出严格的 JSON 格式。';
    const userMsg = PACKAGE_EXPERIENCE_PROMPT.replace('{experiences}', JSON.stringify(experiences, null, 2));

    const result = await callLLM({
      system,
      messages: [{ role: 'user', content: userMsg }],
      stream: false,
      jsonMode: true,
      maxTokens: 1200
    });
    if (!result) return null;
    return _robustParseJSON(result.text, 'llmPackageExperience');
  }

  /**
   * P07: 模拟面试对话（流式）
   * @param {Object} ctx
   * @param {string} ctx.company - 字节/腾讯/美团/小红书
   * @param {string} ctx.pressureLevel - 温和/标准/字节式
   * @param {string} ctx.position - 产品岗
   * @param {string} ctx.resume - 候选人简历
   * @param {Array} ctx.history - 历史对话 [{role, content}, ...]
   * @param {string} ctx.currentStage - 当前阶段（开场/实习深挖/项目深挖/业务考察/收尾反问）
   * @param {string} ctx.lastUserAnswer - 候选人最新回答
   * @param {function} onChunk - 流式回调
   * @returns {Promise<{text, isFollowup: boolean}|null>}
   */
  async function llmInterviewStep(ctx, onChunk) {
    const persona = PERSONAS[ctx.company] || PERSONAS['字节'];
    const pressure = PRESSURE_LEVELS[ctx.pressureLevel] || PRESSURE_LEVELS['标准'];
    const system = `${persona}\n\n${pressure}\n\n${SCORING_SYSTEM}`;

    const stageContext = `【当前阶段】${ctx.currentStage}
【候选人简历】${ctx.resume || '（无）'}
【任务】候选人刚回答完一道题，你作为${ctx.company}面试官，需要：
1. 给出 1 句话反馈（敢说真话，优缺点并陈）
2. 决定是否追问（按 ${ctx.pressureLevel} 压力级别）
3. 输出一段连贯的话（不超过 100 字），用对话口吻，不要 markdown 格式`;

    const messages = [
      ...ctx.history.slice(-8), // 保留最近 8 轮
      { role: 'user', content: `【候选人最新回答】${ctx.lastUserAnswer}\n\n${stageContext}` }
    ];

    return new Promise((resolve) => {
      callLLM({
        system,
        messages,
        stream: true,
        jsonMode: false,
        onChunk: (delta, full) => { if (onChunk) onChunk(delta, full); },
        onDone: (text) => resolve({ text, isFollowup: ctx.history.length > 0 }),
        onError: (err) => resolve(null)
      });
    });
  }

  /**
   * P08: 面试反馈生成（JSON 模式）
   * @param {Object} ctx
   * @param {string} ctx.company
   * @param {string} ctx.pressureLevel
   * @param {string} ctx.position
   * @param {string} ctx.resume
   * @param {Array} ctx.conversation - 完整对话历史
   * @returns {Promise<Object|null>}
   */
  async function llmGenerateFeedback(ctx) {
    const persona = PERSONAS[ctx.company] || PERSONAS['字节'];
    const pressure = PRESSURE_LEVELS[ctx.pressureLevel] || PRESSURE_LEVELS['标准'];
    const system = `${persona}\n\n${pressure}\n\n${SCORING_SYSTEM}`;

    const userMsg = HONEST_FEEDBACK_PROMPT
      .replace('{company}', ctx.company || '字节')
      .replace('{pressureLevel}', ctx.pressureLevel || '标准')
      .replace('{resume}', ctx.resume || '（无）')
      .replace('{conversation}', ctx.conversation.map(m =>
        `[${m.role === 'assistant' ? '面试官' : '候选人'}] ${m.content}`
      ).join('\n'));

    const result = await callLLM({
      system,
      messages: [{ role: 'user', content: userMsg }],
      stream: false,
      jsonMode: true,
      maxTokens: 1500
    });
    if (!result) return null;
    return _robustParseJSON(result.text, 'llmGenerateFeedback');
  }

  /**
   * 题库变量定制化：调 M3 仅填 ${var} 占位，不重写题干
   * 用于 modules/questionCustomizer.js 的简化版（不依赖 questionCustomizer）
   * @param {Object} template - {text, template_vars}
   * @param {Object} ctx - {resume, company}
   * @returns {Promise<{filled_text: string, vars: Object, source: string}|null>}
   */
  async function customizeQuestion(template, ctx) {
    const templateText = (template && template.text) || '';
    const vars = (template && template.template_vars) || [];
    const resume = (ctx && ctx.resume) || '';
    const company = (ctx && ctx.company) || '';

    // 无变量：直接返回
    if (vars.length === 0) {
      return { filled_text: templateText, vars: {}, source: 'noop' };
    }

    const prompt = [
      '你是 AI 面试官助手。你的任务是根据候选人的简历，从题库模板中提取或推断变量值。',
      '',
      '【题库模板】',
      templateText,
      '',
      '【需要填的变量】',
      vars.join(', '),
      '',
      '【候选人简历】',
      resume || '（无）',
      '',
      '【目标公司】',
      company || '字节',
      '',
      '【严格约束】',
      '1. 不重写题干，只替换 ${var} 占位符',
      '2. 简历中能找到的具体项目/数据/经历优先（用真实内容）',
      '3. 简历中找不到的，用 [需追问] 占位',
      '4. 变量名严格使用给定的列表',
      '',
      '【输出严格 JSON 格式】',
      '{"vars": {"var1": "value1"}, "filled_text": "完整填好变量的问题文本"}',
      '',
      '只输出 JSON，不要任何其他文字。'
    ].join('\n');

    const result = await callLLM({
      system: '你是 AI 面试官助手，严格按要求输出 JSON。',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      jsonMode: true,
      maxTokens: 200,
      temperature: 0.5
    });

    if (!result || !result.text) return null;
    const parsed = _robustParseJSON(result.text, 'customizeQuestion');
    if (parsed && parsed.filled_text) {
      if (!parsed.vars) parsed.vars = {};
      for (const v of vars) {
        if (!parsed.vars[v]) parsed.vars[v] = '[需追问]';
      }
      parsed.source = (window.YOUMIAN_CONFIG && window.YOUMIAN_CONFIG.PRIMARY && window.YOUMIAN_CONFIG.PRIMARY.PROVIDER) || 'm3';
      return parsed;
    }
    return null;
  }

  // ============================================================
  // 4. 调试信息显示（页面底部小条）
  // ============================================================

  function _showDebugBar() {
    if (!(window.YOUMIAN_CONFIG || {}).DEBUG) return;
    if (document.getElementById('ym-debug-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'ym-debug-bar';
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,0.85);color:#10B981;font-size:10px;font-family:monospace;padding:4px 12px;z-index:9999;display:flex;gap:12px;justify-content:space-between;';
    bar.innerHTML = '<span>🤖 M3 API</span><span id="ym-debug-stats">待调用</span>';
    document.body.appendChild(bar);
  }

  function _updateDebugBar(text) {
    const el = document.getElementById('ym-debug-stats');
    if (el) el.textContent = text;
  }

  // 暴露到 window（让 index.html 能调用）
  // ============================================================
  // 工具：去除 <think> 推理块 + 英文内容（仅保留中文回复）
  // ============================================================
  function _stripThinkAndEnglish(text) {
    if (!text || typeof text !== 'string') return text || '';
    let s = text;
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const codeBlockRegex = new RegExp('```(?:json|javascript|js|text)?\s*([\s\S]*?)```');
    const codeBlockMatch = s.match(codeBlockRegex);
    if (codeBlockMatch) s = codeBlockMatch[1].trim();
    s = s.replace(/^(Final Answer|Answer|Output|Response|Result)\s*[:：]\s*/i, '');
    s = s.replace(/\[(面试官|候选人|AI|Assistant|System|User)\]\s*/g, '');
    return s.trim();
  }

  function _extractChineseOnly(text) {
    if (!text) return '';
    const hasChinese = /[\u4e00-\u9fa5]/.test(text);
    if (!hasChinese) return '';
    const lines = text.split(/\n+/);
    const chineseLines = lines.filter(l => /[\u4e00-\u9fa5]/.test(l));
    return chineseLines.join('\n').trim();
  }

  window.YOUMIAN_LLM = {
    callLLM,
    llmPackageExperience,
    llmInterviewStep,
    llmGenerateFeedback,
    customizeQuestion,
    stripThink: _stripThinkAndEnglish,
    extractChinese: _extractChineseOnly,
    PERSONAS,
    PRESSURE_LEVELS,
    getDebugStats: () => _debugStats
  };

  // 初始化调试条
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _showDebugBar);
  } else {
    _showDebugBar();
  }

  // 调试条实时更新（每 2s）
  setInterval(() => {
    const s = _debugStats;
    _updateDebugBar(`调用 ${s.calls} · token ${s.tokens} · 失败 ${s.errors} · 降级 ${s.fallbacks}`);
  }, 2000);

  console.log('[优面AI LLM] 模块已加载 · 主模型：' + (window.YOUMIAN_CONFIG?.PRIMARY?.MODEL || '未配置'));
})();

