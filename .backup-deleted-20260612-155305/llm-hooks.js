// ============================================================
// 优面AI · LLM 钩子（v0.6 W4 升级）
// 必须在主 index.html 脚本之后加载
// 作用：覆盖 P07 submitAnswer + 钩入 P05 / P08 生命周期
// ============================================================

(function() {
  'use strict';

  if (!window.YOUMIAN_LLM) {
    console.warn('[llm-hooks] 未找到 YOUMIAN_LLM，跳过 LLM 钩子挂载（mock 模式）');
    return;
  }

  console.log('[llm-hooks] 正在挂载 LLM 钩子...');

  // ============================================================
  // 1. P07 submitAnswer 覆盖
  // ============================================================

  // 保存原始 submitAnswer
  const _origSubmitAnswer = window.submitAnswer;

  window.submitAnswer = function() {
    if (!p07State || p07State.phase !== 'idle') return;
    const text = document.getElementById('p07-input').value.trim();
    if (!text) { toast('请先输入你的回答'); return; }

    // 渲染用户气泡
    const conv = document.getElementById('p07-conversation');
    conv.insertAdjacentHTML('beforeend', p07BuildUserBubble(text));
    conv.scrollTop = conv.scrollHeight;

    p07State.answered++;
    p07SetPhase('analyzing');

    // 调用 LLM
    const q = P07_QUESTIONS[p07State.currentQ];
    const history = (p07State.llmHistory || []).concat([{ role: 'user', content: text }]);
    p07State.llmHistory = history;
    let streamBubbleCreated = false;

    window.YOUMIAN_LLM.llmInterviewStep({
      company: p07State.company || '字节',
      pressureLevel: p07State.pressureLevel || '标准',
      position: '产品岗',
      resume: p07State.resume || '张同学 · 产品经理校招',
      history: history.slice(0, -1),
      currentStage: q.stage,
      lastUserAnswer: text
    }, function(delta, full) {
      if (!streamBubbleCreated) {
        const bubbleHTML = [
          '<div class="p07-ai-bubble" id="p07-stream-bubble" style="display:flex; gap:10px; margin-bottom:16px;">',
          '  <div style="width:40px; height:40px; background:linear-gradient(135deg, #5B4FE9, #7B68EE); border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:18px; flex-shrink:0;">🧑‍💼</div>',
          '  <div style="flex:1; min-width:0;">',
          '    <div style="font-size:12px; color:#5B4FE9; margin-bottom:4px;">面试官正在回复<span id="p07-stream-cursor">▌</span></div>',
          '    <div class="card" style="margin:0; padding:14px; background:white; border-radius:14px 14px 14px 4px;">',
          '      <div id="p07-stream-text" style="font-size:14px; line-height:1.7; color:#1A1A2E;"></div>',
          '    </div>',
          '  </div>',
          '</div>'
        ].join('');
        conv.insertAdjacentHTML('beforeend', bubbleHTML);
        streamBubbleCreated = true;
      }
      const textEl = document.getElementById('p07-stream-text');
      if (textEl) {
        // 实时去除 <think> 块（用正则不依赖 stripThink 工具）
        let displayText = full.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        // 去除 <think> 未闭合的情况（流式中可能截断）
        displayText = displayText.replace(/<think>[\s\S]*$/gi, '').trim();
        textEl.textContent = displayText;
      }
      conv.scrollTop = conv.scrollHeight;
    }).then(function(llmResult) {
      if (!llmResult || !llmResult.text) {
        // LLM 失败，降级到 mock
        const mock = p07GenerateFeedback(text);
        p07ShowFeedback(mock);
        toast('AI 暂时不可用，已使用本地反馈');
        return;
      }
      // strip <think> 和英文指令部分，仅保留中文回复
      const cleanText = (window.YOUMIAN_LLM && window.YOUMIAN_LLM.stripThink)
        ? window.YOUMIAN_LLM.stripThink(llmResult.text)
        : llmResult.text;
      p07State.llmHistory.push({ role: 'assistant', content: cleanText });
      const cursor = document.getElementById('p07-stream-cursor');
      if (cursor) cursor.remove();
      // 用 mock 算 rating（保留视觉），feedback 用清理后的 LLM 文本
      const mockRating = p07GenerateFeedback(text);
      p07ShowFeedback(Object.assign({}, mockRating, { feedback: cleanText, llmGenerated: true }));
      // v0.6: 劫持"继续追问"按钮 → 改为调 AI 生成
      p07HijackFollowupButton();
    });
  };

  // ============================================================
  // v0.6: AI 实时生成追问（基于候选人回答上下文）
  // ============================================================
  // 追问 prompt 模板（生成 1 个精准追问）
  const P07_AI_FOLLOWUP_PROMPT = "你是 {company} 产品岗的面试官，正在对候选人进行追问。\n\n【主问题】\n\"{mainQuestion}\"\n\n【候选人刚才的回答】\n\"{userAnswer}\"\n\n\n【你的任务】基于候选人的具体回答，生成 1 个精准的追问问题：\n1. 必须引用候选人回答中的具体细节（数据/项目/经历），不要问泛泛的问题\n2. 往深里挖：底层逻辑/数据基线/反思深度/跨部门协作 等\n3. 匹配你的人设风格（节奏/关注点/红线）\n4. 1-2 句话，60 字以内，用对话口吻，不要 markdown\n\n【输出】只输出追问问题本身，不要任何前缀或解释。";

  // 劫持"继续追问"按钮（替换为 AI 生成）
  function p07HijackFollowupButton() {
    const nextBtn = document.getElementById("p07-next-btn");
    if (!nextBtn) return;
    const text = nextBtn.innerHTML || "";
    if (text.indexOf("追问") < 0) return;  // 不是追问按钮
    nextBtn.onclick = function() { p07RequestAIFollowup(); };
  }

  // AI 实时生成追问
  async function p07RequestAIFollowup() {
    if (!window.YOUMIAN_LLM) {
      p07State.currentFollowup++;
      await p07RenderCurrent();
      return;
    }

    const q = P07_QUESTIONS[p07State.currentQ];
    const history = p07State.llmHistory || [];
    // 找最近一次 user 消息
    let lastUserAnswer = "";
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user") { lastUserAnswer = history[i].content; break; }
    }
    if (!lastUserAnswer) lastUserAnswer = p07State.lastUserText || "";

    // 1. 显示"AI 正在生成追问..."过渡气泡
    const conv = document.getElementById("p07-conversation");
    if (conv.querySelector("#p07-followup-thinking")) return;
    const thinkingHTML = [
      "<div class=\"p07-ai-bubble\" id=\"p07-followup-thinking\" style=\"display:flex; gap:10px; margin-bottom:16px;\">",
      "<div style=\"width:40px; height:40px; background:linear-gradient(135deg, #5B4FE9, #7B68EE); border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:18px; flex-shrink:0;\">🧑‍💼</div>",
      "<div style=\"flex:1; min-width:0;\">",
      "<div style=\"font-size:12px; color:#F59E0B; margin-bottom:4px;\">🔥 AI 追问中<span id=\"p07-followup-cursor\">▌</span></div>",
      "<div class=\"card\" style=\"margin:0; padding:14px; background:#FEF3E2; border-radius:14px 14px 14px 4px; border:1px solid #FCD34D;\">",
      "<div style=\"font-size:14px; line-height:1.7; color:#92400E;\">🔄 正在基于你的回答生成追问...</div>",
      "</div></div></div>"
    ].join("");
    conv.insertAdjacentHTML("beforeend", thinkingHTML);
    conv.scrollTop = conv.scrollHeight;

    // 2. 构造 prompt
    const cfg = window.YOUMIAN_CONFIG || {};
    const company = p07State.company || "字节";
    const system = (window.YOUMIAN_LLM.PERSONAS || {})[company] || (window.YOUMIAN_LLM.PERSONAS || {})["字节"];
    const pressure = (window.YOUMIAN_LLM.PRESSURE_LEVELS || {})[p07State.pressureLevel] || "【压力级别：标准】";
    const fullSystem = system + "\n\n" + pressure;
    const userPrompt = P07_AI_FOLLOWUP_PROMPT
      .replace("{company}", company)
      .replace("{mainQuestion}", q.text)
      .replace("{userAnswer}", lastUserAnswer);

    // 3. 直接调 M3（非流式，单次问题快）
    const startTime = Date.now();
    const result = await window.YOUMIAN_LLM.callLLM({
      system: fullSystem,
      messages: [{ role: "user", content: userPrompt }],
      stream: false,
      jsonMode: false,
      maxTokens: 200
    });

    // 4. 清理 + 渲染
    let followupText = (result && result.text) ? result.text : "";
    if (window.YOUMIAN_LLM.stripThink) {
      followupText = window.YOUMIAN_LLM.stripThink(followupText);
    }
    if (!followupText) {
      // 降级：M3 失败时用题库 followup
      conv.querySelector("#p07-followup-thinking")?.remove();
      p07State.currentFollowup++;
      await p07RenderCurrent();
      toast("AI 追问生成失败，已用预设追问");
      return;
    }

    // 5. 移除过渡气泡 + 替换为正式追问气泡
    const thinkingEl = conv.querySelector("#p07-followup-thinking");
    if (thinkingEl) thinkingEl.outerHTML = p07BuildAIBubble(followupText, true);
    conv.scrollTop = conv.scrollHeight;

    // 6. 更新状态
    p07State.currentFollowup++;
    p07State.followupCount++;
    p07State.lastFollowupText = followupText;
    // 记录到 history（user 视角：候选人回答；assistant 视角：追问）
    p07State.llmHistory.push({ role: "assistant", content: followupText });

    // 7. 切到 idle 状态（让用户回答新追问）
    p07SetPhase("idle");

    // 8. 更新阶段提示
    const stageHint = document.getElementById("p07-stage-hint");
    if (stageHint) stageHint.textContent = "🔥 追问中 · 请基于面试官问题继续回答";

    // 9. 限制追问次数（每主问最多 2 次追问）
    const nextBtn = document.getElementById("p07-next-btn");
    if (nextBtn && p07State.followupCount >= 2) {
      // 2 次追问后：直接进入下一题
      if (p07State.currentQ < P07_QUESTIONS.length - 1) {
        nextBtn.innerHTML = "➡️ 进入下一题";
        nextBtn.style.background = "#5B4FE9";
        nextBtn.onclick = function() { p07LoadNext(); };
      } else {
        nextBtn.innerHTML = "🎉 结束面试，查看反馈";
        nextBtn.style.background = "#10B981";
        nextBtn.onclick = function() { go("p08"); };
      }
    } else if (nextBtn) {
      // 还有追问次数
      nextBtn.innerHTML = "🔄 继续追问 (AI) " + (p07State.followupCount + 1) + "/2";
      nextBtn.style.background = "#F59E0B";
      nextBtn.onclick = function() { p07RequestAIFollowup(); };
    }

    toast("✅ AI 追问已生成（" + ((Date.now() - startTime) / 1000).toFixed(1) + "s）");
  }

  // ============================================================
  // 2. P05 经历包装钩子（在 P05 页面插入触发按钮）
  // ============================================================

  let _p05ResumeUploaded = false;
  let _p05UploadedFile = null;

  function p05InjectLLMButton() {
    const p05 = document.getElementById('page-p05');
    if (!p05 || document.getElementById('p05-upload-area')) return;

    // 1. 在 P05 顶部注入"上传简历"区（首次进入显示）
    const uploadHTML = [
      '<div id="p05-upload-area" style="margin:12px 16px; padding:24px 16px; background:linear-gradient(135deg, #F0EEFF, #E8E5FF); border:2px dashed #5B4FE9; border-radius:12px; text-align:center;">',
      '  <div style="font-size:48px; margin-bottom:8px;">📤</div>',
      '  <div style="font-weight:600; font-size:15px; margin-bottom:4px;">上传简历 · AI 智能包装前提</div>',
      '  <div style="font-size:12px; color:#6B7280; margin-bottom:12px;">支持 PDF / Word / 在线填写 · 自动解析为产品岗视角</div>',
      '  <div style="display:flex; gap:8px; justify-content:center;">',
      '    <button onclick="window.llmHooks.p05SimulateUpload()" style="padding:10px 20px; background:#5B4FE9; color:white; border-radius:8px; font-size:13px; font-weight:500;">📄 选择 PDF / Word</button>',
      '    <button onclick="window.llmHooks.p05SimulateUpload(&quot;inline&quot;)" style="padding:10px 20px; background:white; color:#5B4FE9; border:1px solid #5B4FE9; border-radius:8px; font-size:13px; font-weight:500;">✏️ 在线填写</button>',
      '  </div>',
      '  <div style="font-size:11px; color:#9CA3AF; margin-top:10px;">🔌 上传后调用 MiniMax-M3 解析 · 简历文件不上传服务器</div>',
      '</div>',
      '<div id="p05-uploaded-info" style="display:none; margin:12px 16px; padding:14px; background:white; border-radius:10px; border-left:3px solid #10B981; display:flex; align-items:center; gap:10px;">',
      '  <div style="font-size:24px;">📄</div>',
      '  <div style="flex:1;">',
      '    <div id="p05-uploaded-name" style="font-weight:600; font-size:13px;">张同学_产品经理.pdf</div>',
      '    <div style="font-size:11px; color:#6B7280;">已上传 · 解析完成 · 3 段经历（演示用）</div>',
      '  </div>',
      '  <button onclick="window.llmHooks.p05ReUpload()" style="font-size:11px; color:#5B4FE9; background:none; padding:4px 8px;">重新上传</button>',
      '</div>',
      '<div id="p05-llm-trigger" style="margin:16px 16px 8px; display:none;">',
      '  <button id="p05-llm-btn" onclick="window.llmHooks.p05RunPackaging()" style="width:100%; padding:12px; background:linear-gradient(135deg, #5B4FE9, #7B68EE); color:white; border-radius:10px; font-size:14px; font-weight:500; display:flex; align-items:center; justify-content:center; gap:6px;">',
      '    <span>✨</span><span>AI 智能包装（接 M3）</span>',
      '  </button>',
      '</div>',
      '<div id="p05-llm-status" style="margin:0 16px 8px; font-size:11px; color:#6B7280; text-align:center; min-height:14px;"></div>'
    ].join('');

    // 找到 P05 第一个 div 容器
    const innerDiv = p05.querySelector('div[style*="padding:0 16px"]') || p05.firstElementChild;
    if (innerDiv) {
      innerDiv.insertAdjacentHTML('afterbegin', uploadHTML);
    }

    // 2. 隐藏原本已存在的"张同学.pdf"卡（避免重复展示）
    const existingResumeCard = Array.from(p05.querySelectorAll('.card')).find(c =>
      c.textContent.includes('张同学') && c.textContent.includes('已上传')
    );
    if (existingResumeCard) existingResumeCard.style.display = 'none';

    // 3. 隐藏 3 段经历卡片（未上传时）
    const experienceCards = Array.from(p05.querySelectorAll('.card')).filter(c =>
      c.textContent.includes('AI 包装建议') || c.textContent.includes('🎓') || c.textContent.includes('🛒') || c.textContent.includes('📊')
    );
    experienceCards.forEach(c => c.style.display = _p05ResumeUploaded ? 'block' : 'none');

    // 4. 隐藏"AI 经历包装（3 段）"标题和说明（未上传时）
    const packageTitle = Array.from(p05.querySelectorAll('div')).find(d =>
      d.textContent.trim() === '✨ AI 经历包装（3 段）' || d.textContent.trim().startsWith('✨ AI 经历包装')
    );
    if (packageTitle) packageTitle.style.display = _p05ResumeUploaded ? 'flex' : 'none';
  }

  window.llmHooks.p05SimulateUpload = function(source) {
    const uploadArea = document.getElementById('p05-upload-area');
    const uploadedInfo = document.getElementById('p05-uploaded-info');
    const trigger = document.getElementById('p05-llm-trigger');
    const status = document.getElementById('p05-llm-status');
    if (!uploadArea || !uploadedInfo) return;

    _p05ResumeUploaded = true;
    _p05UploadedFile = source === 'inline' ? '在线填写简历' : '张同学_产品经理.pdf';

    const nameEl = document.getElementById('p05-uploaded-name');
    if (nameEl) nameEl.textContent = _p05UploadedFile;

    // 隐藏上传区，显示已上传信息 + LLM 按钮
    uploadArea.style.display = 'none';
    uploadedInfo.style.display = 'flex';
    trigger.style.display = 'block';
    if (status) status.textContent = '✅ 简历解析完成（3 段经历），点击上方按钮让 M3 包装';

    // 显示 3 段经历卡片
    const p05 = document.getElementById('page-p05');
    const experienceCards = Array.from(p05.querySelectorAll('.card')).filter(c =>
      c.textContent.includes('AI 包装建议') || c.textContent.includes('🎓') || c.textContent.includes('🛒') || c.textContent.includes('📊')
    );
    experienceCards.forEach(c => c.style.display = 'block');

    // 显示"AI 经历包装（3 段）"标题
    const packageTitle = Array.from(p05.querySelectorAll('div')).find(d =>
      d.textContent.trim().startsWith('✨ AI 经历包装')
    );
    if (packageTitle) packageTitle.style.display = 'flex';

    toast('✅ 简历已上传');
  };

  window.llmHooks.p05ReUpload = function() {
    _p05ResumeUploaded = false;
    _p05UploadedFile = null;
    const uploadArea = document.getElementById('p05-upload-area');
    const uploadedInfo = document.getElementById('p05-uploaded-info');
    const trigger = document.getElementById('p05-llm-trigger');
    const status = document.getElementById('p05-llm-status');

    if (uploadArea) uploadArea.style.display = 'block';
    if (uploadedInfo) uploadedInfo.style.display = 'none';
    if (trigger) trigger.style.display = 'none';
    if (status) status.textContent = '';

    // 隐藏 3 段经历卡片
    const p05 = document.getElementById('page-p05');
    const experienceCards = Array.from(p05.querySelectorAll('.card')).filter(c =>
      c.textContent.includes('AI 包装建议') || c.textContent.includes('🎓') || c.textContent.includes('🛒') || c.textContent.includes('📊')
    );
    experienceCards.forEach(c => c.style.display = 'none');

    toast('请重新选择简历文件');
  };

  window.llmHooks = window.llmHooks || {};

  window.llmHooks.p05RunPackaging = async function() {
    const btn = document.getElementById('p05-llm-btn');
    const status = document.getElementById('p05-llm-status');
    if (!btn || !status) return;

    // 检查是否已上传简历
    if (!_p05ResumeUploaded) {
      status.textContent = '⚠️ 请先上传简历';
      status.style.color = '#F59E0B';
      toast('请先上传简历再使用 AI 包装');
      return;
    }

    // 禁用按钮
    btn.disabled = true;
    btn.style.opacity = '0.6';
    status.textContent = '🤖 正在调用 MiniMax-M3 分析 3 段经历（流式）...';
    status.style.color = '#5B4FE9';

    // 构造经历数据
    const experiences = [
      { title: '🎓 学术研究 · 企业流程建模', text: '信管研究生期间，研究 XX 企业 ERP 流程优化方法论，输出论文 1 篇', isCrossMajor: true },
      { title: '🛒 校园创业 · 校园二手交易平台', text: '3 人团队运营，覆盖 2000+ 用户，月 GMV 8 万', isCrossMajor: false },
      { title: '📊 课程项目 · 数据分析报告', text: '商业分析课程项目，分析某零售品牌销售数据，输出 30 页报告', isCrossMajor: true }
    ];

    let result;
    try {
      result = await window.YOUMIAN_LLM.llmPackageExperience(experiences);
    } catch (e) {
      status.textContent = '❌ 调用异常：' + e.message + '（已保留原始建议）';
      status.style.color = '#EF4444';
      console.error('[P05] LLM call error:', e);
      return;
    } finally {
      btn.disabled = false;
      btn.style.opacity = '1';
    }

    if (!result) {
      status.textContent = '❌ AI 包装失败（API 返回空，已保留原始建议）';
      status.style.color = '#EF4444';
      return;
    }
    if (!result.packages || result.packages.length === 0) {
      status.textContent = '⚠️ AI 返回无 packages 字段（' + Object.keys(result).join(',') + '）';
      status.style.color = '#F59E0B';
      console.warn('[P05] LLM 返回无 packages:', result);
      return;
    }

    status.textContent = '✅ AI 包装完成（基于 MiniMax-M3）';
    status.style.color = '#10B981';

    // 替换 3 张经历卡片的"💡 AI 包装建议"内容（容错处理不同格式）
    const cards = document.querySelectorAll('#page-p05 .card');
    let replaced = 0;
    cards.forEach(card => {
      const suggestBlock = Array.from(card.querySelectorAll('div')).find(d =>
        d.textContent.includes('💡 AI 包装建议') && d.children.length === 0
      );
      if (!suggestBlock) return;
      const contentDiv = suggestBlock.nextElementSibling;
      if (!contentDiv) return;

      const exp = result.packages[replaced];
      if (!exp) return;
      const tags = exp.tags || exp.标签 || [];

      // 容错：tags 可能是 [{name, reason}] 或 ["name1", "name2"] 或其他
      const tagsHTML = tags.map(t => {
        if (typeof t === 'string') return '<b>' + t + '</b>';
        if (t && typeof t === 'object') {
          const name = t.name || t.标签 || t.tag || JSON.stringify(t);
          const reason = t.reason || t.说明 || t.description || '';
          return '<b>' + name + '</b>' + (reason ? ' · ' + reason : '');
        }
        return '<b>' + String(t) + '</b>';
      }).join('<br/>→ ');

      contentDiv.innerHTML = '→ ' + tagsHTML;
      replaced++;
    });

    if (replaced === 0) {
      status.textContent = '⚠️ AI 包装完成但未匹配到卡片（页面结构可能变了）';
      status.style.color = '#F59E0B';
    }
  };

  // ============================================================
  // 3. P08 反馈页钩子（页面打开时调用 LLM 生成真实反馈）
  // ============================================================

  function p08InjectLLMHook() {
    const p08 = document.getElementById('page-p08');
    if (!p08 || document.getElementById('p08-llm-loading')) return;

    // 在 P08 顶部插入 loading 状态条
    const firstChild = p08.querySelector('.topbar');
    if (firstChild) {
      const loadingHTML = [
        '<div id="p08-llm-loading" style="background:linear-gradient(135deg, #5B4FE9, #7B68EE); color:white; padding:10px 16px; text-align:center; font-size:13px;">',
        '  <div class="p07-spinner" style="display:inline-block; vertical-align:middle; margin-right:8px; border-color:rgba(255,255,255,0.3); border-top-color:white;"></div>',
        '  <span id="p08-llm-loading-text">🤖 正在调用 MiniMax-M3 生成反馈...</span>',
        '</div>'
      ].join('');
      firstChild.insertAdjacentHTML('afterend', loadingHTML);
    }
  }

  async function p08RunFeedback() {
    const loadingEl = document.getElementById('p08-llm-loading');
    const loadingText = document.getElementById('p08-llm-loading-text');
    if (!loadingEl) return;

    loadingText.textContent = '🤖 正在调用 MiniMax-M3 生成反馈...';

    // 从 P07 历史拿对话
    const history = (window.p07State && p07State.llmHistory) || [];
    if (history.length === 0) {
      loadingText.textContent = '⚠️ 未找到对话历史（可能是直接进入 P08），使用本地示例数据';
      setTimeout(() => { loadingEl.style.display = 'none'; }, 2500);
      return;
    }

    const result = await window.YOUMIAN_LLM.llmGenerateFeedback({
      company: (p07State && p07State.company) || '字节',
      pressureLevel: (p07State && p07State.pressureLevel) || '标准',
      position: '产品岗',
      resume: (p07State && p07State.resume) || '张同学 · 产品经理校招',
      conversation: history
    });

    if (!result) {
      loadingText.textContent = '❌ AI 反馈生成失败（已保留本地示例）';
      setTimeout(() => { loadingEl.style.display = 'none'; }, 3000);
      return;
    }

    // 渲染 LLM 反馈
    p08RenderLLMFeedback(result);
    loadingEl.style.display = 'none';
  }

  // 工具：清理 LLM 输出（strip think + 英文指令）
  function _cleanText(t) {
    if (!t) return t;
    if (window.YOUMIAN_LLM && window.YOUMIAN_LLM.stripThink) {
      return window.YOUMIAN_LLM.stripThink(String(t));
    }
    return String(t).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  function p08RenderLLMFeedback(data) {
    // 替换综合评分
    const scoreEl = document.querySelector('#page-p08 .card div[style*="font-size:64px"]');
    if (scoreEl && data.overall_score) {
      scoreEl.innerHTML = data.overall_score + '<span style="font-size:24px; opacity:0.7;">/100</span>';
    }

    // 替换雷达图（6 维）
    if (data.radar) {
      const radarValues = [
        data.radar['产品感'] || 70,
        data.radar['逻辑'] || 70,
        data.radar['表达'] || 70,
        data.radar['案例'] || 70,
        data.radar['反问'] || 70,
        data.radar['抗压'] || 70
      ];
      const radar = p08BuildRadarSVG(radarValues);
      const svgEl = document.querySelector('#page-p08 .card svg');
      if (svgEl) svgEl.outerHTML = radar;
    }

    // 替换优势
    if (data.优势 && data.优势.length > 0) {
      data.优势 = data.优势.map(_cleanText).filter(t => t && t.length > 0);
      const advCard = Array.from(document.querySelectorAll('#page-p08 .card')).find(c =>
        c.textContent.includes('✓ 优势') || c.textContent.includes('优势（'));
      if (advCard) {
        const contentDiv = advCard.querySelector('div[style*="font-size:13px"]');
        if (contentDiv) {
          contentDiv.innerHTML = data.优势.map((a, i) => (i + 1) + '. ' + _cleanText(a)).join('<br/>');
        }
      }
    }

    // 替换不足
    if (data.不足 && data.不足.length > 0) {
      data.不足 = data.不足.map(_cleanText).filter(t => t && t.length > 0);
      const disCard = Array.from(document.querySelectorAll('#page-p08 .card')).find(c =>
        c.textContent.includes('✗ 不足') || c.textContent.includes('敢说真话'));
      if (disCard) {
        const contentDiv = disCard.querySelector('div[style*="font-size:13px"]');
        if (contentDiv) {
          contentDiv.innerHTML = data.不足.map((a, i) => (i + 1) + '. ' + _cleanText(a)).join('<br/>');
        }
      }
    }

    // 替换改进建议
    if (data.改进建议 && data.改进建议.length > 0) {
      data.改进建议 = data.改进建议.map(s => Object.assign({}, s, {
        建议: _cleanText(s.建议 || ''),
        类别: _cleanText(s.类别 || '')
      })).filter(s => s.建议 && s.建议.length > 0);
      const sugCard = Array.from(document.querySelectorAll('#page-p08 .card')).find(c =>
        c.textContent.includes('🎯') && c.textContent.includes('改进建议'));
      if (sugCard) {
        const items = data.改进建议.map(s => {
          return '<div style="border-left:2px solid #5B4FE9; padding:4px 0 4px 12px; margin-bottom:10px;">' +
            '<div style="font-size:13px; font-weight:600; margin-bottom:2px;">优先级 ' + (s.优先级 || 'P0') + ' · ' + (s.类别 || '通用') + '</div>' +
            '<div style="font-size:12px; color:#6B7280; line-height:1.6;">' + (s.建议 || '') + '</div>' +
            '</div>';
        }).join('');
        sugCard.innerHTML = '<div style="font-weight:600; margin-bottom:10px;">🎯 ' + data.改进建议.length + ' 条关键改进建议（M3 生成）</div>' + items;
      }
    }
  }

  // 6 维雷达图 SVG 生成
  function p08BuildRadarSVG(values) {
    // values: [产品感, 逻辑, 表达, 案例, 反问, 抗压]，每项 0-100
    const max = 90; // SVG 最大半径
    const labels = ['逻辑', '产品感', '用户洞察', '案例', '反问', '抗压'];
    const points = values.map((v, i) => {
      const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
      const r = (v / 100) * max;
      return [(r * Math.cos(angle)).toFixed(2), (r * Math.sin(angle)).toFixed(2)];
    });
    const polygon = points.map(p => p.join(',')).join(' ');
    const labelEls = labels.map((l, i) => {
      const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
      const lr = max + 15;
      const x = (lr * Math.cos(angle)).toFixed(2);
      const y = (lr * Math.sin(angle)).toFixed(2);
      return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-size="11" fill="#6B7280">' + l + ' ' + values[i] + '</text>';
    }).join('');
    return [
      '<svg viewBox="-110 -110 220 220" style="width:100%; height:240px;">',
      '  <polygon points="0,-90 78,-45 78,45 0,90 -78,45 -78,-45" fill="#F8F9FB" stroke="#E5E7EB" stroke-width="1"/>',
      '  <polygon points="0,-60 52,-30 52,30 0,60 -52,30 -52,-30" fill="white" stroke="#E5E7EB" stroke-width="1"/>',
      '  <polygon points="0,-30 26,-15 26,15 0,30 -26,15 -26,-15" fill="white" stroke="#E5E7EB" stroke-width="1"/>',
      '  <polygon points="' + polygon + '" fill="rgba(91,79,233,0.25)" stroke="#5B4FE9" stroke-width="2"/>',
      '  ' + points.map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="#5B4FE9"/>').join(''),
      '  ' + labelEls,
      '</svg>'
    ].join('');
  }

  // ============================================================
  // 4. 钩入页面生命周期（用 MutationObserver 监听 .page.active 变化）
  // ============================================================

  let _lastActivePage = null;
  setInterval(function() {
    const activePage = document.querySelector('.page.active');
    if (!activePage) return;
    const pageId = activePage.id.replace('page-', '');
    if (pageId === _lastActivePage) return;
    _lastActivePage = pageId;

    if (pageId === 'p05') {
      p05InjectLLMButton();
    } else if (pageId === 'p08') {
      p08InjectLLMHook();
      p08RunFeedback();
    } else if (pageId === 'p07') {
      // p07Init() 已经在原 _origGo 钩子里调用，我们只需要重置历史
      if (window.p07State) {
        p07State.llmHistory = p07State.llmHistory || [];
        // 从 P02/P06 选的公司/压力级别继承
        try {
          p07State.company = window._selectedCompany || '字节';
          p07State.pressureLevel = window._selectedPressure || '标准';
          p07State.resume = window._selectedResume || '张同学 · 产品经理校招';
        } catch (e) {}
      }
    }
  }, 200);

  console.log('[llm-hooks] ✅ 钩子挂载完成（P05 触发按钮 + P07 submitAnswer 覆盖 + P08 反馈钩子）');
})();


