// ============================================================
// 优面AI · P07 题库加载 + 检索模块（v1.0 · W4 D5）
// 依赖：data/p07-question-bank.json（fetch 异步加载，30 道题）
// 暴露：window.QuestionBank
// 关联：02-PRD.md §11.3 题库架构
// ============================================================

(function() {
  'use strict';

  // ============================================================
  // 1. 兜底题库（fetch 失败时使用，5 道占位）
  // ============================================================

  const _FALLBACK_BANK = {
    version: '1.0-fallback',
    total: 5,
    stages: ['开场', '实习深挖', '项目深挖', '业务考察', '收尾反问'],
    company_persona: {
      '字节': { tag: '字节', focus: '数据驱动', rhythm: '快' },
      '腾讯': { tag: '腾讯', focus: '系统思考', rhythm: '中' },
      '美团': { tag: '美团', focus: '业务落地', rhythm: '中' },
      '小红书': { tag: '小红书', focus: '内容生态', rhythm: '慢' }
    },
    questions: [
      { id: 'mock-1', stage: '开场', company_tags: ['字节','腾讯','美团','小红书'], type: '基础', difficulty: 'easy', text: '请用 2-3 分钟做一个自我介绍。', template_vars: [], followup_angles: [], evaluation_focus: ['表达'] },
      { id: 'mock-2', stage: '实习深挖', company_tags: ['字节','腾讯','美团','小红书'], type: '实习', difficulty: 'medium', text: '介绍一下你最有挑战的一段实习。', template_vars: [], followup_angles: [], evaluation_focus: ['STAR'] },
      { id: 'mock-3', stage: '项目深挖', company_tags: ['字节','腾讯','美团','小红书'], type: '项目', difficulty: 'medium', text: '讲一个你主导的项目。', template_vars: [], followup_angles: [], evaluation_focus: ['0-1 思考'] },
      { id: 'mock-4', stage: '业务考察', company_tags: ['字节','腾讯','美团','小红书'], type: '业务', difficulty: 'hard', text: '你对我们公司的核心业务有什么了解？', template_vars: [], followup_angles: [], evaluation_focus: ['业务理解'] },
      { id: 'mock-5', stage: '收尾反问', company_tags: ['字节','腾讯','美团','小红书'], type: '反问', difficulty: 'easy', text: '你有什么想问我的？', template_vars: [], followup_angles: [], evaluation_focus: ['反问质量'] }
    ]
  };

  // ============================================================
  // 2. 题库管理器
  // ============================================================

  const QuestionBank = {
    bank: null,
    byId: {},
    byStage: {},
    byCompany: {},
    usedIds: [],
    _loaded: false,
    _loadingPromise: null,

    /**
     * 加载题库（启动时调用 1 次，幂等）
     * @returns {Promise<Object>} 题库对象
     */
    async load() {
      if (this._loaded) return this.bank;
      if (this._loadingPromise) return this._loadingPromise;

      this._loadingPromise = (async () => {
        // 方式 1: fetch 加载 JSON
        try {
          const resp = await fetch('data/p07-question-bank.json', { cache: 'no-store' });
          if (resp.ok) {
            this.bank = await resp.json();
            console.log('[QuestionBank] 加载题库（fetch）: ' + this.bank.total + ' 道题');
          } else {
            throw new Error('HTTP ' + resp.status);
          }
        } catch (e1) {
          // 方式 2: window 全局变量（避免 file:// CORS）
          if (window.P07_QUESTION_BANK) {
            this.bank = window.P07_QUESTION_BANK;
            console.log('[QuestionBank] 加载题库（window 全局）: ' + this.bank.total + ' 道题');
          } else {
            // 方式 3: 兜底 mock
            console.warn('[QuestionBank] fetch & window 全局均不可用，使用 mock 题库（5 道）');
            this.bank = _FALLBACK_BANK;
          }
        }
        this._buildIndexes();
        this._loaded = true;
        return this.bank;
      })();

      return this._loadingPromise;
    },

    /**
     * 构建索引（id / stage / company）
     */
    _buildIndexes() {
      this.byId = {};
      this.byStage = {};
      this.byCompany = {};
      if (!this.bank || !this.bank.questions) return;
      for (const q of this.bank.questions) {
        this.byId[q.id] = q;
        if (!this.byStage[q.stage]) this.byStage[q.stage] = [];
        this.byStage[q.stage].push(q);
        for (const c of (q.company_tags || [])) {
          if (!this.byCompany[c]) this.byCompany[c] = [];
          this.byCompany[c].push(q);
        }
      }
    },

    /**
     * RAG 检索：根据 stage + company 选最合适的 1 道题
     * 加权：stage 匹配 +10，公司标签命中 +5/个，difficulty=medium +1
     * 通用题（4 公司都覆盖）-1
     * @param {string} stage - 阶段名
     * @param {string[]} companyTags - 候选人选的公司
     * @param {string[]} [excludeIds=[]] - 已用过的 id 列表
     * @returns {Array} Top N 候选（实际返回 1 道，从 Top 3 中随机选）
     */
    select(stage, companyTags, excludeIds) {
      if (!this._loaded) {
        console.warn('[QuestionBank] 未加载题库，请先调用 await QuestionBank.load()');
        return [];
      }
      excludeIds = excludeIds || [];
      companyTags = companyTags || [];
      const stageQuestions = this.byStage[stage] || [];
      if (stageQuestions.length === 0) return [];

      const candidates = stageQuestions
        .filter(q => !excludeIds.includes(q.id))
        .map(q => {
          let score = 0;
          if (q.stage === stage) score += 10;
          const matched = (q.company_tags || []).filter(t => companyTags.includes(t));
          score += matched.length * 5;
          if (q.difficulty === 'medium') score += 1;
          if ((q.company_tags || []).length === 4) score -= 1;
          return { q: q, score: score };
        })
        .sort((a, b) => b.score - a.score);

      const top3 = candidates.slice(0, 3);
      if (top3.length === 0) return [];
      const chosen = top3[Math.floor(Math.random() * top3.length)];
      return [chosen.q];
    },

    /**
     * 拿追问角度列表
     * @param {string} qid
     * @returns {Array<string>}
     */
    getFollowupAngles(qid) {
      const q = this.byId[qid];
      return (q && q.followup_angles) || [];
    },

    /**
     * 拿题目详情
     */
    getById(qid) {
      return this.byId[qid] || null;
    },

    /**
     * 标记某题已用
     */
    markUsed(qid) {
      if (qid && !this.usedIds.includes(qid)) {
        this.usedIds.push(qid);
      }
    },

    /**
     * 重置已用列表（新一轮面试）
     */
    reset() {
      this.usedIds = [];
    },

    /**
     * 拿统计
     */
    getStats() {
      return {
        total: this.bank ? this.bank.total : 0,
        loaded: this._loaded,
        usedCount: this.usedIds.length,
        stages: Object.keys(this.byStage),
        availableByStage: Object.fromEntries(
          Object.entries(this.byStage).map(function(entry) { return [entry[0], entry[1].length]; })
        )
      };
    }
  };

  window.QuestionBank = QuestionBank;

  // 启动时自动加载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { QuestionBank.load(); });
  } else {
    QuestionBank.load();
  }

  console.log('[优面AI QuestionBank] 模块已加载');
})();
