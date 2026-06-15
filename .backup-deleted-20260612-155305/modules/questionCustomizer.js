// ============================================================
// 优面AI · P07 题库变量定制化模块（v1.0 · W4 D5）
// 依赖：window.YOUMIAN_LLM.callLLM（llm-integration.js）
//       window.QuestionBank（modules/questionBank.js）
// 暴露：window.QuestionCustomizer
// 作用：调 M3 仅填 ${var} 占位变量（不改写题干），单次 ~200 tokens
// 关联：02-PRD.md §11.3 题库架构
// ============================================================

(function() {
  'use strict';

  // ============================================================
  // 1. 定制化 Prompt（精简，~200 tokens 响应）
  // ============================================================

  const CUSTOMIZE_PROMPT = `你是 AI 面试官助手。你的任务是根据候选人的简历，从题库模板中提取或推断变量值。

【题库模板】
{template}

【需要填的变量】
{vars}

【候选人简历】
{resume}

【目标公司】
{company}

【严格约束】
1. 不重写题干，只替换 \${var} 占位符
2. 简历中能找到的具体项目/数据/经历优先（用真实内容）
3. 简历中找不到的，用 [需追问] 占位
4. 变量名严格使用给定的列表

【输出严格 JSON 格式】
{"vars": {"var1": "value1", "var2": "value2"}, "filled_text": "完整填好变量的问题文本"}

只输出 JSON，不要任何其他文字。`;

// ============================================================
// 2. 启发式兜底（无 API key 或 M3 失败时）
// ============================================================

function _heuristicFill(vars, resume, company) {
  const result = {};
  for (const v of (vars || [])) {
    if (v === 'company') { result[v] = company || '贵公司'; continue; }
    if (v === 'major') {
      const m = (resume || '').match(/(计算机|软件|信管|信通|统计|数学|电子|机械|经济|金融|管理|市场营销|新闻|传播|社会学|心理学|外语|英语|中文|法学|医学)[^\s，。、]{0,8}?(专业|学院)/);
      result[v] = m ? m[0] : '[需追问]';
      continue;
    }
    if (v === 'project_name' || v === 'intern_company') {
      const patterns = [
        /(.{2,15}?(?:平台|系统|项目|小程序|APP|app))/,
        /(?:在|于)(.{2,15}?)(?:实习|工作|担任)/,
        /(.{2,15}?(?:产品|运营|开发|设计)实习)/
      ];
      let found = null;
      for (const p of patterns) {
        const m = (resume || '').match(p);
        if (m && m[1]) { found = m[1].trim(); break; }
      }
      result[v] = found || '[需追问]';
      continue;
    }
    if (/^(user_count|monthly_gmv|dau_improvement|efficiency_gain|roi|contribution|final_metric|expected_metric)$/.test(v)) {
      const m = (resume || '').match(/(\d+(?:\.\d+)?\s*(?:%|万|千|百|人|次|个|元|日|天|月|年|倍)?)/);
      result[v] = m ? m[1] : '[需追问]';
      continue;
    }
    if (/^(failure_case|opportunity|research_method|creator_segment|chosen_solution|optimization_method|engagement_metric|hypothesis_1|first_step|metric_1|cac_reduction_method|metric|criteria|reasoning|ratio|turning_point|example_project|user_question|pitfall|overlooked_ability|strength|weakness|remaining_contribution|target_position)$/.test(v)) {
      const firstLine = (resume || '').split(/[\n。]/).map(function(s){return s.trim();}).filter(function(s){return s.length > 0;})[0] || '';
      result[v] = firstLine.slice(0, 30) || '[需追问]';
      continue;
    }
    result[v] = '[需追问]';
  }
  return result;
}

function _substituteVars(templateText, vars) {
  let s = templateText;
  for (const k of Object.keys(vars || {})) {
    const re = new RegExp('\\$\\{' + k + '\\}', 'g');
    s = s.replace(re, vars[k]);
  }
  return s;
}

// ============================================================
// 3. 缓存
// ============================================================

const _cache = new Map();

function _hash(str) {
  let h = 0;
  const s = str || '';
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}


// ============================================================
// 4. 定制化器主对象
// ============================================================

const QuestionCustomizer = {
  _cache: _cache,
  _stats: { calls: 0, cacheHits: 0, m3Failures: 0, fallbackUsed: 0 },

  /**
   * 填变量：调 M3（首选）/ Qwen（备选）/ 启发式兜底
   * @param {Object} template - 题库模板 {id, text, template_vars, ...}
   * @param {Object} ctx - 上下文 {resume, company, position}
   * @param {Object} [opts] - {useCache, useAI}
   * @returns {Promise<{filled_text: string, vars: Object, source: string}>}
   */
  async fill(template, ctx, opts) {
    opts = opts || {};
    const useCache = opts.useCache !== false;
    const useAI = opts.useAI !== false;
    const templateText = (template && template.text) || '';
    const vars = (template && template.template_vars) || [];
    const resume = (ctx && ctx.resume) || '';
    const company = (ctx && ctx.company) || '';

    // 0. 无变量：直接返回原模板
    if (vars.length === 0) {
      return { filled_text: templateText, vars: {}, source: 'noop' };
    }

    // 1. 查缓存
    const cacheKey = (template.id || templateText) + '_' + _hash(resume + '|' + company);
    if (useCache && _cache.has(cacheKey)) {
      this._stats.cacheHits++;
      const cached = _cache.get(cacheKey);
      return Object.assign({}, cached, { source: 'cache' });
    }

    // 2. 调 M3 / Qwen
    if (useAI && window.YOUMIAN_LLM && window.YOUMIAN_LLM.callLLM) {
      this._stats.calls++;
      const prompt = CUSTOMIZE_PROMPT
        .replace('{template}', templateText)
        .replace('{vars}', vars.join(', '))
        .replace('{resume}', resume || '（无）')
        .replace('{company}', company || '字节');

      try {
        const result = await window.YOUMIAN_LLM.callLLM({
          system: '你是 AI 面试官助手，严格按要求输出 JSON。',
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          jsonMode: true,
          maxTokens: 200,
          temperature: 0.5
        });

        if (result && result.text) {
          const parsed = _parseCustomResult(result.text, vars);
          if (parsed) {
            _cache.set(cacheKey, parsed);
            return Object.assign({}, parsed, { source: 'm3' });
          }
        }
        this._stats.m3Failures++;
      } catch (e) {
        this._stats.m3Failures++;
        console.warn('[QuestionCustomizer] M3 调用失败:', e.message);
      }
    }

    // 3. 启发式兜底
    this._stats.fallbackUsed++;
    const heuristicVars = _heuristicFill(vars, resume, company);
    const filledText = _substituteVars(templateText, heuristicVars);
    const fbResult = { filled_text: filledText, vars: heuristicVars };
    _cache.set(cacheKey, fbResult);
    return Object.assign({}, fbResult, { source: 'fallback' });
  },

  clearCache() {
    _cache.clear();
  },

  getStats() {
    return Object.assign({}, this._stats, { cacheSize: _cache.size });
  }
};

// ============================================================
// 5. 鲁棒 JSON 解析
// ============================================================

function _parseCustomResult(text, expectedVars) {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const codeMatch = cleaned.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/);
  if (codeMatch) cleaned = codeMatch[1].trim();
  else {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  }
  try {
    const obj = JSON.parse(cleaned);
    if (obj && obj.filled_text) {
      if (!obj.vars) obj.vars = {};
      for (const v of expectedVars) {
        if (!obj.vars[v]) obj.vars[v] = '[需追问]';
      }
      return obj;
    }
    return null;
  } catch (e) {
    console.warn('[QuestionCustomizer] JSON 解析失败:', e.message);
    return null;
  }
}

window.QuestionCustomizer = QuestionCustomizer;

console.log('[优面AI QuestionCustomizer] 模块已加载');
})();
